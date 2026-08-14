import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "../db/pool.js";
import { parseId, sendError } from "../utils/http.js";

const execFileAsync = promisify(execFile);

const RECIPE_UPDATABLE_FIELDS = ["title", "description", "instructions", "servings", "video_url"];

// Only cuisineaz.com recipe pages are ever allowed through to the scraper
// subprocess — this must never become an open fetch-any-URL proxy.
const CUISINEAZ_RECIPE_URL_RE = /^https:\/\/www\.cuisineaz\.com\/recettes\/[a-z0-9-]+\.aspx$/;

// The YouTube API returns snippet titles/channel names HTML-entity-encoded
// (a known quirk of the v3 API) — decoded once here so callers never see
// literal "&amp;" etc.
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

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
  // Registered before /recipes/:id so these static paths aren't shadowed
  // by the dynamic param route, matching this file's existing convention.

  // Pure local read — never touches cuisineaz.com. Answers instantly from
  // the pre-built recipe_url_index (see scraper/cuisineaz_scraper.py
  // --build-index), which must be run at least once for this to return
  // anything.
  fastify.get("/recipes/lookup", async (request, reply) => {
    const q = (request.query.q ?? "").trim();
    if (!q) return sendError(reply, 400, "q is required");

    try {
      const result = await pool.query(
        `SELECT url, title_guess FROM recipe_url_index
         WHERE title_guess ILIKE '%' || $1 || '%' OR slug ILIKE '%' || $1 || '%'
         ORDER BY length(title_guess) ASC
         LIMIT 5`,
        [q]
      );
      return result.rows;
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to look up recipes");
    }
  });

  // Fetches and imports exactly ONE recipe the user explicitly picked —
  // a single subprocess call per request, never a loop or a schedule.
  // Same cost as a human clicking one link, not a search or a crawl.
  fastify.post("/recipes/import", async (request, reply) => {
    const { url } = request.body ?? {};
    if (typeof url !== "string" || !CUISINEAZ_RECIPE_URL_RE.test(url)) {
      return sendError(reply, 400, "url must be a https://www.cuisineaz.com/recettes/... recipe page");
    }

    // execFile throws on a non-zero exit code — the scraper deliberately
    // exits 1 for an expected/graceful failure (e.g. already imported), so
    // that case still carries a valid JSON result on stdout and must be
    // parsed from the error object, not treated as an unexpected crash.
    let stdout;
    try {
      ({ stdout } = await execFileAsync(
        "python3",
        ["/scraper/cuisineaz_scraper.py", "--import-url", url],
        { env: process.env, timeout: 30000 }
      ));
    } catch (err) {
      stdout = err.stdout;
      if (!stdout) {
        request.log.error(err);
        return sendError(reply, 500, "Failed to import recipe");
      }
    }

    try {
      const result = JSON.parse(stdout.trim().split("\n").pop());
      if (!result.ok) return sendError(reply, 409, result.error || "Import failed");
      return reply.code(201).send(result.recipe);
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to import recipe");
    }
  });

  // Proxies the YouTube Data API v3 so the API key stays server-side —
  // never sent to or exposed in the frontend bundle.
  fastify.get("/recipes/youtube-search", async (request, reply) => {
    const q = (request.query.q ?? "").trim();
    if (!q) return sendError(reply, 400, "q is required");

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return sendError(reply, 503, "YouTube search is not configured");

    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("type", "video");
      url.searchParams.set("maxResults", "5");
      url.searchParams.set("q", q);
      url.searchParams.set("key", apiKey);

      const response = await fetch(url);
      if (!response.ok) {
        request.log.error(await response.text());
        return sendError(reply, 502, "YouTube search failed");
      }

      const data = await response.json();
      return (data.items ?? []).map((item) => ({
        videoId: item.id.videoId,
        title: decodeHtmlEntities(item.snippet.title),
        channelTitle: decodeHtmlEntities(item.snippet.channelTitle),
        thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      }));
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to search YouTube");
    }
  });

  fastify.get("/recipes", async (request, reply) => {
    const { search } = request.query;
    try {
      const result = search
        ? await pool.query(
            `SELECT id, title, description, image_url, instructions, servings, created_at
             FROM recipes WHERE title ILIKE '%' || $1 || '%' ORDER BY created_at DESC`,
            [search]
          )
        : await pool.query(
            "SELECT id, title, description, image_url, instructions, servings, created_at FROM recipes ORDER BY created_at DESC"
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
      const stepsResult = await pool.query(
        "SELECT * FROM recipe_steps WHERE recipe_id = $1 ORDER BY step_number ASC",
        [id]
      );

      return { ...recipeResult.rows[0], ingredients: ingredientsResult.rows, steps: stepsResult.rows };
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
    const { title, description, instructions, servings, ingredients } = request.body ?? {};

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
        `INSERT INTO recipes (title, description, instructions, servings)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [title, description ?? null, instructions ?? null, servings ?? null]
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
