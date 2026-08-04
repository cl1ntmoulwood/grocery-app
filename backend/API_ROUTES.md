# API Routes

Backend for the Family Pantry & Local Price Tracker PWA. Fastify + `pg`, all
routes mounted under the `/api` prefix.

## Suggested directory structure

```
backend/
  package.json
  Dockerfile
  src/
    index.js              # Fastify app bootstrap, route registration, migration, listen
    db/
      pool.js              # pg Pool from DATABASE_URL
      migrate.js            # runs db/schema.sql on startup
    routes/
      inventory.js
      recipes.js
      shoppingList.js
      prices.js
```

## Inventory

Table: `inventory_items` (id, name, category, quantity, unit, low_threshold, updated_at, created_at)

| Method | Path                      | Notes |
|--------|---------------------------|-------|
| GET    | /api/inventory            | List all items. Optional `?category=` filter. |
| GET    | /api/inventory/low-stock  | Items where `quantity <= low_threshold`. |
| GET    | /api/inventory/:id        | Single item by id. |
| POST   | /api/inventory            | Create item. `name` and `quantity` required. |
| PUT    | /api/inventory/:id        | Partial update — only fields present in body are updated. |
| DELETE | /api/inventory/:id        | Delete item. |
| POST   | /api/inventory/sync       | Stub. Returns 501 `{ message: "sync not yet implemented", item: <name from body> }`. Does not call the scraper. |

Note: `/api/inventory/low-stock` must be registered before `/api/inventory/:id`
so it isn't shadowed by the param route.

## Recipes

Tables: `recipes` (id, title, instructions, servings, created_at),
`recipe_ingredients` (id, recipe_id, inventory_item_id nullable, ingredient_name, quantity_needed, unit)

| Method | Path                              | Notes |
|--------|------------------------------------|-------|
| GET    | /api/recipes                       | List recipes, no ingredients included. |
| GET    | /api/recipes/:id                   | Single recipe with its full ingredient list. |
| POST   | /api/recipes                       | Body: `title`, `instructions`, `servings`, `ingredients: []`. Inserts recipe + ingredients in one transaction. |
| PUT    | /api/recipes/:id                   | Update recipe fields only, ingredients untouched. |
| DELETE | /api/recipes/:id                   | Deletes recipe; `ON DELETE CASCADE` removes its ingredients. |
| GET    | /api/recipes/:id/check-inventory   | Compares each ingredient against inventory. Returns array of `{ ingredient_name, quantity_needed, quantity_available, unit, status }`, status one of `ok` / `insufficient` / `not_tracked`. |
| GET    | /api/recipes/generate-list?recipe_id=<id> | Runs the same comparison as check-inventory, then inserts shopping_list rows (`source='recipe'`, `recipe_id` set) for every `insufficient`/`not_tracked` ingredient, with `quantity_needed` set to the shortfall. Skips items that already have an unpurchased shopping_list row for the same `item_name` + `recipe_id`. Returns the items that were added. |

Ingredient → inventory matching: use `inventory_item_id` when set, otherwise
match `ingredient_name` to `inventory_items.name` case-insensitively.

## Shopping list

Table: `shopping_list` (id, item_name, quantity_needed, unit, source, recipe_id, estimated_price_mad, is_purchased, created_at)

| Method | Path                       | Notes |
|--------|----------------------------|-------|
| GET    | /api/shopping-list          | Optional `?purchased=true/false` filter. |
| GET    | /api/shopping-list/estimate | `{ total_mad, item_count }` — sum of `estimated_price_mad` over unpurchased items. |
| POST   | /api/shopping-list          | Create item. `source` defaults to `'manual'`. |
| PUT    | /api/shopping-list/:id      | Partial update, e.g. setting `is_purchased = true`. |
| DELETE | /api/shopping-list/:id      | Delete item. |

Note: `/api/shopping-list/estimate` must be registered before
`/api/shopping-list/:id` so it isn't shadowed by the param route.

## Prices

Table: `price_history` (id, search_term, product_title, price_mad, unit, image_url, product_url, scraped_at)

| Method | Path                        | Notes |
|--------|-----------------------------|-------|
| GET    | /api/prices/:term            | Most recent row per distinct `product_title` for `search_term` (via `DISTINCT ON`). |
| GET    | /api/prices/:term/history     | All rows for `search_term`, ordered by `scraped_at ASC`, for charting. |

## Error handling conventions

- All DB calls are wrapped in try/catch.
- Status codes: `400` bad input, `404` not found, `500` server error.
- Consistent error body: `{ "error": "message" }`.
- `:id` route params are validated as integers before querying; non-integer
  ids return `400`.
