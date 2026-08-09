import { pool } from "../db/pool.js";
import { sendError } from "../utils/http.js";
import { expandSearchVariants } from "../utils/groceryTranslations.js";

// Escape POSIX regex metacharacters so a literal special character in the
// search term doesn't get interpreted as regex syntax.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Expands the term into English/French synonym variants, then builds a
// single word-boundary regex ("\ylait\y|\ymilk\y") rather than a plain
// substring match. Plain substring ILIKE matching was confirmed to give
// false positives on short French words — e.g. "eau" (water) matching
// inside "pruneau" (prune), and "lait" (milk) matching inside the category
// label "produits-laitiers-oeufs" — so this only matches whole words.
function searchPattern(term) {
  const variants = expandSearchVariants(term).map(escapeRegex);
  return `\\y(${variants.join("|")})\\y`;
}

export default async function pricesRoutes(fastify) {
  // One tile per distinct search_term actually present in the scraped data
  // (not a hardcoded list), with a representative image, so the category
  // strip only ever offers categories that will actually return results.
  // Registered before /:term so the static path isn't shadowed.
  fastify.get("/prices/categories", async (request, reply) => {
    try {
      const result = await pool.query(
        `SELECT DISTINCT ON (search_term) search_term, image_url
         FROM price_history
         ORDER BY search_term, scraped_at DESC`
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch price categories");
    }
  });

  // Prefix-per-word match ("\ylait" with no closing boundary) so autocomplete
  // returns results as the user types, e.g. "la" -> "Lait Central 1L". This
  // is intentionally looser than the whole-word matching on /prices/:term,
  // which exists to avoid false positives on short words like "eau" inside
  // "pruneau" — a prefix match on "eau" alone wouldn't have that problem,
  // but a suggestion list is a lower-stakes context than a search result.
  // Registered before /:term so the static path isn't shadowed by the param
  // route.
  fastify.get("/prices/suggest", async (request, reply) => {
    const term = (request.query.term || "").trim();
    if (term.length < 2) return [];
    try {
      const result = await pool.query(
        `SELECT DISTINCT ON (product_title) product_title, price_mad, unit, image_url
         FROM price_history
         WHERE product_title ~* $1
         ORDER BY product_title, scraped_at DESC
         LIMIT 8`,
        [`\\y${escapeRegex(term)}`]
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch price suggestions");
    }
  });

  fastify.get("/prices/:term/history", async (request, reply) => {
    const { term } = request.params;
    try {
      const result = await pool.query(
        `SELECT * FROM price_history
         WHERE search_term ~* $1 OR product_title ~* $1
         ORDER BY scraped_at ASC`,
        [searchPattern(term)]
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch price history");
    }
  });

  fastify.get("/prices/:term", async (request, reply) => {
    const { term } = request.params;
    try {
      const result = await pool.query(
        `SELECT DISTINCT ON (product_title) *
         FROM price_history
         WHERE search_term ~* $1 OR product_title ~* $1
         ORDER BY product_title, scraped_at DESC`,
        [searchPattern(term)]
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch prices");
    }
  });
}
