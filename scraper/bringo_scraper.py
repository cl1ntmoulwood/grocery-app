#!/usr/bin/env python3
"""
bringo_scraper.py — Standalone price scraper for bringo.ma category search
results.

Part of the Family Pantry & Local Price Tracker project. This script is
intentionally NOT invoked by the backend API (see backend/src/routes/inventory.js
POST /inventory/sync, which is a 501 stub on purpose). Run it manually or via
cron on the home server to populate the `price_history` table over time.

Usage:
    python bringo_scraper.py "LAIT UHT" --category produits-laitiers-oeufs-8
    python bringo_scraper.py "LAIT" --category produits-laitiers-oeufs-8 \
        --store carrefour-supermarket-market-yaacoub-al-mansour --max-pages 2
    python bringo_scraper.py --store carrefour-hypermarket-carrefour-sidi-maarouf \
        --all-categories
        (sweeps every known top-level category for that store in one run —
        see STORE_CATEGORIES. Run once per store to cover all 4 verified
        Carrefour branches; results pool together in price_history since
        category labels are canonicalized the same way regardless of store.)

Requires DATABASE_URL in the environment or a local .env file, e.g.:
    DATABASE_URL=postgres://pantry:pantry@localhost:5432/pantry

===============================================================================
VERIFIED AGAINST THE REAL SITE (2026) — read this before changing SELECTORS

Earlier versions of this script guessed at a generic Magento/PrestaShop-style
search URL and CSS selectors, and were confirmed broken (404s, empty pages).
This version is built from real, captured bringo.ma HTML (a live product
card's outerHTML, via browser DevTools) and a confirmed-working request
(via a captured curl command), not guesses. What's confirmed:

  - The site runs on Sylius (a Symfony e-commerce framework), not Magento/
    PrestaShop. Product search markup uses Constructor.io tracking
    attributes (data-cnstrc-*), which conveniently double as a clean,
    reliable source for title/price — no fragile text parsing needed.
  - The working URL shape is:
        https://www.bringo.ma/fr_MA/store/{store}/{category}
            ?criteria[search][value]={term}
    This requires BOTH a specific store slug AND a specific category slug
    (with its numeric ID suffix, e.g. "produits-laitiers-oeufs-8") — there
    is no site-wide keyword search. Searching a term against the wrong
    category returns zero results (confirmed: searching "PAIN" inside the
    dairy category returns "Il n'y a aucun résultat à afficher", not bread
    products) — the search filters WITHIN the given category, it does not
    search the whole catalog.
  - No delivery-address selection or login/session cookie was required to
    fetch real product data this way — a plain unauthenticated GET works.

WHAT'S STILL UNVERIFIED:
  - Pagination: robots.txt disallows crawling "*?page=" which implies a
    `page` query param exists, but the exact behavior (1-indexed? what
    happens past the last page?) was not directly observed. Keep
    --max-pages low and sanity-check results if you rely on page 2+.
  - Category IDs are per-category, not per-search-term. You need to find
    the right category slug+id for whatever you want to track — either by
    browsing bringo.ma yourself and copying the URL segment after
    `/store/{store}/`, or from the category sitemap:
        https://bringo.ma/sitemaps/sitemaps-generic/sitemap-generic-category-ma.xml
  - Beyond the original branch (carrefour-supermarket-market-yaacoub-al-
    mansour), three more branches were individually verified the same way
    (real request, product cards confirmed present): carrefour-express-
    express-val-fleury, carrefour-supermarket-gourmet-velodrome, and
    carrefour-hypermarket-carrefour-sidi-maarouf. Their top-level category
    slug+id lists are in STORE_CATEGORIES below — each store *format*
    (express/supermarket/hypermarket) has its own category IDs, so the
    same logical category (e.g. dairy) has a different numeric suffix per
    format. Other, unlisted store slugs are still unverified.
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
import urllib.parse
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
DEFAULT_STORE = "carrefour-supermarket-market-yaacoub-al-mansour"

# Confirmed working shape: /fr_MA/store/{store}/{category}?criteria[search][value]={term}
SEARCH_URL_TEMPLATE = f"{BASE_URL}/fr_MA/store/{{store}}/{{category}}"

# Per-store category slug+id lists, for --all-categories: each store
# format's 13-18 top-level departments (e.g. "produits-laitiers-oeufs-8")
# PLUS their direct subcategories (e.g. "beurres", "fromages-4",
# "lait-oeufs"), two levels deep. Each store format (express/supermarket/
# hypermarket) has its own category IDs in bringo's catalog, so the same
# logical (sub)category shows up under a different numeric suffix per
# format — e.g. "produits-laitiers-oeufs-8" (supermarket) vs "-9"
# (hypermarket) vs "-11" (express), and some subcategory slugs have no
# numeric suffix at all (e.g. "beurres" on supermarket). These were
# discovered from each department's own product-listing page (the
# "bringo-product-listing-category-menu" nav block lists both sibling
# departments and the current department's children) and individually
# verified — sampled slugs from each list were confirmed to return real
# product cards, not guessed. See the module docstring for the general
# caveat about category IDs, and robots.txt's Disallow on *?page= and
# *?limit= for why this stops at page 1 / no --max-pages bump rather than
# also paginating within each (sub)category.
#
# "carrefour-supermarket-gourmet-velodrome" is a supermarket-format branch
# (despite the "gourmet" in its name) and was confirmed to use the exact
# same category IDs as the other supermarket branch, so it reuses the list
# below rather than duplicating it.
_SUPERMARKET_CATEGORIES = [
    "accessoires-de-menage-25",
    "alimentation-bebe",
    "animaux-4",
    "art-de-table-79",
    "barres-cereales-proteinees-1",
    "beurres",
    "biscuits-16",
    "boissons-24",
    "bonbons-chewings-gum-1",
    "boucherie-28",
    "boulangerie-27",
    "boulangerie-patisserie",
    "cereales-40",
    "cereales-biscuits-confiseries-1",
    "charcuterie-1",
    "charcuterie-74",
    "charcuterie-a-la-coupe-26",
    "chats-27",
    "chiens-35",
    "chocolats-9",
    "conserves-bocaux-1",
    "couches-bebe-28",
    "cremes-preparations-culinaires",
    "desodorisants-incecticides",
    "eaux-55",
    "eaux-boissons-12",
    "emballages-menagers-essuie-tout",
    "enfants",
    "entretien-nettoyage-14",
    "epicerie-4",
    "farines-preparation-patisserie-1",
    "fromages-4",
    "fromages-a-la-coupe-36",
    "fruits-44",
    "fruits-secs-8",
    "glaces-59",
    "glaces-surgele-4",
    "hommes",
    "huiles-4",
    "hygiene-beaute-12",
    "hygiene-dentaire",
    "hygiene-intime",
    "hygiene-soin-1",
    "jus-19",
    "lait-oeufs",
    "legumes-43",
    "lessives-soin-du-linge",
    "ma-cuisine-12",
    "maquillage",
    "monde-bebe",
    "mon-marche-7",
    "papier-toilette-mouchoirs",
    "pates-riz-feculents-1",
    "patisserie-21",
    "petit-dejeuner-128",
    "poissonnerie-59",
    "premiers-soins-preservatifs",
    "produits-laitiers-oeufs-8",
    "produits-nettoyants",
    "produits-solaires-auto-bronzants",
    "sauces-chaudes-1",
    "sauces-froides-1",
    "saveurs-du-monde-1",
    "sel-epices-bouillons-1",
    "sirops-28",
    "snacking-sale-63",
    "soins-des-cheveux",
    "soins-du-corps-56",
    "soins-du-visage-63",
    "soupes-croutons-chapelure-1",
    "sucres-1",
    "surgele-75",
    "thes-boissons-glacees-5",
    "tout-pour-votre-cuisine-3",
    "vinaigres-condiments-1",
    "volaille-21",
    "yaourts-desserts-3",
]

STORE_CATEGORIES = {
    "carrefour-express-express-val-fleury": [
        "accessoires-de-menage-28",
        "alimentation-bebe-3",
        "animaux-8",
        "barres-cereales-proteinees",
        "beurres-2",
        "biscuits-19",
        "boissons-26",
        "bonbons-chewings-gum-2",
        "boulangerie-32",
        "boulangerie-patisserie-3",
        "cereales-44",
        "cereales-biscuits-confiseries-2",
        "charcuterie-71",
        "charcuterie-73",
        "charcuterie-a-la-coupe-28",
        "chats-32",
        "chiens-40",
        "chocolats-10",
        "conserves-bocaux-3",
        "couches-bebe-31",
        "cremes-preparations-culinaires-2",
        "desodorisants-incecticides-2",
        "eaux-62",
        "eaux-boissons-13",
        "emballages-menagers-essuie-tout-2",
        "enfants-3",
        "entretien-nettoyage-17",
        "epicerie-137",
        "farines-preparation-patisserie-3",
        "fromages-7",
        "fromages-a-la-coupe-41",
        "fruits-53",
        "fruits-secs-50",
        "glaces-67",
        "glaces-surgele-6",
        "hommes-2",
        "huiles-46",
        "hygiene-beaute-14",
        "hygiene-dentaire-3",
        "hygiene-intime-2",
        "hygiene-soin-2",
        "jus-22",
        "lait-oeufs-2",
        "legumes-50",
        "monde-bebe-3",
        "mon-marche-10",
        "papier-toilette-mouchoirs-2",
        "pates-riz-feculents-3",
        "petit-dejeuner-143",
        "poissonnerie-64",
        "premiers-soins-preservatifs-3",
        "produits-laitiers-oeufs-11",
        "produits-nettoyants-2",
        "produits-solaires-auto-bronzants-2",
        "sauces-chaudes-3",
        "sauces-froides-3",
        "saveurs-du-monde-3",
        "sel-epices-bouillons-3",
        "sirops-36",
        "snacking-sale-67",
        "soins-des-cheveux-2",
        "soins-du-corps-61",
        "soins-du-visage-70",
        "soupes-croutons-chapelure-3",
        "sucres-22",
        "surgele-82",
        "thes-boissons-glacees-8",
        "vinaigres-condiments-3",
        "volaille-25",
        "yaourts-desserts-6",
    ],
    "carrefour-supermarket-market-yaacoub-al-mansour": _SUPERMARKET_CATEGORIES,
    "carrefour-supermarket-gourmet-velodrome": _SUPERMARKET_CATEGORIES,
    "carrefour-hypermarket-carrefour-sidi-maarouf": [
        "accessoires-de-menage-26",
        "alimentation-bebe-1",
        "ampoules-piles-multiprises-1",
        "animaux-5",
        "appareils-de-coiffure-1",
        "appareils-de-cuisson-35",
        "art-de-table-81",
        "audio-son-2",
        "auto-moto-bricolage-1",
        "bagagerie-25",
        "barres-cereales-proteinees-2",
        "beurres-1",
        "biscuits-14",
        "boissons-23",
        "bonbons-chewings-gum",
        "boucherie-29",
        "boulangerie-28",
        "boulangerie-patisserie-1",
        "cereales-39",
        "cereales-biscuits-confiseries",
        "charcuterie-3",
        "charcuterie-75",
        "charcuterie-a-la-coupe-27",
        "chats-28",
        "chauffages-ventilateurs-1",
        "chiens-36",
        "chocolats-8",
        "claviers-souris-1",
        "conserves-bocaux",
        "couches-bebe-29",
        "coupe-du-monde-1",
        "cremes-preparations-culinaires-1",
        "decoration-5",
        "desodorisants-incecticides-1",
        "droguerie-1",
        "eaux-54",
        "eaux-boissons-11",
        "emballages-menagers-essuie-tout-1",
        "enfants-1",
        "entretien-de-la-maison-30",
        "entretien-nettoyage-15",
        "epicerie-9",
        "farines-preparation-patisserie",
        "fournitures-scolaires-29",
        "fromages-5",
        "fromages-a-la-coupe-37",
        "fruits-46",
        "fruits-secs-9",
        "glaces-60",
        "glaces-surgele-5",
        "high-tech-multimedia",
        "hommes-1",
        "huiles-9",
        "hygiene-beaute-13",
        "hygiene-dentaire-1",
        "hygiene-intime-1",
        "hygiene-soin",
        "jardin-amenagement-dexterieur",
        "jouets-25",
        "jus-18",
        "kasa-by-carrefour-5",
        "kasa-by-carrefour-6",
        "lait-oeufs-1",
        "legumes-45",
        "lessives-soin-du-linge-1",
        "librairie-jouets-1",
        "linge-de-lit-26",
        "ma-cuisine-13",
        "ma-maison-2",
        "maquillage-1",
        "monde-bebe-1",
        "mon-marche-8",
        "objets-connectes-6",
        "papier-toilette-mouchoirs-1",
        "pates-riz-feculents",
        "patisserie-22",
        "pese-personne-balance-connectee-9",
        "petit-dejeuner-127",
        "petit-dejeuner-130",
        "plateaux-de-fromages",
        "poissonnerie-60",
        "premiers-soins-preservatifs-1",
        "preparation-culinaire-34",
        "produits-laitiers-oeufs-9",
        "produits-nettoyants-1",
        "produits-solaires-auto-bronzants-1",
        "sauces-chaudes",
        "sauces-froides",
        "saveurs-du-monde",
        "sel-epices-bouillons",
        "sirops-27",
        "snacking-sale-62",
        "soins-des-cheveux-1",
        "soins-du-corps-57",
        "soins-du-visage-64",
        "soupes-croutons-chapelure",
        "stockage-informatique-6",
        "sucres-3",
        "surgele-76",
        "textiles-de-bain-1",
        "thes-boissons-glacees-4",
        "tout-pour-votre-cuisine-4",
        "vetements-accessoires-bebe",
        "vetements-enfants-1",
        "vetements-femme-7",
        "vetements-homme-7",
        "vetements-textile-1",
        "vinaigres-condiments",
        "volaille-22",
        "yaourts-desserts-4",
    ],
}

SELECTORS = {
    "product_card": "div.box-product",
    "link": "a.bringo-product-name",
    "image": "img.image-product",
    # Fallback text selector, used only if the data-cnstrc-item-price
    # attribute is ever missing from a card.
    "price_fallback": ".bringo-product-price",
}

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

# Hard safety cap so a bad --max-pages value can't hammer the site. This is
# a personal, low-volume price tracker, and pagination behavior here is
# unverified (see docstring) — keep this conservative.
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
    Fallback price parser for the visible ".bringo-product-price" text
    (e.g. "59,95 MAD"), only used if a card is missing the
    data-cnstrc-item-price attribute. Moroccan sites use comma as the
    decimal separator.
    """
    if not raw_text:
        return None
    cleaned = re.sub(r"[^\d,.\s]", "", raw_text).strip().replace(" ", "").replace("\xa0", "")
    if not cleaned:
        return None
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        logger.warning("Could not parse price from raw text: %r", raw_text)
        return None


def build_search_url(store: str, category: str, search_term: str | None, page: int) -> str:
    """
    If search_term is None, no search filter is applied and the category's
    default product listing is returned (confirmed: a category URL with no
    query params shows its normal product listing, not an empty page).
    """
    base = SEARCH_URL_TEMPLATE.format(store=store, category=category)
    params = {}
    if search_term:
        params["criteria[search][value]"] = search_term
    if page > 1:
        params["page"] = str(page)
    if not params:
        return base
    return f"{base}?{urllib.parse.urlencode(params)}"


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
    Parse a single .box-product card into a row dict for price_history.
    Prefers the data-cnstrc-item-name / data-cnstrc-item-price attributes
    (clean, structured, and directly on the card) over text scraping.
    Returns None (and logs a warning) if the card is missing required
    fields, so one bad card never crashes the whole run.
    """
    try:
        title = card.get("data-cnstrc-item-name")
        price_attr = card.get("data-cnstrc-item-price")

        price_mad = None
        if price_attr:
            try:
                price_mad = Decimal(price_attr)
            except InvalidOperation:
                price_mad = None
        if price_mad is None:
            # Fallback to the visible price text if the attribute is
            # missing or unparsable.
            price_el = card.select_one(SELECTORS["price_fallback"])
            price_mad = parse_price_mad(price_el.get_text(strip=True)) if price_el else None

        if not title or price_mad is None:
            logger.warning(
                "Skipping product card: missing title or unparsable price "
                "(title=%r, price_attr=%r) — markup may have changed, see SELECTORS caveat",
                title,
                price_attr,
            )
            return None

        link_el = card.select_one(SELECTORS["link"])
        product_url = urljoin(BASE_URL, link_el["href"]) if link_el and link_el.get("href") else None

        image_el = card.select_one(SELECTORS["image"])
        image_url = image_el.get("src") if image_el else None
        if image_url:
            image_url = urljoin(BASE_URL, image_url)

        return {
            "search_term": search_term,
            "product_title": title,
            "price_mad": price_mad,
            "unit": None,  # no separate unit field in the markup; it's embedded in the title
            "image_url": image_url,
            "product_url": product_url,
        }
    except Exception as exc:  # noqa: BLE001 - never let one bad card kill the run
        logger.warning("Failed to parse a product card, skipping it: %s", exc)
        return None


def scrape_search_results(
    store: str, category: str, search_term: str | None, max_pages: int = 1
) -> list[dict]:
    """
    Scrape up to `max_pages` of bringo.ma results for `search_term` within
    `category` at `store`. If `search_term` is None, no filter is applied
    and the category's own slug is used as the stored search_term label
    instead (so results are still findable via the Prices tab by category
    name). Returns a list of product row dicts ready for insertion. Stops
    as soon as a page yields zero product cards (used as the pagination
    end signal, since "next page" link behavior is unverified — see
    docstring).
    """
    max_pages = max(1, min(max_pages, MAX_PAGES_HARD_LIMIT))
    # Strip a trailing numeric ID suffix (e.g. "produits-laitiers-oeufs-8" ->
    # "produits-laitiers-oeufs") so the stored label is a clean, consistent
    # category name regardless of whether this particular category needed
    # an ID suffix in its URL.
    label = search_term or re.sub(r"-\d+$", "", category)

    session = requests.Session()
    products: list[dict] = []

    for page_num in range(1, max_pages + 1):
        url = build_search_url(store, category, search_term, page_num)
        logger.info("Fetching page %d for %r: %s", page_num, label, url)
        soup = fetch_page(session, url)
        if soup is None:
            logger.error("Aborting further pagination for %r after fetch failure", label)
            break

        cards = soup.select(SELECTORS["product_card"])
        if not cards:
            logger.info(
                "No product cards found on page %d — treating as end of results "
                "(or the category/search term has no matches)",
                page_num,
            )
            break

        logger.info("Found %d product card(s) on page %d", len(cards), page_num)
        for card in cards:
            row = parse_product_card(card, label)
            if row is not None:
                products.append(row)

        if page_num < max_pages:
            polite_sleep()

    logger.info("Scraped %d product row(s) total for %r", len(products), label)
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
        description="Scrape bringo.ma category search results and store prices in price_history."
    )
    parser.add_argument(
        "search_term",
        nargs="?",
        default=None,
        help=(
            'Optional search term, e.g. "LAIT UHT" (filters WITHIN --category). '
            "If omitted, scrapes the category's full default product listing instead, "
            "and the category slug is used as the stored search_term label."
        ),
    )
    parser.add_argument(
        "--category",
        help=(
            "Category slug+id, e.g. produits-laitiers-oeufs-8 — required unless "
            "--all-categories is given, there is no site-wide search. Find it by "
            "browsing bringo.ma and copying the URL segment after /store/{store}/, "
            "or from the category sitemap (see docstring)."
        ),
    )
    parser.add_argument(
        "--all-categories",
        action="store_true",
        help=(
            "Sweep every known top-level category for --store (see STORE_CATEGORIES) "
            "in one run instead of a single --category. Mutually exclusive with "
            "--category. Only works for the 4 stores listed in STORE_CATEGORIES."
        ),
    )
    parser.add_argument(
        "--store",
        default=DEFAULT_STORE,
        help=f"Store slug (default: {DEFAULT_STORE}). Verified stores: "
        f"{', '.join(STORE_CATEGORIES)}.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=1,
        help=f"Max result pages to fetch (default 1, hard-capped at {MAX_PAGES_HARD_LIMIT}). "
        "Pagination behavior is unverified — keep this low. This is a polite, "
        "low-volume personal scraper, not a crawler.",
    )
    args = parser.parse_args()

    if args.all_categories == bool(args.category):
        parser.error("Pass exactly one of --category or --all-categories.")

    search_term = args.search_term.strip() if args.search_term else None

    if args.all_categories:
        categories = STORE_CATEGORIES.get(args.store)
        if not categories:
            parser.error(
                f"--all-categories has no known category list for store {args.store!r}. "
                f"Known stores: {', '.join(STORE_CATEGORIES)}."
            )
        logger.info(
            "Starting bringo.ma sweep: store=%r categories=%d term=%r",
            args.store,
            len(categories),
            search_term or "(none — full category listings)",
        )
        total_inserted = 0
        for i, category in enumerate(categories, start=1):
            logger.info("[%d/%d] category=%r", i, len(categories), category)
            products = scrape_search_results(args.store, category, search_term, max_pages=args.max_pages)
            total_inserted += insert_price_rows(products)
            if i < len(categories):
                polite_sleep()
        logger.info("Done. Inserted %d row(s) total across %d categories.", total_inserted, len(categories))
        return 0

    logger.info(
        "Starting bringo.ma scrape: store=%r category=%r term=%r",
        args.store,
        args.category,
        search_term or "(none — full category listing)",
    )
    products = scrape_search_results(args.store, args.category, search_term, max_pages=args.max_pages)
    insert_price_rows(products)
    logger.info("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
