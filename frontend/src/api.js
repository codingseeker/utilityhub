import { isOfficeFile } from "./services/fileTypes.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const DEFAULT_API_BASE = supabaseUrl
  ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/api`
  : "";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, "");

const LOCAL_ONLY_MESSAGE =
  "Office files are processed in this browser and are never uploaded to Cloud Storage or the API.";

function assertCloudSafe(files) {
  if (Array.isArray(files) && files.some(isOfficeFile)) {
    throw new ApiError(LOCAL_ONLY_MESSAGE, { code: "LOCAL_ONLY_FILE" });
  }
}

export class ApiError extends Error {
  constructor(message, { code = "REQUEST_FAILED", status = 0, details, requestId } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorFrom(payload, status, fallback) {
  const error = payload?.error;
  return new ApiError((typeof error === "string" ? error : error?.message) || fallback, {
    code: error?.code || "REQUEST_FAILED",
    status,
    details: error?.details,
    requestId: payload?.requestId,
  });
}

async function request(path, { method = "GET", body, headers = {}, signal } = {}) {
  if (!API_BASE) {
    throw new ApiError("The demo backend URL is not configured for this deployment.", {
      code: "SUPABASE_NOT_CONFIGURED",
    });
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("The UtilityHub API could not be reached. Check your connection.", {
      code: "NETWORK_ERROR",
    });
  }

  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    throw errorFrom(payload, response.status, "The request could not be completed.");
  }

  return payload?.data ?? payload;
}

function callEdge(action, values = {}) {
  return request("", { method: "POST", body: { action, ...values } });
}

export function fetchCatalog() {
  return Promise.resolve({ operations: [] });
}

export async function fetchProfile() {
  return { displayName: "Demo user", email: "demo@utilityhub.com" };
}

export async function startSession() {
  return { id: "anonymous" };
}

export async function initUploads(files) {
  assertCloudSafe(files);
  const uploads = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const response = await callEdge("upload", { filename: file.name, file: btoa(binary) });
    uploads.push({ uploadId: response.jobId });
  }
  return { uploads };
}

export async function discardUpload(uploadId) {
  return callEdge("delete", { jobId: uploadId });
}

/** Sends file bytes to the demo endpoint and reports completion. */
export async function uploadJobFiles(files, onProgress) {
  assertCloudSafe(files);
  const { uploads } = await initUploads(files);
  onProgress?.(100);
  return uploads.map((upload) => upload.uploadId);
}

export async function createJob({ uploads }) {
  if (!uploads?.length) throw new ApiError("Upload a file to start processing.");
  const response = await callEdge("process", { jobId: uploads[0] });
  return normalizeJob(response.job);
}

function normalizeJob(job) {
  if (!job) return job;
  return {
    ...job,
    result: job.result || {
      fileName: job.filename,
      sizeBytes: 0,
      path: job.result_path,
    },
  };
}

export async function fetchJob(jobId) {
  const response = await callEdge("status", { jobId });
  return normalizeJob(response.job);
}

export async function requestDownload(jobId) {
  return callEdge("download", { jobId });
}

export async function deleteJob(jobId) {
  return callEdge("delete", { jobId });
}

export async function listJobs() {
  return { jobs: [] };
}

export async function clearHistory() {
  return { deleted: 0 };
}

export function formatApiError(error) {
  if (typeof error === "string") return error;
  if (!error?.message) return "Something went wrong. Try again.";
  return error.message;
}
