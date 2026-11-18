import fs from "node:fs/promises";
import request from "supertest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import pino from "pino";
import { createApp } from "../src/app.js";
import { createAuthService } from "../src/lib/auth.js";
import { config } from "../src/config/env.js";
import { JobRunner } from "../src/lib/processing/runner.js";
import { LocalObjectStore } from "../src/lib/storage/local.js";
import { MemoryStore } from "../src/lib/store/memory.js";
import { createWorkerApp } from "../src/worker-app.js";

export async function createHarness() {
  await fs.rm(config.storageRoot, { recursive: true, force: true });

  const store = new MemoryStore();
  const storage = new LocalObjectStore();
  await store.init();
  await storage.init();

  const logger = pino({ level: "silent" });
  const context = {
    store,
    storage,
    auth: createAuthService(),
    logger,
    // Tests drive the runner directly so job creation stays deterministic.
    disableInlineWorker: true,
  };
  const app = createApp(context);
  const workerApp = createWorkerApp(context);
  const runner = new JobRunner(context);

  return {
    app,
    workerApp,
    runner,
    context,
    store,
    storage,
    api: request(app),
    worker: request(workerApp),
    async close() {
      await fs.rm(config.storageRoot, { recursive: true, force: true });
    },
  };
}

export function asUser(agent, uid = "alice") {
  return agent.set("X-Dev-User", uid);
}

function pathFromUrl(value) {
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

export async function initUploads(harness, uid, files) {
  const response = await asUser(harness.api.post("/api/v1/uploads/init"), uid)
    .send({
      files: files.map((file) => ({
        name: file.name,
        sizeBytes: file.buffer.length,
        mimeType: file.mimeType,
      })),
    })
    .expect(201);
  return response.body.data.uploads;
}

export async function putUpload(harness, upload, buffer, contentType) {
  const type = contentType || upload.headers["Content-Type"];
  // superagent serialises Buffers as JSON when the content type is JSON. Send
  // text formats as a string so the bytes on disk match the fixture exactly.
  const body = type?.includes("json") || type?.startsWith("text/") ? buffer.toString("utf8") : buffer;
  await harness.api
    .put(pathFromUrl(upload.url))
    .set("Content-Type", type)
    .send(body)
    .expect(200);
  return upload;
}

export async function uploadFiles(harness, uid, files) {
  const uploads = await initUploads(harness, uid, files);
  for (let index = 0; index < uploads.length; index += 1) {
    await putUpload(harness, uploads[index], files[index].buffer, files[index].mimeType);
  }
  return uploads;
}

export async function createCloudJob(harness, uid, { operation, files, options }) {
  const uploads = await uploadFiles(harness, uid, files);
  const response = await asUser(harness.api.post("/api/v1/jobs"), uid)
    .send({
      operation,
      uploads: uploads.map((upload) => upload.uploadId),
      options: options ?? {},
    })
    .expect(202);
  return { job: response.body.data, uploads };
}

export async function processNext(harness, max = 1) {
  return harness.runner.drain({ max });
}

export async function downloadBytes(harness, uid, jobId) {
  const response = await asUser(harness.api.get(`/api/v1/jobs/${jobId}/download`), uid).expect(200);
  const signedUrl = response.body.data.url;
  const file = await harness.api
    .get(pathFromUrl(signedUrl))
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  return { info: response.body.data, bytes: file.body };
}

export async function makePdf(pageCount = 1, label = "UtilityHub") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`${label} page ${index + 1}`, {
      x: 60,
      y: 760,
      size: 24,
      font,
      color: rgb(0.06, 0.06, 0.06),
    });
  }
  return Buffer.from(await pdf.save());
}

export async function makePng(width = 64, height = 48, background = { r: 255, g: 213, b: 79 }) {
  return sharp({
    create: { width, height, channels: 3, background },
  })
    .png()
    .toBuffer();
}

export async function makeJpeg(width = 64, height = 48) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 105, g: 240, b: 174 } },
  })
    .jpeg()
    .toBuffer();
}

export function file(name, buffer, mimeType) {
  return { name, buffer, mimeType };
}
