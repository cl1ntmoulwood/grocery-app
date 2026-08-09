-- Family Pantry & Local Price Tracker schema
-- All statements are idempotent (IF NOT EXISTS) so this file is safe to run on every backend startup.

CREATE TABLE IF NOT EXISTS inventory_items (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    category       TEXT,
    quantity       NUMERIC NOT NULL DEFAULT 0,
    unit           TEXT,
    low_threshold  NUMERIC NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items (category);
CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items (lower(name));

CREATE TABLE IF NOT EXISTS recipes (
    id            SERIAL PRIMARY KEY,
    title         TEXT NOT NULL,
    instructions  TEXT,
    servings      INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id                  SERIAL PRIMARY KEY,
    recipe_id           INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    inventory_item_id   INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
    ingredient_name     TEXT NOT NULL,
    quantity_needed     NUMERIC NOT NULL,
    unit                TEXT
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id ON recipe_ingredients (recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_inventory_item_id ON recipe_ingredients (inventory_item_id);

CREATE TABLE IF NOT EXISTS shopping_list (
    id                    SERIAL PRIMARY KEY,
    item_name             TEXT NOT NULL,
    quantity_needed       NUMERIC,
    unit                  TEXT,
    source                TEXT NOT NULL DEFAULT 'manual',
    recipe_id             INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
    estimated_price_mad   NUMERIC,
    image_url             TEXT,
    is_purchased          BOOLEAN NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added after the initial table creation, so a plain CREATE TABLE IF NOT
-- EXISTS above won't backfill it on an already-existing database.
ALTER TABLE shopping_list ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_shopping_list_is_purchased ON shopping_list (is_purchased);
CREATE INDEX IF NOT EXISTS idx_shopping_list_recipe_id ON shopping_list (recipe_id);

CREATE TABLE IF NOT EXISTS price_history (
    id             SERIAL PRIMARY KEY,
    search_term    TEXT NOT NULL,
    product_title  TEXT NOT NULL,
    price_mad      NUMERIC NOT NULL,
    unit           TEXT,
    image_url      TEXT,
    product_url    TEXT,
    scraped_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_search_term ON price_history (search_term);
CREATE INDEX IF NOT EXISTS idx_price_history_search_term_scraped_at ON price_history (search_term, scraped_at);

-- One household per self-hosted deployment (not multi-tenant) shares a
-- single login; each family member then picks their own profile.
CREATE TABLE IF NOT EXISTS households (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    login_id       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
    id            SERIAL PRIMARY KEY,
    household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    avatar_emoji  TEXT NOT NULL DEFAULT '🙂',
    avatar_color  TEXT NOT NULL DEFAULT '#1f6f76',
    pin_hash      TEXT,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (household_id, name)
);

CREATE INDEX IF NOT EXISTS idx_profiles_household_id ON profiles (household_id);
