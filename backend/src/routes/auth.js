import { Router } from "express";
import { asyncRoute, sendData } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { getMe } from "../lib/services/jobs.js";

/**
 * Session bootstrap endpoint. The Firebase ID token is exchanged for the
 * caller's profile and quota. It exists in addition to GET /me so clients can
 * call a single familiar route after sign-in.
 */
export function createAuthRouter(context) {
  const router = Router();
  router.use(requireUser);

  router.post(
    "/session",
    asyncRoute(async (request, response) => {
      sendData(response, await getMe(context, request.user));
    }),
  );

  return router;
}
