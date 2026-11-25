import { config } from "./config.js";
import { closeDatabase } from "./db.js";
import { migrate } from "./migrations.js";
import { createApp } from "./app.js";
import { expireStaleActions } from "./actions.js";
import { tools } from "./tools/index.js";

await migrate();

const app = createApp();

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`ShopMind API listening on port ${config.port}`);
  console.log(
    `AI: ${config.ai.provider}` +
      (config.ai.provider === "anthropic" ? ` (${config.ai.anthropicModel}, effort ${config.ai.effort})` : "") +
      ` · ${Object.keys(tools).length} tools`
  );
});

// Housekeeping: expire stale pending actions every 10 minutes.
const sweeper = setInterval(() => {
  expireStaleActions().catch((error) => console.error("Expire sweep failed:", error));
}, 10 * 60 * 1000);
sweeper.unref();

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Shutting down...`);
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  try {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections?.();
    });
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error("Shutdown error:", error);
    process.exit(1);
  }
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
