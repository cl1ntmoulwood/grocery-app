import { pool } from "../db/pool.js";
import { parseId, sendError } from "../utils/http.js";

const UPDATABLE_FIELDS = [
  "item_name",
  "quantity_needed",
  "unit",
  "source",
  "recipe_id",
  "estimated_price_mad",
  "is_purchased",
];

export default async function shoppingListRoutes(fastify) {
  fastify.get("/shopping-list", async (request, reply) => {
    const { purchased } = request.query;
    try {
      if (purchased === undefined) {
        const result = await pool.query("SELECT * FROM shopping_list ORDER BY created_at DESC");
        return result.rows;
      }

      if (purchased !== "true" && purchased !== "false") {
        return sendError(reply, 400, "purchased must be 'true' or 'false'");
      }

      const result = await pool.query(
        "SELECT * FROM shopping_list WHERE is_purchased = $1 ORDER BY created_at DESC",
        [purchased === "true"]
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch shopping list");
    }
  });

  fastify.get("/shopping-list/estimate", async (request, reply) => {
    try {
      const result = await pool.query(
        `SELECT COALESCE(SUM(estimated_price_mad), 0) AS total_mad, COUNT(*) AS item_count
         FROM shopping_list
         WHERE is_purchased = false`
      );
      const row = result.rows[0];
      return {
        total_mad: Number(row.total_mad),
        item_count: Number(row.item_count),
      };
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to calculate estimate");
    }
  });

  fastify.post("/shopping-list", async (request, reply) => {
    const {
      item_name,
      quantity_needed,
      unit,
      source,
      recipe_id,
      estimated_price_mad,
    } = request.body ?? {};

    if (typeof item_name !== "string" || item_name.trim() === "") {
      return sendError(reply, 400, "item_name is required");
    }

    try {
      const result = await pool.query(
        `INSERT INTO shopping_list (item_name, quantity_needed, unit, source, recipe_id, estimated_price_mad)
         VALUES ($1, $2, $3, COALESCE($4, 'manual'), $5, $6)
         RETURNING *`,
        [
          item_name,
          quantity_needed ?? null,
          unit ?? null,
          source ?? null,
          recipe_id ?? null,
          estimated_price_mad ?? null,
        ]
      );
      return reply.code(201).send(result.rows[0]);
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to create shopping list item");
    }
  });

  fastify.put("/shopping-list/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    const body = request.body ?? {};
    const fields = UPDATABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (fields.length === 0) {
      return sendError(reply, 400, "No updatable fields provided");
    }

    const setClauses = fields.map((field, idx) => `${field} = $${idx + 1}`);
    const values = fields.map((field) => body[field]);

    try {
      const result = await pool.query(
        `UPDATE shopping_list SET ${setClauses.join(", ")} WHERE id = $${fields.length + 1} RETURNING *`,
        [...values, id]
      );
      if (result.rows.length === 0) return sendError(reply, 404, "Shopping list item not found");
      return result.rows[0];
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to update shopping list item");
    }
  });

  fastify.delete("/shopping-list/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    try {
      const result = await pool.query("DELETE FROM shopping_list WHERE id = $1 RETURNING id", [id]);
      if (result.rows.length === 0) return sendError(reply, 404, "Shopping list item not found");
      return reply.code(204).send();
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to delete shopping list item");
    }
  });
}
