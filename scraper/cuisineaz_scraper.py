#!/usr/bin/env python3
"""
cuisineaz_scraper.py — Standalone recipe scraper for cuisineaz.com.

Part of the Family Pantry & Local Price Tracker project. Like
bringo_scraper.py, this script is intentionally NOT invoked by the backend
API — run it manually or via cron on the home server to grow the `recipes`
table over time. A personal, low-volume, household import, not a crawler.

Usage:
    python cuisineaz_scraper.py --limit 20
    python cuisineaz_scraper.py --limit 50 --category-filter desserts

Requires DATABASE_URL in the environment or a local .env file, e.g.:
    DATABASE_URL=postgres://pantry:pantry@localhost:5432/pantry

===============================================================================
VERIFIED AGAINST THE REAL SITE (2026) — read this before changing anything

  - robots.txt (https://www.cuisineaz.com/robots.txt) disallows a generic
    /recettes/recette-<digit>... pattern, but real recipe URLs are shaped
    like /recettes/crepe-facile-78347.aspx (descriptive slug + numeric id)
    — confirmed NOT matched by that rule, and not disallowed anywhere else.
    No crawl-delay is specified for a generic user-agent; we rate-limit
    politely anyway (see polite_sleep()).
  - Every recipe page ships a full schema.org/Recipe block in a
    <script type="application/ld+json"> tag, inside a top-level "@graph"
    array alongside ItemList/FAQPage entries — find the one with
    "@type": "Recipe". Fields used here: name, description, image (string
    OR list of strings — take the first), recipeYield, recipeIngredient
    (list of free-text strings like "250 g Farine"), recipeInstructions
    (list of {"@type": "HowToStep", "name", "text"} objects — already
    cleanly split into steps, no HTML prose-scraping needed).
  - https://www.cuisineaz.com/xml/sitemap.xml is a sitemap index pointing
    at 10 recipe sub-sitemaps (sitemap-cuisineaz-recette-1.xml … -10.xml,
    ~90,000 recipe URLs total as of 2026-08). This script discovers that
    count at runtime rather than hardcoding it, and logs a warning if it
    differs from what's documented here.
  - A real category-listing page like /categories/desserts/ 404s — only
    fully-qualified leaf category URLs with a numeric id suffix exist
    (e.g. /categories/desserts/patisseries/buches/buche-aux-fruits-cat48992).
    Crawling those for recipe discovery was ruled out as fragile for no
    real benefit over the sitemaps; --category-filter instead does a
    lightweight substring match against each recipe's own recipeCategory/
    keywords fields, checked after fetching.
===============================================================================
"""

import argparse
import logging
import os
import random
import re
import sys
import time
import xml.etree.ElementTree as ET

import psycopg2
import requests
from dotenv import load_dotenv

SITEMAP_INDEX_URL = "https://www.cuisineaz.com/xml/sitemap.xml"
EXPECTED_RECIPE_SITEMAP_COUNT = 10  # see docstring — logged as a warning, not fatal, if this drifts

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

REQUEST_TIMEOUT_SECONDS = 15

# Polite rate limiting: base delay plus random jitter between requests.
MIN_DELAY_SECONDS = 2.0
MAX_DELAY_SECONDS = 5.0

# Hard safety cap so a mistyped --limit can't hammer the site. This is a
# personal, low-volume recipe import, not a crawler.
LIMIT_HARD_CAP = 200

# --top mode fetches more candidates than it keeps (to rank by rating), so
# it needs its own, higher hard cap — still bounded, not "scan everything".
SCAN_LIMIT_HARD_CAP = 1000

# recipeIngredient strings mix quantity + unit + name with no consistent
# delimiter, e.g. "250 g Farine", "3 Œuf(s)", "1 pincée(s) Sel". The token
# right after the leading number is treated as the unit only if it's one
# of these known French cooking units; otherwise it's folded into the name.
KNOWN_UNITS = {
    "g", "kg", "mg", "ml", "cl", "l", "litre", "litres",
    "c.", "cuillère(s)", "cuillères", "cuillère",
    "sachet(s)", "pincée(s)", "gousse(s)", "tranche(s)", "branche(s)",
    "botte(s)", "boîte(s)", "boite(s)", "verre(s)", "tasse(s)", "pot(s)",
    "pièce(s)", "piece(s)", "unité(s)", "unite(s)", "feuille(s)", "brin(s)",
}

INGREDIENT_LEADING_NUMBER_RE = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s+(.*)$")
YIELD_LEADING_NUMBER_RE = re.compile(r"(\d+)")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cuisineaz_scraper")


# ------------------------------------------------------------------------
# HTTP / sitemap discovery
# ------------------------------------------------------------------------

def polite_sleep() -> None:
    """Sleep a random, polite interval between requests."""
    delay = random.uniform(MIN_DELAY_SECONDS, MAX_DELAY_SECONDS)
    logger.debug("Sleeping %.2fs before next request", delay)
    time.sleep(delay)


def fetch_text(session: requests.Session, url: str) -> str | None:
    """Fetch a URL and return its response text, or None on failure."""
    try:
        response = session.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        return response.text
    except requests.exceptions.RequestException as exc:
        logger.error("Request to %s failed: %s", url, exc)
        return None


def fetch_bytes(session: requests.Session, url: str) -> bytes | None:
    """Fetch a URL and return its raw response bytes, or None on failure.
    Used for XML (sitemaps): the server doesn't declare a charset, so
    requests' `.text` guesses Latin-1 and mangles the UTF-8 BOM these
    sitemaps start with. ElementTree.fromstring() on raw bytes correctly
    auto-detects encoding from the BOM/XML declaration instead."""
    try:
        response = session.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        return response.content
    except requests.exceptions.RequestException as exc:
        logger.error("Request to %s failed: %s", url, exc)
        return None


def discover_recipe_sitemap_urls(session: requests.Session) -> list[str]:
    """Fetch the sitemap index and return the recipe sub-sitemap URLs."""
    xml_bytes = fetch_bytes(session, SITEMAP_INDEX_URL)
    if xml_bytes is None:
        return []

    root = ET.fromstring(xml_bytes)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    locs = [el.text for el in root.findall(".//sm:loc", ns) if el.text]
    recipe_sitemaps = [loc for loc in locs if "sitemap-cuisineaz-recette-" in loc]

    if len(recipe_sitemaps) != EXPECTED_RECIPE_SITEMAP_COUNT:
        logger.warning(
            "Expected %d recipe sub-sitemaps, found %d — site structure may have changed.",
            EXPECTED_RECIPE_SITEMAP_COUNT,
            len(recipe_sitemaps),
        )
    return recipe_sitemaps


def discover_recipe_urls(session: requests.Session, sitemap_url: str) -> list[str]:
    """Fetch one recipe sub-sitemap and return its recipe page URLs."""
    xml_bytes = fetch_bytes(session, sitemap_url)
    if xml_bytes is None:
        return []

    root = ET.fromstring(xml_bytes)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    return [el.text for el in root.findall(".//sm:loc", ns) if el.text]


# ------------------------------------------------------------------------
# Recipe page parsing
# ------------------------------------------------------------------------

def extract_recipe_jsonld(html: str) -> dict | None:
    """Find the schema.org Recipe object inside the page's ld+json @graph."""
    import json

    for match in re.finditer(
        r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL
    ):
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue

        graph = data.get("@graph") if isinstance(data, dict) else None
        if not isinstance(graph, list):
            continue

        for item in graph:
            if isinstance(item, dict) and item.get("@type") == "Recipe":
                return item

    return None


def parse_ingredient(raw: str) -> dict:
    """Best-effort split of a free-text ingredient line into qty/unit/name."""
    raw = raw.strip()
    match = INGREDIENT_LEADING_NUMBER_RE.match(raw)
    if not match:
        return {"ingredient_name": raw, "quantity_needed": 1, "unit": None}

    quantity_str, rest = match.groups()
    quantity = float(quantity_str.replace(",", "."))

    tokens = rest.split(maxsplit=1)
    if tokens and tokens[0].rstrip(".").lower() in KNOWN_UNITS:
        unit = tokens[0]
        name = tokens[1] if len(tokens) > 1 else ""
    else:
        unit = None
        name = rest

    name = name.strip() or raw
    return {"ingredient_name": name, "quantity_needed": quantity, "unit": unit}


def parse_yield(raw) -> int | None:
    """Extract a leading integer from recipeYield, e.g. "6" or "6 parts"."""
    if raw is None:
        return None
    match = YIELD_LEADING_NUMBER_RE.search(str(raw))
    return int(match.group(1)) if match else None


def first_image_url(raw) -> str | None:
    if isinstance(raw, list):
        return raw[0] if raw else None
    if isinstance(raw, str):
        return raw
    return None


HTML_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(raw: str) -> str:
    """recipeInstructions[].text ships wrapped in a <p>...</p> tag (verified
    on real pages) — the frontend does its own escapeHtml() on this text for
    safe display, which would otherwise show the literal tag characters
    instead of rendering them, so strip markup here at import time."""
    return HTML_TAG_RE.sub("", raw).strip()


def parse_recipe(recipe_ld: dict, source_url: str) -> dict:
    """Convert a schema.org Recipe object into our DB row shapes."""
    ingredients = [parse_ingredient(raw) for raw in recipe_ld.get("recipeIngredient", []) if isinstance(raw, str)]

    steps = []
    for i, step in enumerate(recipe_ld.get("recipeInstructions", []), start=1):
        if isinstance(step, dict):
            steps.append({"step_number": i, "name": step.get("name"), "text": strip_html(step.get("text", ""))})
        elif isinstance(step, str):
            steps.append({"step_number": i, "name": None, "text": strip_html(step)})
    steps = [s for s in steps if s["text"]]

    rating = recipe_ld.get("aggregateRating") or {}
    try:
        rating_value = float(rating.get("ratingValue"))
    except (TypeError, ValueError):
        rating_value = None
    try:
        review_count = int(rating.get("reviewCount"))
    except (TypeError, ValueError):
        review_count = 0

    return {
        "title": (recipe_ld.get("name") or "").strip(),
        "description": strip_html(recipe_ld.get("description") or "") or None,
        "image_url": first_image_url(recipe_ld.get("image")),
        "source_url": source_url,
        "servings": parse_yield(recipe_ld.get("recipeYield")),
        "ingredients": ingredients,
        "steps": steps,
        "category_text": " ".join(
            filter(None, [recipe_ld.get("recipeCategory"), recipe_ld.get("keywords")])
        ).lower(),
        "rating_value": rating_value,
        "review_count": review_count,
    }


def derive_title_guess(url: str) -> tuple[str, str]:
    """Extract the slug from a recipe URL and de-hyphenate it into a
    readable title guess, e.g. .../crepe-facile-78347.aspx -> ("crepe-facile-78347", "Crepe Facile 78347").
    Same technique as prices.js's prettifyCategory — good enough to pick
    the right recipe from a short list, not meant to be perfect (no
    accents/real capitalization, since that requires fetching the page)."""
    slug = url.rstrip("/").rsplit("/", 1)[-1].removesuffix(".aspx")
    # Strip the trailing numeric id — it's noise for matching against what
    # a person actually typed, e.g. "crepe-facile-78347" -> "crepe-facile".
    words = slug.split("-")
    if words and words[-1].isdigit():
        words = words[:-1]
    title_guess = " ".join(w.capitalize() for w in words) or slug
    return slug, title_guess


# ------------------------------------------------------------------------
# Database
# ------------------------------------------------------------------------

def get_existing_source_urls(conn) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT source_url FROM recipes WHERE source_url IS NOT NULL")
        return {row[0] for row in cur.fetchall()}


def upsert_url_index(conn, rows: list[tuple[str, str, str]]) -> None:
    """rows: list of (url, slug, title_guess). Upsert so a re-run safely refreshes."""
    with conn.cursor() as cur:
        for url, slug, title_guess in rows:
            cur.execute(
                """
                INSERT INTO recipe_url_index (url, slug, title_guess, indexed_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT (url) DO UPDATE SET slug = EXCLUDED.slug, title_guess = EXCLUDED.title_guess, indexed_at = now()
                """,
                (url, slug, title_guess),
            )
    conn.commit()


def insert_recipe(conn, recipe: dict) -> bool:
    """Insert one recipe + its ingredients + steps in a single transaction.
    Returns True if a new row was inserted, False if it already existed
    (ON CONFLICT DO NOTHING) or the insert failed."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO recipes (title, description, image_url, source_url, servings)
                VALUES (%(title)s, %(description)s, %(image_url)s, %(source_url)s, %(servings)s)
                ON CONFLICT (source_url) WHERE source_url IS NOT NULL DO NOTHING
                RETURNING id
                """,
                recipe,
            )
            row = cur.fetchone()
            if row is None:
                conn.rollback()
                return False
            recipe_id = row[0]

            for ing in recipe["ingredients"]:
                cur.execute(
                    """
                    INSERT INTO recipe_ingredients (recipe_id, ingredient_name, quantity_needed, unit)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (recipe_id, ing["ingredient_name"], ing["quantity_needed"], ing["unit"]),
                )

            for step in recipe["steps"]:
                cur.execute(
                    """
                    INSERT INTO recipe_steps (recipe_id, step_number, name, text)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (recipe_id, step["step_number"], step["name"], step["text"]),
                )

        conn.commit()
        return True
    except psycopg2.Error as exc:
        logger.error("Failed to insert recipe %r: %s", recipe.get("title"), exc)
        conn.rollback()
        return False


# ------------------------------------------------------------------------
# --build-index / --import-url modes
# ------------------------------------------------------------------------

def build_index(session: requests.Session, conn) -> int:
    """Fetch all recipe sitemaps and upsert a (url, slug, title_guess) row
    per recipe into recipe_url_index — a bulk *metadata* operation (10
    sitemap XML fetches, no recipe pages), used to answer /recipes/lookup
    without ever touching the live site at search time."""
    logger.info("Discovering recipe sitemaps...")
    sitemap_urls = discover_recipe_sitemap_urls(session)
    if not sitemap_urls:
        logger.error("No recipe sitemaps found. Aborting.")
        return 1

    total = 0
    for i, sitemap_url in enumerate(sitemap_urls, start=1):
        polite_sleep()
        recipe_urls = discover_recipe_urls(session, sitemap_url)
        rows = [(url, *derive_title_guess(url)) for url in recipe_urls]
        upsert_url_index(conn, rows)
        total += len(rows)
        logger.info("[%d/%d] %s: indexed %d recipe(s) (%d total so far)", i, len(sitemap_urls), sitemap_url, len(rows), total)

    logger.info("Done. Indexed %d recipe URL(s) total.", total)
    return 0


def import_single_url(session: requests.Session, conn, url: str) -> dict:
    """Fetch and import exactly one recipe URL — no sitemap fetching, no
    looping. Used by POST /api/recipes/import (see plan) via a single
    execFile call per user-initiated import, never a batch."""
    html = fetch_text(session, url)
    if html is None:
        return {"ok": False, "error": "Failed to fetch the recipe page"}

    recipe_ld = extract_recipe_jsonld(html)
    if recipe_ld is None:
        return {"ok": False, "error": "No recipe data found on that page"}

    recipe = parse_recipe(recipe_ld, url)
    if not recipe["title"]:
        return {"ok": False, "error": "Recipe page has no title"}

    inserted = insert_recipe(conn, recipe)
    if not inserted:
        return {"ok": False, "error": "Recipe already imported"}

    return {
        "ok": True,
        "recipe": {
            "title": recipe["title"],
            "description": recipe["description"],
            "image_url": recipe["image_url"],
            "source_url": recipe["source_url"],
            "servings": recipe["servings"],
            "ingredient_count": len(recipe["ingredients"]),
            "step_count": len(recipe["steps"]),
        },
    }


# ------------------------------------------------------------------------
# CLI entry point
# ------------------------------------------------------------------------

def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Scrape cuisineaz.com recipes into the recipes table."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help=f"Max NEW recipes to import this run (default 20, hard-capped at {LIMIT_HARD_CAP}).",
    )
    parser.add_argument(
        "--category-filter",
        default=None,
        help="Optional substring match (case-insensitive) against each recipe's "
        "own recipeCategory/keywords fields, checked after fetching. E.g. 'dessert'.",
    )
    parser.add_argument(
        "--slug-contains",
        default=None,
        help="Optional substring match (case-insensitive) against the recipe's URL "
        "slug, checked BEFORE fetching — a cheap way to target e.g. Moroccan recipes "
        "('marocain') without wasting a fetch on every candidate page.",
    )
    parser.add_argument(
        "--top",
        action="store_true",
        help="Instead of importing the first --limit matching recipes encountered, scan "
        "up to --scan-limit candidates and keep only the --limit highest-rated ones "
        "(by the site's own aggregateRating.ratingValue, ties broken by reviewCount).",
    )
    parser.add_argument(
        "--scan-limit",
        type=int,
        default=None,
        help=f"Only used with --top: max candidates to fetch/examine before picking the "
        f"top --limit by rating (default: 5x --limit, hard-capped at {SCAN_LIMIT_HARD_CAP}).",
    )
    parser.add_argument(
        "--build-index",
        action="store_true",
        help="Fetch all recipe sitemaps and (re)build recipe_url_index (url/slug/title-guess "
        "only, no recipe pages fetched) — powers the app's 'suggest a recipe' lookup. "
        "Safe to re-run; upserts. Mutually exclusive with the bulk-import modes above.",
    )
    parser.add_argument(
        "--import-url",
        default=None,
        help="Fetch and import exactly one recipe URL (must be a cuisineaz.com/recettes/ "
        "URL) — no sitemap fetching, no looping. Prints a single JSON result line to "
        "stdout. Used by the backend's POST /api/recipes/import, one call per user action.",
    )
    args = parser.parse_args()

    limit = min(args.limit, LIMIT_HARD_CAP)
    category_filter = args.category_filter.lower() if args.category_filter else None
    slug_filter = args.slug_contains.lower() if args.slug_contains else None
    scan_limit = min(args.scan_limit or limit * 5, SCAN_LIMIT_HARD_CAP) if args.top else limit

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL is not set (checked environment and .env). Aborting.")
        return 1

    conn = psycopg2.connect(database_url)
    conn.autocommit = False

    session = requests.Session()

    if args.build_index:
        try:
            return build_index(session, conn)
        finally:
            conn.close()

    if args.import_url:
        if not args.import_url.startswith("https://www.cuisineaz.com/recettes/"):
            logger.error("--import-url must be a https://www.cuisineaz.com/recettes/... URL")
            conn.close()
            return 1
        try:
            import json
            result = import_single_url(session, conn, args.import_url)
            print(json.dumps(result))
            return 0 if result["ok"] else 1
        finally:
            conn.close()

    logger.info("Discovering recipe sitemaps...")
    sitemap_urls = discover_recipe_sitemap_urls(session)
    if not sitemap_urls:
        logger.error("No recipe sitemaps found. Aborting.")
        conn.close()
        return 1
    logger.info("Found %d recipe sub-sitemap(s).", len(sitemap_urls))

    existing = get_existing_source_urls(conn)
    logger.info("%d recipe(s) already imported previously.", len(existing))

    # In plain mode, candidates ARE what gets inserted (scan_limit == limit,
    # so this is just "the first --limit matches"). In --top mode, this is a
    # larger scan pool that gets ranked by rating afterward and trimmed to
    # --limit before inserting — so nothing here is written to the DB until
    # ranking has happened.
    candidates = []
    skipped_existing = 0
    skipped_filtered = 0
    skipped_slug = 0
    failed = 0
    inserted = 0

    try:
        for sitemap_url in sitemap_urls:
            if len(candidates) >= scan_limit:
                break

            polite_sleep()
            recipe_urls = discover_recipe_urls(session, sitemap_url)
            logger.info("%s: %d recipe URL(s)", sitemap_url, len(recipe_urls))

            for url in recipe_urls:
                if len(candidates) >= scan_limit:
                    break
                if url in existing:
                    skipped_existing += 1
                    continue
                if slug_filter and slug_filter not in url.lower():
                    skipped_slug += 1
                    continue

                polite_sleep()
                html = fetch_text(session, url)
                if html is None:
                    failed += 1
                    continue

                recipe_ld = extract_recipe_jsonld(html)
                if recipe_ld is None:
                    logger.warning("No Recipe JSON-LD found at %s, skipping.", url)
                    failed += 1
                    continue

                recipe = parse_recipe(recipe_ld, url)
                if not recipe["title"]:
                    logger.warning("Recipe at %s has no title, skipping.", url)
                    failed += 1
                    continue

                if category_filter and category_filter not in recipe["category_text"]:
                    skipped_filtered += 1
                    continue

                candidates.append(recipe)
                logger.info(
                    "[scanned %d/%d] %r (rating=%s, reviews=%s)",
                    len(candidates),
                    scan_limit,
                    recipe["title"],
                    recipe["rating_value"],
                    recipe["review_count"],
                )

        if args.top:
            candidates.sort(
                key=lambda r: (r["rating_value"] if r["rating_value"] is not None else -1, r["review_count"]),
                reverse=True,
            )
            logger.info("Ranked %d scanned candidate(s) by rating.", len(candidates))
        to_insert = candidates[:limit]

        for recipe in to_insert:
            if insert_recipe(conn, recipe):
                inserted += 1
                logger.info(
                    "[%d/%d] Imported %r (rating=%s, %d ingredient(s), %d step(s))",
                    inserted,
                    len(to_insert),
                    recipe["title"],
                    recipe["rating_value"],
                    len(recipe["ingredients"]),
                    len(recipe["steps"]),
                )
            else:
                skipped_existing += 1
    finally:
        conn.close()

    logger.info(
        "Done. Imported %d, skipped %d already-imported, skipped %d filtered, skipped %d by slug, %d failed.",
        inserted,
        skipped_existing,
        skipped_filtered,
        skipped_slug,
        failed,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
