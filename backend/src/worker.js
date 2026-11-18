import { config } from "./config/env.js";
import { createContext } from "./lib/context.js";
import { JobRunner } from "./lib/processing/runner.js";
import { runCleanup } from "./lib/services/cleanup.js";
import { createWorkerApp } from "./worker-app.js";

const args = new Set(process.argv.slice(2));
const mode = args.has("--cleanup")
  ? "cleanup"
  : args.has("--once")
    ? "once"
    : args.has("--poll")
      ? "poll"
      : "serve";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const logger = (await import("./lib/logger.js")).createLogger("worker");
  const context = await createContext({ logger });
  const runner = new JobRunner(context);

  logger.info(
    {
      mode,
      store: context.store.driver,
      storage: context.storage.driver,
      concurrency: config.worker.concurrency,
    },
    "utilityhub worker starting",
  );

  if (mode === "cleanup") {
    await runCleanup(context);
    return;
  }

  if (mode === "once") {
    let processed = 0;
    for (let pass = 0; pass < 1000; pass += 1) {
      const results = await runner.drain({ max: config.worker.concurrency });
      processed += results.filter((item) => item.status === "done" || item.status === "failed").length;
      if (results.length === 0) break;
    }
    logger.info({ processed }, "one-shot worker finished");
    return;
  }

  let closing = false;
  let pollTimer = null;
  let server = null;

  const pollOnce = async () => {
    try {
      const results = await runner.drain({ max: config.worker.concurrency });
      if (results.length > 0) {
        logger.info({ results: results.map((item) => item.status) }, "poll drained jobs");
      }
    } catch (error) {
      logger.error({ err: error }, "poll iteration failed");
    }
  };

  const startPolling = () => {
    const loop = async () => {
      while (!closing) {
        await pollOnce();
        if (closing) break;
        await sleep(config.worker.pollIntervalMs);
      }
    };
    pollTimer = loop();
  };

  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "shutting down worker");
    const finish = () => process.exit(0);
    if (server) {
      server.close(finish);
      setTimeout(finish, 10_000).unref();
    } else {
      finish();
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  if (mode === "serve") {
    const app = createWorkerApp(context);
    server = app.listen(config.port, "0.0.0.0", () => {
      logger.info({ port: config.port }, "worker http service listening");
    });
    if (config.worker.poll) startPolling();
    return;
  }

  startPolling();
  await pollTimer;
}

main().catch((error) => {
  console.error("utilityhub worker failed", error);
  process.exit(1);
});
