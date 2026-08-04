import { pool } from "../db/pool.js";
import { parseId, sendError } from "../utils/http.js";

const RECIPE_UPDATABLE_FIELDS = ["title", "instructions", "servings"];

async function getIngredientComparison(recipeId) {
  const ingredientsResult = await pool.query(
    "SELECT * FROM recipe_ingredients WHERE recipe_id = $1",
    [recipeId]
  );

  const comparisons = [];
  for (const ingredient of ingredientsResult.rows) {
    let inventoryRow = null;

    if (ingredient.inventory_item_id !== null) {
      const result = await pool.query(
        "SELECT * FROM inventory_items WHERE id = $1",
        [ingredient.inventory_item_id]
      );
      inventoryRow = result.rows[0] ?? null;
    } else {
      const result = await pool.query(
        "SELECT * FROM inventory_items WHERE lower(name) = lower($1)",
        [ingredient.ingredient_name]
      );
      inventoryRow = result.rows[0] ?? null;
    }

    let status;
    let quantityAvailable = null;
    if (!inventoryRow) {
      status = "not_tracked";
    } else {
      quantityAvailable = Number(inventoryRow.quantity);
      status = quantityAvailable >= Number(ingredient.quantity_needed) ? "ok" : "insufficient";
    }

    comparisons.push({
      ingredient_name: ingredient.ingredient_name,
      quantity_needed: Number(ingredient.quantity_needed),
      quantity_available: quantityAvailable,
      unit: ingredient.unit,
      status,
    });
  }

  return comparisons;
}

export default async function recipesRoutes(fastify) {
  fastify.get("/recipes", async (request, reply) => {
    try {
      const result = await pool.query(
        "SELECT id, title, instructions, servings, created_at FROM recipes ORDER BY created_at DESC"
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch recipes");
    }
  });

  fastify.get("/recipes/generate-list", async (request, reply) => {
    const recipeId = parseId(request.query.recipe_id);
    if (recipeId === null) return sendError(reply, 400, "Invalid or missing recipe_id");

    const client = await pool.connect();
    try {
      const recipeResult = await client.query("SELECT id FROM recipes WHERE id = $1", [recipeId]);
      if (recipeResult.rows.length === 0) return sendError(reply, 404, "Recipe not found");

      const comparisons = await getIngredientComparison(recipeId);
      const toAdd = comparisons.filter((c) => c.status === "insufficient" || c.status === "not_tracked");

      const added = [];
      await client.query("BEGIN");
      for (const item of toAdd) {
        const existing = await client.query(
          `SELECT id FROM shopping_list
           WHERE item_name = $1 AND recipe_id = $2 AND is_purchased = false`,
          [item.ingredient_name, recipeId]
        );
        if (existing.rows.length > 0) continue;

        const shortfall =
          item.status === "not_tracked"
            ? item.quantity_needed
            : item.quantity_needed - item.quantity_available;

        const insertResult = await client.query(
          `INSERT INTO shopping_list (item_name, quantity_needed, unit, source, recipe_id)
           VALUES ($1, $2, $3, 'recipe', $4)
           RETURNING *`,
          [item.ingredient_name, shortfall, item.unit, recipeId]
        );
        added.push(insertResult.rows[0]);
      }
      await client.query("COMMIT");

      return added;
    } catch (err) {
      await client.query("ROLLBACK");
      request.log.error(err);
      return sendError(reply, 500, "Failed to generate shopping list");
    } finally {
      client.release();
    }
  });

  fastify.get("/recipes/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    try {
      const recipeResult = await pool.query("SELECT * FROM recipes WHERE id = $1", [id]);
      if (recipeResult.rows.length === 0) return sendError(reply, 404, "Recipe not found");

      const ingredientsResult = await pool.query(
        "SELECT * FROM recipe_ingredients WHERE recipe_id = $1",
        [id]
      );

      return { ...recipeResult.rows[0], ingredients: ingredientsResult.rows };
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to fetch recipe");
    }
  });

  fastify.get("/recipes/:id/check-inventory", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    try {
      const recipeResult = await pool.query("SELECT id FROM recipes WHERE id = $1", [id]);
      if (recipeResult.rows.length === 0) return sendError(reply, 404, "Recipe not found");

      return await getIngredientComparison(id);
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to check inventory");
    }
  });

  fastify.post("/recipes", async (request, reply) => {
    const { title, instructions, servings, ingredients } = request.body ?? {};

    if (typeof title !== "string" || title.trim() === "") {
      return sendError(reply, 400, "title is required");
    }
    if (ingredients !== undefined && !Array.isArray(ingredients)) {
      return sendError(reply, 400, "ingredients must be an array");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const recipeResult = await client.query(
        `INSERT INTO recipes (title, instructions, servings)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [title, instructions ?? null, servings ?? null]
      );
      const recipe = recipeResult.rows[0];

      const insertedIngredients = [];
      for (const ingredient of ingredients ?? []) {
        const { inventory_item_id, ingredient_name, quantity_needed, unit } = ingredient ?? {};
        if (typeof ingredient_name !== "string" || ingredient_name.trim() === "") {
          throw Object.assign(new Error("Each ingredient requires ingredient_name"), { statusCode: 400 });
        }
        if (quantity_needed === undefined || quantity_needed === null || Number.isNaN(Number(quantity_needed))) {
          throw Object.assign(new Error("Each ingredient requires quantity_needed"), { statusCode: 400 });
        }

        const ingredientResult = await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, inventory_item_id, ingredient_name, quantity_needed, unit)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [recipe.id, inventory_item_id ?? null, ingredient_name, quantity_needed, unit ?? null]
        );
        insertedIngredients.push(ingredientResult.rows[0]);
      }

      await client.query("COMMIT");
      return reply.code(201).send({ ...recipe, ingredients: insertedIngredients });
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.statusCode === 400) return sendError(reply, 400, err.message);
      request.log.error(err);
      return sendError(reply, 500, "Failed to create recipe");
    } finally {
      client.release();
    }
  });

  fastify.put("/recipes/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    const body = request.body ?? {};
    const fields = RECIPE_UPDATABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (fields.length === 0) {
      return sendError(reply, 400, "No updatable fields provided");
    }

    const setClauses = fields.map((field, idx) => `${field} = $${idx + 1}`);
    const values = fields.map((field) => body[field]);

    try {
      const result = await pool.query(
        `UPDATE recipes SET ${setClauses.join(", ")} WHERE id = $${fields.length + 1} RETURNING *`,
        [...values, id]
      );
      if (result.rows.length === 0) return sendError(reply, 404, "Recipe not found");
      return result.rows[0];
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to update recipe");
    }
  });

  fastify.delete("/recipes/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return sendError(reply, 400, "Invalid id");

    try {
      const result = await pool.query("DELETE FROM recipes WHERE id = $1 RETURNING id", [id]);
      if (result.rows.length === 0) return sendError(reply, 404, "Recipe not found");
      return reply.code(204).send();
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to delete recipe");
    }
  });
}
