import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { createContext } from "./lib/context.js";

async function main() {
  const context = await createContext();
  const app = createApp(context);

  const server = app.listen(config.port, "0.0.0.0", () => {
    context.logger.info(
      {
        port: config.port,
        store: context.store.driver,
        storage: context.storage.driver,
        auth: config.authMode,
        env: config.nodeEnv,
        inlineWorker: Boolean(context.inlineRunner),
      },
      "utilityhub api listening",
    );
  });

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    context.logger.info({ signal }, "shutting down api");
    const timer = setTimeout(() => {
      context.logger.error("graceful shutdown timed out");
      process.exit(1);
    }, 10_000);
    timer.unref();
    server.close((error) => {
      if (error) {
        context.logger.error({ err: error }, "server close failed");
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("utilityhub api failed to start", error);
  process.exit(1);
});
