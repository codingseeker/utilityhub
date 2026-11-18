import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { config } from "./config/env.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { attachUser } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { JobRunner } from "./lib/processing/runner.js";
import { createAuthRouter } from "./routes/auth.js";
import { createDevStorageRouter } from "./routes/dev-storage.js";
import { createHealthRouter } from "./routes/health.js";
import { createJobsRouter } from "./routes/jobs.js";
import { createMeRouter } from "./routes/me.js";
import { createOperationsRouter } from "./routes/operations.js";
import { createUploadsRouter } from "./routes/uploads.js";

export function createApp(context) {
  const app = express();

  // With no WORKER_URL there is nothing external to process jobs. Local dev
  // runs them in-process; tests disable this to drive the runner explicitly.
  if (!config.isProduction && !config.worker.url && !context.disableInlineWorker) {
    context.inlineRunner = new JobRunner(context);
  }

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger: context.logger,
      genReqId: (request) => request.id,
      autoLogging: {
        ignore: (request) => request.url?.startsWith("/api/v1/health/"),
      },
      serializers: {
        req(request) {
          return {
            id: request.id,
            method: request.method,
            url: (request.url || "").split("?")[0],
          };
        },
        res(response) {
          return { statusCode: response.statusCode };
        },
      },
      customLogLevel(request, response, error) {
        if (error || response.statusCode >= 500) return "error";
        if (response.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "base-uri": ["'none'"],
          "form-action": ["'none'"],
          "frame-ancestors": ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      frameguard: { action: "deny" },
      strictTransportSecurity: config.nodeEnv === "production" ? undefined : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || config.corsOrigins.includes(origin));
      },
      credentials: false,
      optionsSuccessStatus: 204,
    }),
  );

  app.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  // Signed storage transfers carry raw bytes and must be mounted before the
  // JSON body parser. The local adapter returns 404 unless it is active.
  app.use("/api/v1/dev-storage", createDevStorageRouter(context));

  app.use(express.json({ limit: "256kb" }));
  app.use(attachUser(context.auth));

  app.use("/api/v1/health", createHealthRouter(context));

  const limiter = createRateLimiter();
  app.use("/api/v1/operations", limiter, createOperationsRouter());
  app.use("/api/v1/auth", limiter, createAuthRouter(context));
  app.use("/api/v1/uploads", limiter, createUploadsRouter(context));
  app.use("/api/v1/jobs", limiter, createJobsRouter(context));
  app.use("/api/v1/me", limiter, createMeRouter(context));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
