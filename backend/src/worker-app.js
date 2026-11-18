import express from "express";
import pinoHttp from "pino-http";
import { config } from "./config/env.js";
import { asyncRoute, sendData } from "./lib/http.js";
import { JobRunner } from "./lib/processing/runner.js";
import { requestId } from "./middleware/request-id.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

/**
 * Worker HTTP surface. It is deployed as its own Cloud Run service with
 * no public invoker; the API calls it with an OIDC identity token.
 */
export function createWorkerApp(context) {
  const app = express();
  const runner = new JobRunner(context);

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(
    pinoHttp({
      logger: context.logger,
      genReqId: (request) => request.id,
      autoLogging: { ignore: (request) => request.url?.startsWith("/internal/health") },
    }),
  );
  app.use(express.json({ limit: "16kb" }));

  app.get("/internal/health", asyncRoute(async (request, response) => {
    const checks = { store: "error", storage: "error" };
    await Promise.all([
      context.store
        .health()
        .then(() => {
          checks.store = "ok";
        })
        .catch(() => undefined),
      context.storage
        .health()
        .then(() => {
          checks.storage = "ok";
        })
        .catch(() => undefined),
    ]);
    const ok = checks.store === "ok" && checks.storage === "ok";
    response.status(ok ? 200 : 503).json({
      data: { status: ok ? "ready" : "degraded", checks },
      requestId: request.id,
    });
  }));

  app.post("/internal/run", asyncRoute(async (request, response) => {
    await context.auth.verifyWorkerRequest(request);
    const jobId = request.body?.jobId;
    let results;
    if (jobId) {
      if (typeof jobId !== "string" || !jobId.startsWith("job_")) {
        results = [{ status: "invalid", state: "jobId" }];
      } else {
        results = [await runner.runById(jobId)];
      }
    } else {
      results = await runner.drain({ max: config.worker.concurrency });
    }

    sendData(response, {
      processed: results.filter((item) => item.status !== "skipped" && item.status !== "not-found").length,
      results: results.map((item) => item.status),
    });
  }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
