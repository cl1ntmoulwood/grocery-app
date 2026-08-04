import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { migrate } from "./db/migrate.js";
import inventoryRoutes from "./routes/inventory.js";
import recipesRoutes from "./routes/recipes.js";
import shoppingListRoutes from "./routes/shoppingList.js";
import pricesRoutes from "./routes/prices.js";

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });

await fastify.register(inventoryRoutes, { prefix: "/api" });
await fastify.register(recipesRoutes, { prefix: "/api" });
await fastify.register(shoppingListRoutes, { prefix: "/api" });
await fastify.register(pricesRoutes, { prefix: "/api" });

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
