const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");

const EXTENSION_MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  csv: "text/csv",
  tsv: "text/csv",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
};

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

function mimeForFile(file) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return EXTENSION_MIME[extension] || "application/octet-stream";
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
  return new ApiError(error?.message || fallback, {
    code: error?.code || "REQUEST_FAILED",
    status,
    details: error?.details,
    requestId: payload?.requestId,
  });
}

async function request(path, { method = "GET", body, headers = {}, auth = {}, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...auth,
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

  return payload?.data ?? null;
}

export function fetchCatalog() {
  return request("/operations");
}

export async function fetchProfile(auth) {
  return request("/me", { auth });
}

export async function startSession(auth) {
  return request("/auth/session", { method: "POST", body: {}, auth });
}

export async function initUploads(files, auth) {
  return request("/uploads/init", {
    method: "POST",
    auth,
    body: {
      files: files.map((file) => ({
        name: file.name,
        sizeBytes: file.size,
        mimeType: mimeForFile(file),
      })),
    },
  });
}

export function uploadToSignedUrl(upload, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method || "PUT", upload.url);
    xhr.timeout = 180000;

    for (const [name, value] of Object.entries(upload.headers || {})) {
      xhr.setRequestHeader(name, value);
    }
    if (!upload.headers?.["Content-Type"] && !upload.headers?.["content-type"]) {
      xhr.setRequestHeader("Content-Type", mimeForFile(file));
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onerror = () =>
      reject(new ApiError("The upload failed. Check your connection and try again.", {
        code: "UPLOAD_FAILED",
      }));
    xhr.ontimeout = () =>
      reject(new ApiError("The upload took too long. Try smaller files.", {
        code: "UPLOAD_TIMEOUT",
      }));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(
        errorFrom(
          parseJson(xhr.responseText),
          xhr.status,
          "The file could not be uploaded to cloud storage.",
        ),
      );
    };

    xhr.send(file);
  });
}

export async function discardUpload(uploadId, auth) {
  return request(`/uploads/${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
    auth,
  });
}

/**
 * Runs the full signed-upload flow and reports aggregate progress. Bytes never
 * pass through the API; the browser PUTs directly to the signed storage URL.
 */
export async function uploadJobFiles(files, auth, onProgress) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
  const { uploads } = await initUploads(files, auth);
  if (!Array.isArray(uploads) || uploads.length !== files.length) {
    throw new ApiError("The upload session was incomplete. Try again.", {
      code: "INVALID_RESPONSE",
    });
  }

  const completed = new Array(files.length).fill(0);
  for (let index = 0; index < uploads.length; index += 1) {
    const file = files[index];
    try {
      await uploadToSignedUrl(uploads[index], file, (fraction) => {
        completed[index] = file.size * fraction;
        const loaded = completed.reduce((sum, value) => sum + value, 0);
        onProgress?.(Math.min(100, Math.round((loaded / totalBytes) * 100)));
      });
      completed[index] = file.size;
      onProgress?.(Math.min(100, Math.round((completed.reduce((a, b) => a + b, 0) / totalBytes) * 100)));
    } catch (error) {
      // Leave no orphaned objects behind when a later file fails.
      for (let cleanup = index; cleanup < uploads.length; cleanup += 1) {
        discardUpload(uploads[cleanup].uploadId, auth).catch(() => undefined);
      }
      throw error;
    }
  }

  return uploads.map((upload) => upload.uploadId);
}

export async function createJob({ operation, uploads, options }, auth) {
  return request("/jobs", {
    method: "POST",
    auth,
    body: { operation, uploads, options },
  });
}

export function fetchJob(jobId, auth) {
  return request(`/jobs/${encodeURIComponent(jobId)}`, { auth });
}

export async function requestDownload(jobId, auth) {
  return request(`/jobs/${encodeURIComponent(jobId)}/download`, { auth });
}

export function deleteJob(jobId, auth) {
  return request(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", auth });
}

export function listJobs(auth, limit = 25) {
  return request(`/me/jobs?limit=${encodeURIComponent(limit)}`, { auth });
}

export function clearHistory(auth) {
  return request("/me/jobs", { method: "DELETE", auth });
}

export function formatApiError(error) {
  if (typeof error === "string") return error;
  if (!error?.message) return "Something went wrong. Try again.";
  return error.message;
}
