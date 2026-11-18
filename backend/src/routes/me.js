import { Router } from "express";
import { asyncRoute, sendData } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { clearHistory, getMe, listJobs } from "../lib/services/jobs.js";

export function createMeRouter(context) {
  const router = Router();
  router.use(requireUser);

  router.get(
    "/",
    asyncRoute(async (request, response) => {
      sendData(response, await getMe(context, request.user));
    }),
  );

  router.get(
    "/jobs",
    asyncRoute(async (request, response) => {
      sendData(response, await listJobs(context, request.user, request.query.limit));
    }),
  );

  router.delete(
    "/jobs",
    asyncRoute(async (request, response) => {
      sendData(response, await clearHistory(context, request.user));
    }),
  );

  return router;
}
