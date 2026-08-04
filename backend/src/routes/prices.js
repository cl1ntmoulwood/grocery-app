import { pool } from "../db/pool.js";
import { sendError } from "../utils/http.js";

export default async function pricesRoutes(fastify) {
  fastify.get("/prices/:term/history", async (request, reply) => {
    const { term } = request.params;
    try {
      const result = await pool.query(
        `SELECT * FROM price_history WHERE search_term = $1 ORDER BY scraped_at ASC`,
        [term]
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
         WHERE search_term = $1
         ORDER BY product_title, scraped_at DESC`,
        [term]
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch prices");
    }
  });
}
