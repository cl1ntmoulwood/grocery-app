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
