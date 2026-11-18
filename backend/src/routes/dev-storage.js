import fs from "node:fs";
import express, { Router } from "express";
import { config } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { asyncRoute } from "../lib/http.js";
import { LocalObjectStore } from "../lib/storage/local.js";

function requireLocalStore(context) {
  if (config.storageDriver !== "local" || !(context.storage instanceof LocalObjectStore)) {
    throw new AppError("NOT_FOUND", 404, "The requested resource was not found.");
  }
  return context.storage;
}

/**
 * Development/test stand-in for GCS signed URLs. The URL shape and HMAC
 * signature semantics mirror the production flow so the browser upload and
 * download code is exercised end to end without cloud credentials.
 */
export function createDevStorageRouter(context) {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (request, response) => {
      const storage = requireLocalStore(context);
      const { key, action, expires, signature, filename, mime } = request.query;
      storage.verifySignature({ action, key, expires, signature });
      if (action !== "read") {
        throw new AppError("FORBIDDEN", 403, "This link is not valid.");
      }

      const head = await storage.head(String(key));
      if (!head) {
        throw new AppError("NOT_FOUND", 404, "This object is not available.");
      }

      response.setHeader("Content-Type", String(mime || head.contentType));
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${String(filename || "download").replace(/["\\\r\n]/g, "_")}"`,
      );
      response.setHeader("Content-Length", String(head.sizeBytes));
      response.setHeader("Cache-Control", "private, no-store");

      const stream = fs.createReadStream(storage.resolve(String(key)));
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    }),
  );

  router.put(
    "/",
    (request, response, next) => {
      // Raw body parser is scoped to this route so normal JSON routes keep
      // their small 256 KB limit.
      const parser = express.raw({
        type: () => true,
        limit: config.maxFileSizeBytes,
      });
      parser(request, response, next);
    },
    asyncRoute(async (request, response) => {
      const storage = requireLocalStore(context);
      const { key, action, expires, signature } = request.query;
      storage.verifySignature({ action, key, expires, signature });
      if (action !== "write") {
        throw new AppError("FORBIDDEN", 403, "This link is not valid.");
      }
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        throw new AppError("EMPTY_FILE", 422, "The uploaded file is empty.");
      }
      if (request.body.length > config.maxFileSizeBytes) {
        throw new AppError("FILE_TOO_LARGE", 413, "This file is too large.");
      }

      const contentType = request.get("content-type") || "application/octet-stream";
      await storage.writeObject(String(key), request.body, contentType);
      response.status(200).end();
    }),
  );

  return router;
}
