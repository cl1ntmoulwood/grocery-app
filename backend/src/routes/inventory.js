import { pool } from "../db/pool.js";
import { parseId, sendError } from "../utils/http.js";

const UPDATABLE_FIELDS = ["name", "category", "quantity", "unit", "low_threshold"];

export default async function inventoryRoutes(fastify) {
  fastify.get("/inventory", async (request, reply) => {
    const { category } = request.query;
    try {
      const result = category
        ? await pool.query(
            "SELECT * FROM inventory_items WHERE category = $1 ORDER BY name ASC",
            [category]
          )
        : await pool.query("SELECT * FROM inventory_items ORDER BY name ASC");
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch inventory items");
    }
  });

  fastify.get("/inventory/low-stock", async (request, reply) => {
    try {
      const result = await pool.query(
        "SELECT * FROM inventory_items WHERE quantity <= low_threshold ORDER BY name ASC"
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch low-stock items");
    }
  });

  fastify.post("/inventory/sync", async (request, reply) => {
    const { name } = request.body ?? {};
    return reply
      .code(501)
      .send({ message: "sync not yet implemented", item: name });
  });

  fastify.get("/inventory/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    try {
      const result = await pool.query("SELECT * FROM inventory_items WHERE id = $1", [id]);
      if (result.rows.length === 0) return sendError(reply, 404, "Inventory item not found");
      return result.rows[0];
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch inventory item");
    }
  });

  fastify.post("/inventory", async (request, reply) => {
    const { name, category, quantity, unit, low_threshold } = request.body ?? {};

    if (typeof name !== "string" || name.trim() === "") {
      return sendError(reply, 400, "name is required");
    }
    if (quantity === undefined || quantity === null || Number.isNaN(Number(quantity))) {
      return sendError(reply, 400, "quantity is required");
    }

    try {
      const result = await pool.query(
        `INSERT INTO inventory_items (name, category, quantity, unit, low_threshold)
         VALUES ($1, $2, $3, $4, COALESCE($5, 0))
         RETURNING *`,
        [name, category ?? null, quantity, unit ?? null, low_threshold ?? null]
      );
      return reply.code(201).send(result.rows[0]);
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to create inventory item");
    }
  });

  fastify.put("/inventory/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    const body = request.body ?? {};
    const fields = UPDATABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (fields.length === 0) {
      return sendError(reply, 400, "No updatable fields provided");
    }

    const setClauses = fields.map((field, idx) => `${field} = $${idx + 1}`);
    setClauses.push("updated_at = now()");
    const values = fields.map((field) => body[field]);

    try {
      const result = await pool.query(
        `UPDATE inventory_items SET ${setClauses.join(", ")} WHERE id = $${fields.length + 1} RETURNING *`,
        [...values, id]
      );
      if (result.rows.length === 0) return sendError(reply, 404, "Inventory item not found");
      return result.rows[0];
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to update inventory item");
    }
  });

  fastify.delete("/inventory/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    try {
      const result = await pool.query("DELETE FROM inventory_items WHERE id = $1 RETURNING id", [id]);
      if (result.rows.length === 0) return sendError(reply, 404, "Inventory item not found");
      return reply.code(204).send();
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to delete inventory item");
    }
  });
}
