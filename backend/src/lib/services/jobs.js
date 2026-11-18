import crypto from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { config } from "../../config/env.js";
import { AppError } from "../errors.js";
import {
  getOperation,
  listOperations,
  prepareOptions,
  validateJobFiles,
  validateUploadDescriptor,
  validateUploadedBytes,
} from "../operations/catalog.js";
import { sanitizeFileName } from "../util/filenames.js";

const JOB_EXPIRED = new AppError(
  "JOB_EXPIRED",
  410,
  "This result has expired. Upload the file again to continue.",
);
const JOB_NOT_FOUND = new AppError("JOB_NOT_FOUND", 404, "This job is not available.");

let googleAuth = null;

function workerTrigger() {
  if (!config.worker.url) return null;
  if (!googleAuth) googleAuth = new GoogleAuth();
  return googleAuth;
}

export async function triggerWorker(jobId, logger, inlineRunner = null) {
  if (!config.worker.url) {
    // Local development uses an in-process runner because the memory store is
    // not shared between processes. Production always has WORKER_URL.
    if (inlineRunner && !config.isProduction) {
      inlineRunner.runById(jobId).catch((error) => {
        logger?.error({ jobId, err: error }, "inline local job failed");
      });
    }
    return;
  }
  const url = `${config.worker.url.replace(/\/+$/, "")}/internal/run`;
  try {
    if (config.authMode === "dev") {
      const headers = { "Content-Type": "application/json" };
      if (config.worker.sharedSecret) headers["X-Worker-Secret"] = config.worker.sharedSecret;
      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId }),
        signal: AbortSignal.timeout(8000),
      });
      return;
    }
    const client = await workerTrigger().getIdTokenClient(config.worker.url);
    await client.request({
      url,
      method: "POST",
      data: { jobId },
      timeout: 8000,
    });
  } catch (error) {
    logger?.warn({ jobId, err: error }, "worker trigger failed; job remains queued");
  }
}

export function effectiveStatus(job, now = new Date()) {
  if (
    (job.status === "done" || job.status === "failed") &&
    job.expiresAt &&
    new Date(job.expiresAt).getTime() <= now.getTime()
  ) {
    return "expired";
  }
  return job.status;
}

export function serializeJob(job) {
  const status = effectiveStatus(job);
  const definition = getOperation(job.operation);
  const result = status === "done" ? job.result : null;
  let error = null;
  if (status === "failed") {
    error = job.error || { code: "PROCESSING_FAILED", message: "The document could not be processed." };
  }
  if (status === "expired") {
    error = {
      code: "JOB_EXPIRED",
      message: "This result has expired. Upload the file again to continue.",
    };
  }

  return {
    id: job.id,
    operation: job.operation,
    name: definition?.name || job.operation,
    status,
    attempts: job.attempts || 0,
    createdAt: job.createdAt?.toISOString?.() ?? job.createdAt ?? null,
    queuedAt: job.queuedAt?.toISOString?.() ?? job.queuedAt ?? null,
    startedAt: job.startedAt?.toISOString?.() ?? job.startedAt ?? null,
    completedAt: job.completedAt?.toISOString?.() ?? job.completedAt ?? null,
    expiresAt: job.expiresAt?.toISOString?.() ?? job.expiresAt ?? null,
    result: result
      ? {
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          pageCount: result.pageCount ?? null,
          summary: result.summary || {},
        }
      : null,
    error,
    pollAfterMs: status === "queued" || status === "processing" ? 1000 : null,
    downloadAvailable: status === "done",
  };
}

export function serializeJobSummary(job) {
  const status = effectiveStatus(job);
  const definition = getOperation(job.operation);
  return {
    id: job.id,
    operation: job.operation,
    name: definition?.name || job.operation,
    status,
    createdAt: job.createdAt?.toISOString?.() ?? job.createdAt ?? null,
    expiresAt: job.expiresAt?.toISOString?.() ?? job.expiresAt ?? null,
    result:
      status === "done" && job.result
        ? {
            fileName: job.result.fileName,
            sizeBytes: job.result.sizeBytes,
            mimeType: job.result.mimeType,
          }
        : null,
    errorCode: status === "failed" ? job.error?.code ?? "PROCESSING_FAILED" : null,
  };
}

async function checkQuota(store, uid, additionalBytes) {
  const usage = await store.getUsage(uid);
  if (usage.jobsToday >= config.quotaJobsPerDay) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      429,
      "Your daily cloud job limit has been reached. Try again tomorrow.",
      { field: "jobs", limit: config.quotaJobsPerDay },
    );
  }
  if (usage.bytesToday + additionalBytes > config.quotaBytesPerDay) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      429,
      "Your daily upload allowance has been reached. Try again tomorrow.",
      { field: "bytes", limit: config.quotaBytesPerDay },
    );
  }
  const active = await store.countActiveJobs(uid);
  if (active >= config.maxActiveJobs) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      429,
      `You already have ${config.maxActiveJobs} active jobs. Wait for one to finish.`,
      { field: "activeJobs", limit: config.maxActiveJobs },
    );
  }
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export async function createUploadSession(context, user, files) {
  const { store, storage } = context;
  if (!Array.isArray(files) || files.length === 0) {
    throw new AppError("INVALID_UPLOAD", 422, "Add at least one file.");
  }
  if (files.length > config.maxFilesPerJob) {
    throw new AppError("INVALID_UPLOAD", 422, `You can upload at most ${config.maxFilesPerJob} files.`);
  }

  let declaredTotal = 0;
  const prepared = [];
  for (const file of files) {
    const info = validateUploadDescriptor({
      name: file?.name,
      sizeBytes: Number(file?.sizeBytes),
      mimeType: file?.mimeType,
    });
    declaredTotal += Number(file.sizeBytes);
    prepared.push({ info, file });
  }
  if (declaredTotal > config.maxJobInputBytes) {
    throw new AppError(
      "REQUEST_TOO_LARGE",
      413,
      `The combined upload must be ${Math.round(config.maxJobInputBytes / 1024 / 1024)} MB or smaller.`,
    );
  }

  const usage = await store.getUsage(user.uid);
  if (usage.bytesToday + declaredTotal > config.quotaBytesPerDay) {
    throw new AppError("QUOTA_EXCEEDED", 429, "Your daily upload allowance has been reached.");
  }
  if (usage.jobsToday >= config.quotaJobsPerDay) {
    throw new AppError("QUOTA_EXCEEDED", 429, "Your daily cloud job limit has been reached.");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.uploadRetentionMs);
  const uploads = [];

  for (const { info, file } of prepared) {
    const uploadId = newId("upl");
    const safeName = sanitizeFileName(file.name, `file.${info.extension}`);
    const key = `uploads/${user.uid}/${uploadId}/${safeName}`;
    const signed = await storage.createUploadUrl({
      key,
      contentType: info.mime,
    });

    const doc = {
      id: uploadId,
      uid: user.uid,
      key,
      name: safeName,
      mimeType: info.mime,
      declaredMime: file.mimeType || null,
      sizeBytes: Number(file.sizeBytes),
      status: "pending",
      jobId: null,
      createdAt: now,
      expiresAt,
    };
    await store.createUpload(doc);

    uploads.push({
      uploadId,
      name: safeName,
      key,
      method: signed.method,
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt,
    });
  }

  return { uploads };
}

export async function deleteUpload(context, user, uploadId) {
  const { store, storage } = context;
  const upload = await store.getUpload(uploadId);
  if (!upload || upload.uid !== user.uid) {
    throw new AppError("UPLOAD_NOT_FOUND", 404, "This upload is not available.");
  }
  if (upload.status === "consumed") {
    throw new AppError("UPLOAD_IN_USE", 409, "This upload is already used by a job.");
  }
  await storage.delete(upload.key);
  await store.deleteUpload(uploadId);
}

async function verifyOwnedUpload(context, user, uploadId, operationId) {
  const { store, storage } = context;
  const upload = await store.getUpload(uploadId);
  if (!upload || upload.uid !== user.uid) {
    throw new AppError("UPLOAD_NOT_FOUND", 404, "An uploaded file could not be found.");
  }
  if (upload.status !== "pending") {
    throw new AppError("UPLOAD_CONSUMED", 409, "This upload has already been used.");
  }
  if (upload.expiresAt && new Date(upload.expiresAt).getTime() <= Date.now()) {
    throw new AppError("UPLOAD_NOT_FOUND", 404, "An uploaded file has expired. Upload it again.");
  }

  const head = await storage.head(upload.key);
  if (!head) {
    throw new AppError("UPLOAD_NOT_FOUND", 404, "An uploaded file could not be found.");
  }
  if (head.sizeBytes <= 0) {
    throw new AppError("EMPTY_FILE", 422, "One of the files is empty.");
  }
  if (head.sizeBytes > config.maxFileSizeBytes) {
    throw new AppError("FILE_TOO_LARGE", 413, "One of the files is too large.");
  }

  const headBuffer = await storage.readHead(upload.key, 4100);
  const detected = validateUploadedBytes({
    head: headBuffer,
    name: upload.name,
    declaredMime: upload.declaredMime || upload.mimeType,
    actualSize: head.sizeBytes,
    operationId,
  });

  return {
    uploadId,
    key: upload.key,
    name: upload.name,
    mimeType: detected.mime,
    sizeBytes: head.sizeBytes,
    kind: detected.kind,
  };
}

export async function createJob(context, user, { operation, uploads, options }) {
  const { store, logger } = context;
  const definition = getOperation(operation);
  if (!definition) {
    throw new AppError("INVALID_OPERATION", 422, "This operation is not available.");
  }
  if (!Array.isArray(uploads) || uploads.length === 0) {
    throw new AppError("INVALID_INPUT", 422, "Add the required files for this tool.");
  }
  if (uploads.length !== new Set(uploads).size) {
    throw new AppError("INVALID_INPUT", 422, "Each file can be used only once per job.");
  }

  const preparedOptions = prepareOptions(operation, options);
  const files = [];
  for (const uploadId of uploads) {
    files.push(await verifyOwnedUpload(context, user, uploadId, operation));
  }

  const { totalBytes } = validateJobFiles(operation, files);
  await checkQuota(store, user.uid, totalBytes);

  const id = newId("job");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.resultRetentionMs);
  const job = {
    id,
    uid: user.uid,
    operation,
    status: "queued",
    inputs: files.map((file) => ({
      uploadId: file.uploadId,
      key: file.key,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      kind: file.kind,
    })),
    options: preparedOptions,
    inputSizeBytes: totalBytes,
    attempts: 0,
    maxAttempts: config.worker.maxAttempts,
    leaseOwner: null,
    leaseExpiresAt: null,
    result: null,
    output: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    queuedAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt,
    deletedAt: null,
  };

  await store.createJob(job);
  for (const file of files) {
    await store.updateUpload(file.uploadId, { status: "consumed", jobId: id });
  }
  await store.addUsage(user.uid, { jobs: 1, bytes: totalBytes });
  await store.upsertUser(user);

  void triggerWorker(id, logger, context.inlineRunner);

  return serializeJob(job);
}

export async function getJob(context, user, jobId) {
  const job = await context.store.getJob(jobId);
  if (!job || job.uid !== user.uid) {
    throw JOB_NOT_FOUND;
  }
  return serializeJob(job);
}

export async function getDownload(context, user, jobId) {
  const job = await context.store.getJob(jobId);
  if (!job || job.uid !== user.uid) {
    throw JOB_NOT_FOUND;
  }
  const status = effectiveStatus(job);
  if (status === "expired") throw JOB_EXPIRED;
  if (status === "queued" || status === "processing") {
    throw new AppError("JOB_NOT_READY", 409, "The result is still being prepared.");
  }
  if (status === "failed") {
    throw new AppError("JOB_NOT_FOUND", 404, "This job did not produce a result.");
  }
  if (!job.output?.key) throw JOB_EXPIRED;

  const head = await context.storage.head(job.output.key);
  if (!head) {
    throw new AppError(
      "STORAGE_UNAVAILABLE",
      503,
      "The result is temporarily unavailable. Try again shortly.",
    );
  }

  const signed = await context.storage.createDownloadUrl({
    key: job.output.key,
    fileName: job.result.fileName,
    mimeType: job.result.mimeType,
  });

  return {
    url: signed.url,
    fileName: job.result.fileName,
    mimeType: job.result.mimeType,
    sizeBytes: job.result.sizeBytes,
    expiresAt: signed.expiresAt,
  };
}

export async function listJobs(context, user, limit) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const jobs = await context.store.listUserJobs(user.uid, safeLimit);
  return { jobs: jobs.map(serializeJobSummary) };
}

export async function deleteJob(context, user, jobId) {
  const { store, storage } = context;
  const job = await store.getJob(jobId);
  if (!job || job.uid !== user.uid) {
    throw JOB_NOT_FOUND;
  }
  if (job.status === "queued" || job.status === "processing") {
    throw new AppError("JOB_ACTIVE", 409, "This job is still running.");
  }

  await storage.deletePrefix(`results/${user.uid}/${jobId}/`);
  for (const input of job.inputs || []) {
    await storage.delete(input.key);
  }
  await store.deleteJob(jobId);
}

export async function clearHistory(context, user) {
  const { store, storage } = context;
  let deleted = 0;
  for (let pass = 0; pass < 20; pass += 1) {
    const jobs = await store.listUserJobs(user.uid, 100);
    const terminal = jobs.filter(
      (job) => job.status === "done" || job.status === "failed" || job.status === "expired",
    );
    if (terminal.length === 0) break;
    for (const job of terminal) {
      await storage.deletePrefix(`results/${user.uid}/${job.id}/`).catch(() => undefined);
      for (const input of job.inputs || []) {
        await storage.delete(input.key).catch(() => undefined);
      }
      await store.deleteJob(job.id);
      deleted += 1;
    }
  }
  return { deleted };
}

export async function getMe(context, user) {
  await context.store.upsertUser(user);
  const usage = await context.store.getUsage(user.uid);
  const active = await context.store.countActiveJobs(user.uid);
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    quota: {
      jobsToday: usage.jobsToday,
      jobsPerDay: config.quotaJobsPerDay,
      bytesToday: usage.bytesToday,
      bytesPerDay: config.quotaBytesPerDay,
      activeJobs: active,
      maxActiveJobs: config.maxActiveJobs,
    },
  };
}

export function operationsPayload() {
  const { operations, categories } = listOperations();
  return {
    operations,
    categories,
    limits: {
      maxFileSizeBytes: config.maxFileSizeBytes,
      maxFilesPerJob: config.maxFilesPerJob,
      maxJobInputBytes: config.maxJobInputBytes,
      uploadUrlTtlSeconds: config.uploadUrlTtlSeconds,
      downloadUrlTtlSeconds: config.downloadUrlTtlSeconds,
      resultRetentionHours: Math.round(config.resultRetentionMs / 3600000),
      jobsPerDay: config.quotaJobsPerDay,
      maxActiveJobs: config.maxActiveJobs,
    },
  };
}
