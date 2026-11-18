import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { asyncRoute, sendData } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import {
  createJob,
  deleteJob,
  getDownload,
  getJob,
} from "../lib/services/jobs.js";

const jobSchema = z.object({
  operation: z.string().min(1).max(64),
  uploads: z.array(z.string().min(1).max(64)).min(1),
  options: z.record(z.string(), z.unknown()).optional(),
});

function parseJob(body) {
  const parsed = jobSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new AppError(
      "INVALID_INPUT",
      422,
      "Check the selected tool and files.",
      parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "body",
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function createJobsRouter(context) {
  const router = Router();
  router.use(requireUser);

  router.post(
    "/",
    asyncRoute(async (request, response) => {
      const payload = parseJob(request.body);
      const job = await createJob(context, request.user, payload);
      sendData(response, job, 202);
    }),
  );

  router.get(
    "/:jobId",
    asyncRoute(async (request, response) => {
      const job = await getJob(context, request.user, request.params.jobId);
      sendData(response, job);
    }),
  );

  router.get(
    "/:jobId/download",
    asyncRoute(async (request, response) => {
      const download = await getDownload(context, request.user, request.params.jobId);
      sendData(response, download);
    }),
  );

  router.delete(
    "/:jobId",
    asyncRoute(async (request, response) => {
      await deleteJob(context, request.user, request.params.jobId);
      response.status(204).end();
    }),
  );

  return router;
}
