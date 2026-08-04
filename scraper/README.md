# bringo_scraper

Standalone Python script that scrapes bringo.ma category search results for
product prices and stores them in the `price_history` table for the Family
Pantry & Local Price Tracker PWA.

This script is **not** called by the backend API. `POST /api/inventory/sync`
in `backend/src/routes/inventory.js` is a deliberate 501 stub — run this
script manually or on a schedule (e.g. cron) instead.

## Setup

```bash
cd scraper
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Environment variables

Create a `.env` file in this directory (loaded automatically via
python-dotenv) or export the variable directly:

```
DATABASE_URL=postgres://pantry:pantry@localhost:5432/pantry
```

If running against the project's `docker-compose.yml` Postgres service from
the host machine (not from inside another container), use `localhost:5432`
with the same credentials defined there (`pantry` / `pantry` / db `pantry`),
since the `db` hostname only resolves inside the docker-compose network.

## Usage

```bash
python bringo_scraper.py "LAIT UHT" --category produits-laitiers-oeufs-8
python bringo_scraper.py "LAIT" --category produits-laitiers-oeufs-8 \
    --store carrefour-supermarket-market-yaacoub-al-mansour --max-pages 2
```

`--category` is **required** — see "How search actually works" below.
`--store` defaults to `carrefour-supermarket-market-yaacoub-al-mansour`
(the only branch verified so far).

Each run inserts one row per product found into `price_history`
(search_term, product_title, price_mad, unit, image_url, product_url,
scraped_at). The script rate-limits itself (a few seconds of random delay
between requests) and caps pagination at a small hard limit — it is meant
for occasional, low-volume personal use, not bulk crawling.

## How search actually works on bringo.ma (verified, not guessed)

Earlier versions of this script assumed a generic Magento/PrestaShop-style
site with a simple `?q=<term>` search. That was wrong and confirmed broken
(404s). This version is built from **real captured data**: a live product
card's HTML (via browser DevTools "Copy outerHTML") and a working request
(via a captured `curl` command from the Network tab). Confirmed facts:

- The site runs on **Sylius** (a Symfony e-commerce framework). Product
  cards carry Constructor.io tracking attributes
  (`data-cnstrc-item-name`, `data-cnstrc-item-price`) directly on the
  `div.box-product` container — this script reads those attributes
  directly instead of parsing visible text, which is both simpler and more
  robust (no comma-decimal price parsing needed).
- The working URL shape is:
  ```
  https://www.bringo.ma/fr_MA/store/{store}/{category}?criteria[search][value]={term}
  ```
  This requires **both** a specific store slug and a specific category
  slug+id (e.g. `produits-laitiers-oeufs-8`) — **there is no site-wide
  keyword search.** Searching a term against the wrong category returns
  zero results (confirmed: searching "PAIN" inside the dairy category
  returns "no results," not bread products) — search filters *within* the
  given category, it doesn't search the whole catalog.
- No delivery-address selection or login/session cookie is required — a
  plain unauthenticated `GET` returns real product data.

### Finding a category slug+id

You need the right category for whatever you want to track. Two ways:

1. Browse bringo.ma yourself, navigate to the category, and copy the URL
   segment after `/store/{store}/` (e.g. `produits-laitiers-oeufs-8`).
2. Check the category sitemap:
   `https://bringo.ma/sitemaps/sitemaps-generic/sitemap-generic-category-ma.xml`

### What's still unverified

- **Pagination.** `robots.txt` disallows crawling `*?page=`, implying a
  `page` query param exists, but its exact behavior (1-indexed? what
  happens past the last page?) hasn't been directly observed. Keep
  `--max-pages` low; the script treats a page with zero product cards as
  "end of results," which is a safe stopping heuristic either way.
- **Other store branches.** Only
  `carrefour-supermarket-market-yaacoub-al-mansour` has been tested. Other
  store slugs (from the store sitemap) are assumed to follow the same URL
  shape but weren't individually verified.

### Parser correctness

The card-parsing logic (`parse_product_card`) was tested directly against
a real captured product card's HTML and correctly extracted title, price
(as a clean `Decimal`), product URL, and image URL. This is a genuinely
tested parser, not a best-effort guess — but it's still only as durable as
bringo.ma's markup; if they change their class names or drop the
`data-cnstrc-*` attributes, this will need updating.
