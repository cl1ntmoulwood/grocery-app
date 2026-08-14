import "dotenv/config";
import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fstatic from "@fastify/static";
import { migrate } from "./db/migrate.js";
import inventoryRoutes from "./routes/inventory.js";
import recipesRoutes from "./routes/recipes.js";
import shoppingListRoutes from "./routes/shoppingList.js";
import pricesRoutes from "./routes/prices.js";
import authRoutes from "./routes/auth.js";
import uploadsRoutes from "./routes/uploads.js";
import { requireAuth } from "./utils/authGuard.js";

if (!process.env.COOKIE_SECRET) {
  throw new Error("COOKIE_SECRET environment variable is not set");
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/app/uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true, credentials: true });
await fastify.register(cookie, { secret: process.env.COOKIE_SECRET });
await fastify.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

await fastify.register(authRoutes, { prefix: "/api/auth" });

// Every pantry-data route requires a logged-in household with an active
// profile — wrapping the existing route files in this encapsulated context
// adds the guard without modifying any of them. Uploads (posting AND
// viewing photos) live in here too, same rule as everything else.
await fastify.register(async (protectedApi) => {
  protectedApi.addHook("preHandler", requireAuth);
  await protectedApi.register(inventoryRoutes, { prefix: "/api" });
  await protectedApi.register(recipesRoutes, { prefix: "/api" });
  await protectedApi.register(shoppingListRoutes, { prefix: "/api" });
  await protectedApi.register(pricesRoutes, { prefix: "/api" });
  await protectedApi.register(uploadsRoutes, { prefix: "/api", uploadDir: UPLOAD_DIR });
  await protectedApi.register(fstatic, { root: UPLOAD_DIR, prefix: "/api/uploads/", decorateReply: false });
});

try {
  await migrate();
} catch (err) {
  fastify.log.error("Startup migration failed, exiting.");
  process.exit(1);
}

try {
  await fastify.listen({ host: "0.0.0.0", port: 3000 });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
