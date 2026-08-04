import { pool } from "../db/pool.js";
import { sendError } from "../utils/http.js";

// Escape LIKE/ILIKE wildcard characters in user input so a literal "%" or
// "_" in a search term doesn't act as a pattern wildcard.
function likeContains(term) {
  return `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

export default async function pricesRoutes(fastify) {
  fastify.get("/prices/:term/history", async (request, reply) => {
    const { term } = request.params;
    try {
      const result = await pool.query(
        `SELECT * FROM price_history WHERE search_term ILIKE $1 ORDER BY scraped_at ASC`,
        [likeContains(term)]
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
         WHERE search_term ILIKE $1
         ORDER BY product_title, scraped_at DESC`,
        [likeContains(term)]
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch prices");
    }
  });
}
