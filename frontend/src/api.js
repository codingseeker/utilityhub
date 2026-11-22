const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const DEFAULT_API_BASE = supabaseUrl
  ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/api`
  : "";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, "");

const OFFICE_FILE_MESSAGE =
  "Office files are processed in this browser and are never uploaded to the cloud.";

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

async function request(path = "", { method = "GET", body, headers = {}, signal } = {}) {
  if (!API_BASE) {
    throw new ApiError("The demo backend URL is not configured for this deployment.", {
      code: "BACKEND_NOT_CONFIGURED",
    });
  }

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(!isFormData && body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("The UtilityHub API could not be reached. Check your connection.", {
      code: "NETWORK_ERROR",
    });
  }

  const payload = parseJson(await response.text());
  if (!response.ok) throw errorFrom(payload, response.status, "The request could not be completed.");
  return payload?.data ?? payload;
}

function callEdge(action, values = {}) {
  return request("", { method: "POST", body: { action, ...values } });
}

function normalizeOperation(operation) {
  const names = {
    "merge-pdf": "merge_pdf",
    "split-pdf": "split_pdf",
    "compress-pdf": "compress_pdf",
    "rotate-pdf": "rotate_pdf",
    "images-to-pdf": "images_to_pdf",
    "pdf-to-images": "pdf_to_images",
    "image-convert": "image_convert",
    "image-compress": "image_compress",
    "color-picker": "color_picker",
    "csv-to-json": "csv_to_json",
    "json-to-csv": "json_to_csv",
    "json-format": "json_formatter",
    "table-preview": "table_preview",
    "text-case": "case_changer",
    "text-counter": "word_counter",
    "text-cleaner": "text_cleaner",
    "docx-to-txt": "docx_to_text",
    "txt-to-docx": "text_to_docx",
    "pptx-to-txt": "pptx_to_text",
    "txt-to-pptx": "text_to_pptx",
  };
  return names[operation] || operation.replaceAll("-", "_");
}

function frontendOperation(operation) {
  const names = {
    merge_pdf: "merge-pdf",
    split_pdf: "split-pdf",
    compress_pdf: "compress-pdf",
    rotate_pdf: "rotate-pdf",
    images_to_pdf: "images-to-pdf",
    pdf_to_images: "pdf-to-images",
    image_convert: "image-convert",
    image_compress: "image-compress",
    color_picker: "color-picker",
    csv_to_json: "csv-to-json",
    json_to_csv: "json-to-csv",
    json_formatter: "json-format",
    table_preview: "table-preview",
    case_changer: "text-case",
    word_counter: "text-counter",
    text_cleaner: "text-cleaner",
    docx_to_text: "docx-to-txt",
    text_to_docx: "txt-to-docx",
    pptx_to_text: "pptx-to-txt",
    text_to_pptx: "txt-to-pptx",
  };
  return names[operation] || operation;
}

function normalizeJob(job) {
  if (!job) return job;
  return {
    ...job,
    operation: frontendOperation(job.operation),
    error: job.error || (job.error_message ? { message: job.error_message } : undefined),
  };
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

export async function createJob({ operation, files, parameters }, onProgress) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ApiError("Select at least one file to process.");
  }
  if (files.some((file) => /\.(docx|pptx)$/i.test(file.name))) {
    throw new ApiError(OFFICE_FILE_MESSAGE, { code: "LOCAL_ONLY_FILE" });
  }
  const form = new FormData();
  form.append("operation", normalizeOperation(operation));
  form.append("parameters", JSON.stringify(parameters || {}));
  for (const file of files) form.append("files", file, file.name);
  onProgress?.(10);
  const response = await request("", { method: "POST", body: form });
  onProgress?.(100);
  return normalizeJob(response?.job);
}

export async function fetchJob(jobId) {
  const response = await request(`?action=status&jobId=${encodeURIComponent(jobId)}`);
  return normalizeJob(response?.job);
}

export function requestDownload(jobId) {
  return callEdge("download", { jobId });
}

export function deleteJob(jobId) {
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
