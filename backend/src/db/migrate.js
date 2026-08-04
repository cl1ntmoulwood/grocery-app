import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../../../db/schema.sql");

export async function migrate() {
  let schemaSql;
  try {
    schemaSql = await readFile(SCHEMA_PATH, "utf8");
  } catch (err) {
    console.error(`[migrate] Failed to read schema file at ${SCHEMA_PATH}:`, err.message);
    throw err;
  }

  try {
    await pool.query(schemaSql);
    console.log(`[migrate] Migration ran successfully (${SCHEMA_PATH})`);
  } catch (err) {
    console.error("[migrate] Migration failed:", err.message);
    throw err;
  }
}
