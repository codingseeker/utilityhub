import { Router } from "express";
import { config } from "../config/env.js";
import { asyncRoute, sendData } from "../lib/http.js";

const VERSION = "2.0.0";

function withTimeout(promise, ms = 3000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("health check timed out")), ms);
      timer.unref?.();
    }),
  ]);
}

export function createHealthRouter(context) {
  const router = Router();

  router.get("/live", (request, response) => {
    sendData(response, { status: "ok", service: "utilityhub-api", version: VERSION });
  });

  router.get(
    "/ready",
    asyncRoute(async (request, response) => {
      const checks = { store: "unknown", storage: "unknown" };
      const tasks = [
        withTimeout(context.store.health())
          .then(() => {
            checks.store = "ok";
          })
          .catch(() => {
            checks.store = "error";
          }),
        withTimeout(context.storage.health())
          .then(() => {
            checks.storage = "ok";
          })
          .catch(() => {
            checks.storage = "error";
          }),
      ];
      await Promise.all(tasks);

      const ready = checks.store === "ok" && checks.storage === "ok";
      response.status(ready ? 200 : 503).json({
        data: {
          status: ready ? "ready" : "degraded",
          checks,
          drivers: {
            store: context.store.driver,
            storage: context.storage.driver,
            auth: config.authMode,
          },
        },
        requestId: request.id,
      });
    }),
  );

  return router;
}
