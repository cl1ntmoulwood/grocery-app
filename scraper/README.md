# bringo_scraper

Standalone Python script that scrapes bringo.ma search-results pages for
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
python bringo_scraper.py "Lait"
python bringo_scraper.py "Huile d'olive" --max-pages 2
```

Each run fetches bringo.ma search results for the given term and inserts one
row per product found into `price_history` (search_term, product_title,
price_mad, unit, image_url, product_url, scraped_at).

The script rate-limits itself (a few seconds of random delay between
requests) and caps pagination at a small hard limit — it is meant for
occasional, low-volume personal use, not bulk crawling.

## IMPORTANT: this script does not work against the real site yet

A follow-up check (with limited live web access, no browser/DevTools)
confirmed the original assumptions behind this script were wrong, not just
imprecise:

- bringo.ma is **"BRINGO by Carrefour"**, an address/delivery-zone-gated
  grocery app — not a generic Magento/PrestaShop storefront.
- `SEARCH_URL_TEMPLATE`'s guessed URL (`/catalogsearch/result/?q=...`)
  **returns a confirmed HTTP 404.** There's no evidence the site has a
  simple keyword-search URL at all — pages instead show category tiles
  (e.g. "Epicerie") reachable only after selecting a delivery address/store.
- There are signs the site loads at least some content via client-side
  JS/XHR after the initial page load, which plain `requests` won't execute.
  It's unconfirmed whether product/price data is even present in the raw
  server-rendered HTML, or only arrives via a separate JSON API call.

The `SELECTORS` dict in `bringo_scraper.py` is still just a best-effort
guess layered on top of this shakier foundation.

**Before relying on this script for real price-tracking data:**

1. In a real browser, walk through bringo.ma manually: pick a delivery
   address/store, then find how product search/browsing actually works
   (real URL pattern and query params).
2. Open DevTools' **Network tab** (not just page source) while doing that.
   Check whether product/price data shows up in the initial HTML document
   or in a separate XHR/fetch JSON response.
   - If it's a JSON API response: rewrite this script to call that API
     directly (`requests` + `response.json()`) instead of BeautifulSoup —
     usually simpler and more reliable than HTML scraping once you find it.
   - If it's in the server-rendered HTML: update `SEARCH_URL_TEMPLATE` and
     `SELECTORS` in `bringo_scraper.py` to match reality.
3. Run the script against one search term and manually check a few rows in
   `price_history` (title, price, unit) before trusting any chart built on
   this data.

Until that's done, this script will simply 404 on every run as-is — treat
it as a starting skeleton (rate limiting, DB insert, CLI, error handling),
not a working scraper yet.
