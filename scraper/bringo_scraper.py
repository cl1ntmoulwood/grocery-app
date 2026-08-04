#!/usr/bin/env python3
"""
bringo_scraper.py — Standalone price scraper for bringo.ma search results.

Part of the Family Pantry & Local Price Tracker project. This script is
intentionally NOT invoked by the backend API (see backend/src/routes/inventory.js
POST /inventory/sync, which is a 501 stub on purpose). Run it manually or via
cron on the home server to populate the `price_history` table over time.

Usage:
    python bringo_scraper.py "Lait"
    python bringo_scraper.py "Huile d'olive" --max-pages 2

Requires DATABASE_URL in the environment or a local .env file, e.g.:
    DATABASE_URL=postgres://pantry:pantry@localhost:5432/pantry

===============================================================================
!! CAVEAT — READ BEFORE RELYING ON THIS SCRIPT IN PRODUCTION !!

UPDATE: a follow-up check with real (if limited) web access confirmed this
script's original assumptions were wrong, not just imprecise:

  - bringo.ma is "BRINGO by Carrefour", an address/delivery-zone-gated
    grocery app — NOT a generic Magento/PrestaShop storefront.
  - The guessed search URL (SEARCH_URL_TEMPLATE below) returned a CONFIRMED
    HTTP 404. It does not work. There is no evidence the site supports a
    simple `?q=<term>` keyword search at all — the fetched pages instead
    show category navigation tiles (e.g. "Epicerie", "Boulangerie &
    Pâtisserie") reachable only after picking a delivery address/store.
  - There are signs (spinner/toast asset references, client-side confirm
    dialogs) suggesting at least some content loads via JavaScript/XHR
    after the initial page load, which a plain `requests` GET will not
    execute. It was NOT possible to confirm whether product/price data is
    present in the initial server-rendered HTML or only arrives via a
    later API call — that distinction determines whether a
    requests+BeautifulSoup approach can work here at all.

The CSS selectors in SELECTORS below remain unverified best-effort guesses
on top of this now-shakier foundation. Before trusting any data this script
writes to `price_history`:

  1. In a real browser, walk through bringo.ma's actual flow: select a
     delivery address/store, then find how product search or category
     browsing actually works (URL pattern, query params).
  2. Open DevTools' Network tab (not just "View Page Source") while doing
     that, and check whether product/price data appears in the initial
     HTML document or in a separate XHR/fetch JSON response. If it's the
     latter, this script needs to be rewritten to call that JSON endpoint
     directly instead of parsing HTML with BeautifulSoup — likely simpler
     and more reliable than DOM scraping once found.
  3. Only if product data is present in server-rendered HTML: update
     SEARCH_URL_TEMPLATE and the SELECTORS dict below to match reality.
  4. Run this script against a small, throwaway search term and manually
     verify a handful of rows in `price_history` look correct (title, price,
     unit) before trusting the price history chart data.

Do NOT ship this to "production" family use without doing the above — the
current SEARCH_URL_TEMPLATE will simply 404 on every run as-is.
===============================================================================
"""

from __future__ import annotations

import argparse
import logging
import os
import random
import re
import sys
import time
from decimal import Decimal, InvalidOperation
from urllib.parse import quote, urljoin

import psycopg2
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# ------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------

BASE_URL = "https://www.bringo.ma"
# NOTE: The real search path/query-param name (e.g. "?q=" vs "?search=") is
# also unverified — confirm this against a real browser request before use.
SEARCH_URL_TEMPLATE = f"{BASE_URL}/catalogsearch/result/?q={{query}}"

# --- BEST-EFFORT PLACEHOLDER SELECTORS ------------------------------------
# See the caveat block in the module docstring above. Every one of these
# CSS selectors is a guess and MUST be verified against bringo.ma's real
# markup before this scraper is relied on for accurate data.
SELECTORS = {
    "product_card": "li.product-item, div.product-item",
    "title": ".product-item-link, .product-item-name a",
    "price": ".price-box .price, span.price",
    "unit": ".product-item-unit, .unit-label",
    "image": ".product-image-photo",
    "link": ".product-item-link, .product-item-name a",
    # Placeholder for a "next page" link, in case pagination is supported.
    "next_page": "a.action.next",
}
# ---------------------------------------------------------------------------

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7,ar;q=0.6",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

REQUEST_TIMEOUT_SECONDS = 15

# Polite rate limiting: base delay plus random jitter between requests.
MIN_DELAY_SECONDS = 2.0
MAX_DELAY_SECONDS = 5.0

# Hard safety cap so a bad --max-pages value (or a runaway "next page" loop)
# can't hammer the site. This is a personal, low-volume price tracker.
MAX_PAGES_HARD_LIMIT = 5

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("bringo_scraper")


# ------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------

def polite_sleep() -> None:
    """Sleep a random, polite interval between requests."""
    delay = random.uniform(MIN_DELAY_SECONDS, MAX_DELAY_SECONDS)
    logger.debug("Sleeping %.2fs before next request", delay)
    time.sleep(delay)


def parse_price_mad(raw_text: str) -> Decimal | None:
    """
    Extract a MAD price from a raw price string like "12,50 DH", "12.50 MAD",
    or "Prix: 12,50 Dh". Returns None if no number could be parsed.
    """
    if not raw_text:
        return None
    # Keep digits, comma, and dot; Moroccan sites often use comma as the
    # decimal separator (e.g. "12,50").
    cleaned = re.sub(r"[^\d,.\s]", "", raw_text).strip()
    cleaned = cleaned.replace(" ", "")
    if not cleaned:
        return None

    # If both comma and dot are present, assume dot is a thousands separator
    # and comma is the decimal separator (common in French-locale pricing).
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")

    try:
        return Decimal(cleaned)
    except InvalidOperation:
        logger.warning("Could not parse price from raw text: %r", raw_text)
        return None


def fetch_page(session: requests.Session, url: str) -> BeautifulSoup | None:
    """Fetch a URL and return parsed BeautifulSoup, or None on failure."""
    try:
        response = session.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.exceptions.RequestException as exc:
        logger.error("Request to %s failed: %s", url, exc)
        return None

    try:
        return BeautifulSoup(response.text, "html.parser")
    except Exception as exc:  # noqa: BLE001 - defensive, malformed HTML
        logger.error("Failed to parse HTML from %s: %s", url, exc)
        return None


def parse_product_card(card, search_term: str) -> dict | None:
    """
    Parse a single product card element into a row dict for price_history.
    Returns None (and logs a warning) if the card is missing required fields
    rather than raising, so one bad card never crashes the whole run.
    """
    try:
        title_el = card.select_one(SELECTORS["title"])
        price_el = card.select_one(SELECTORS["price"])
        unit_el = card.select_one(SELECTORS["unit"])
        image_el = card.select_one(SELECTORS["image"])
        link_el = card.select_one(SELECTORS["link"])

        if title_el is None or price_el is None:
            logger.warning(
                "Skipping product card: missing title or price element "
                "(selectors may be out of date — see SELECTORS caveat)"
            )
            return None

        title = title_el.get_text(strip=True)
        price_mad = parse_price_mad(price_el.get_text(strip=True))
        if not title or price_mad is None:
            logger.warning("Skipping product card: empty title or unparsable price (title=%r)", title)
            return None

        unit = unit_el.get_text(strip=True) if unit_el else None

        image_url = None
        if image_el is not None:
            image_url = image_el.get("src") or image_el.get("data-src")
            if image_url:
                image_url = urljoin(BASE_URL, image_url)

        product_url = None
        if link_el is not None:
            href = link_el.get("href")
            if href:
                product_url = urljoin(BASE_URL, href)

        return {
            "search_term": search_term,
            "product_title": title,
            "price_mad": price_mad,
            "unit": unit,
            "image_url": image_url,
            "product_url": product_url,
        }
    except Exception as exc:  # noqa: BLE001 - never let one bad card kill the run
        logger.warning("Failed to parse a product card, skipping it: %s", exc)
        return None


def scrape_search_results(search_term: str, max_pages: int = 1) -> list[dict]:
    """
    Scrape up to `max_pages` of bringo.ma search results for `search_term`.
    Returns a list of product row dicts ready for insertion.
    """
    max_pages = max(1, min(max_pages, MAX_PAGES_HARD_LIMIT))

    session = requests.Session()
    products: list[dict] = []
    url = SEARCH_URL_TEMPLATE.format(query=quote(search_term))

    for page_num in range(1, max_pages + 1):
        logger.info("Fetching page %d for search term %r: %s", page_num, search_term, url)
        soup = fetch_page(session, url)
        if soup is None:
            logger.error("Aborting further pagination for %r after fetch failure", search_term)
            break

        cards = soup.select(SELECTORS["product_card"])
        if not cards:
            logger.warning(
                "No product cards found on page %d (selector %r may be wrong "
                "or there are no more results) — see SELECTORS caveat",
                page_num,
                SELECTORS["product_card"],
            )
            break

        logger.info("Found %d product card(s) on page %d", len(cards), page_num)
        for card in cards:
            row = parse_product_card(card, search_term)
            if row is not None:
                products.append(row)

        next_link = soup.select_one(SELECTORS["next_page"])
        next_href = next_link.get("href") if next_link else None
        if not next_href or page_num >= max_pages:
            break

        url = urljoin(BASE_URL, next_href)
        polite_sleep()

    logger.info("Scraped %d product row(s) total for search term %r", len(products), search_term)
    return products


# ------------------------------------------------------------------------
# Database
# ------------------------------------------------------------------------

def insert_price_rows(rows: list[dict]) -> int:
    """
    Insert scraped rows into price_history using DATABASE_URL. Returns the
    number of rows successfully inserted. A failure on one row is logged and
    skipped rather than aborting the whole batch.
    """
    if not rows:
        logger.info("No rows to insert.")
        return 0

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL is not set (checked environment and .env). Aborting insert.")
        return 0

    inserted = 0
    conn = None
    try:
        conn = psycopg2.connect(database_url)
        conn.autocommit = False
        with conn.cursor() as cur:
            for row in rows:
                try:
                    cur.execute(
                        """
                        INSERT INTO price_history
                            (search_term, product_title, price_mad, unit, image_url, product_url)
                        VALUES (%(search_term)s, %(product_title)s, %(price_mad)s,
                                %(unit)s, %(image_url)s, %(product_url)s)
                        """,
                        row,
                    )
                    inserted += 1
                except psycopg2.Error as exc:
                    logger.error("Failed to insert row for %r: %s", row.get("product_title"), exc)
                    conn.rollback()
                    continue
            conn.commit()
    except psycopg2.Error as exc:
        logger.error("Database connection/operation failed: %s", exc)
        if conn is not None:
            conn.rollback()
    finally:
        if conn is not None:
            conn.close()

    logger.info("Inserted %d/%d row(s) into price_history", inserted, len(rows))
    return inserted


# ------------------------------------------------------------------------
# CLI entry point
# ------------------------------------------------------------------------

def main() -> int:
    load_dotenv()  # loads .env if present; existing env vars take precedence

    parser = argparse.ArgumentParser(
        description="Scrape bringo.ma search results and store prices in price_history."
    )
    parser.add_argument("search_term", help='Search term, e.g. "Lait"')
    parser.add_argument(
        "--max-pages",
        type=int,
        default=1,
        help=f"Max result pages to fetch (default 1, hard-capped at {MAX_PAGES_HARD_LIMIT}). "
        "Keep this low — this is a polite, low-volume personal scraper.",
    )
    args = parser.parse_args()

    search_term = args.search_term.strip()
    if not search_term:
        logger.error("search_term must not be empty")
        return 1

    logger.info("Starting bringo.ma scrape for %r", search_term)
    products = scrape_search_results(search_term, max_pages=args.max_pages)
    insert_price_rows(products)
    logger.info("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
