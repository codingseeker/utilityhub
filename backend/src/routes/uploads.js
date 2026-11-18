import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { asyncRoute, sendData } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { createUploadSession, deleteUpload } from "../lib/services/jobs.js";

const uploadSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        sizeBytes: z.coerce.number().int().positive(),
        mimeType: z.string().max(255).optional().nullable(),
      }),
    )
    .min(1),
});

function parse(schema, body) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new AppError(
      "INVALID_UPLOAD",
      422,
      "Check the file details and try again.",
      parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "body",
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function createUploadsRouter(context) {
  const router = Router();
  router.use(requireUser);

  router.post(
    "/init",
    asyncRoute(async (request, response) => {
      const { files } = parse(uploadSchema, request.body);
      const result = await createUploadSession(context, request.user, files);
      sendData(response, result, 201);
    }),
  );

  router.delete(
    "/:uploadId",
    asyncRoute(async (request, response) => {
      await deleteUpload(context, request.user, request.params.uploadId);
      response.status(204).end();
    }),
  );

  return router;
}
