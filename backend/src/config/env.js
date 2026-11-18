import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const int = (fallback, min, max) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const bool = (fallback) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(4000, 1, 65535),
  PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  TRUST_PROXY: bool(false),

  GCP_PROJECT_ID: z.string().min(1).default("utilityhub-local"),
  GCS_BUCKET: z.string().min(1).default("utilityhub-local"),
  FIRESTORE_DATABASE_ID: z.string().min(1).default("(default)"),
  STORAGE_DRIVER: z.enum(["gcs", "local"]).default("local"),
  DB_DRIVER: z.enum(["firestore", "memory"]).default("memory"),
  AUTH_MODE: z.enum(["firebase", "dev"]).default("dev"),
  SIGNED_URL_SECRET: z.string().min(16).default("local-development-signing-secret-change-me"),
  DEV_USER_ID: z.string().min(1).default("dev-user"),
  DEV_USER_EMAIL: z.string().email().default("dev@utilityhub.local"),
  DEV_USER_NAME: z.string().min(1).default("Dev User"),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),

  WORKER_URL: z.string().url().optional(),
  WORKER_SHARED_SECRET: z.string().min(16).optional(),
  WORKER_POLL: bool(true),
  WORKER_CONCURRENCY: int(1, 1, 4),
  WORKER_LEASE_SECONDS: int(90, 15, 3600),
  WORKER_HEARTBEAT_SECONDS: int(30, 5, 600),
  WORKER_MAX_ATTEMPTS: int(2, 1, 5),
  WORKER_POLL_INTERVAL_MS: int(2000, 250, 60000),
  WORKER_RUN_BUDGET_MS: int(480000, 10000, 3600000),

  UPLOAD_URL_TTL_SECONDS: int(900, 60, 3600),
  DOWNLOAD_URL_TTL_SECONDS: int(300, 60, 3600),
  UPLOAD_RETENTION_HOURS: int(6, 1, 168),
  RESULT_RETENTION_HOURS: int(24, 1, 720),
  METADATA_RETENTION_HOURS: int(72, 1, 2160),

  MAX_FILE_SIZE_MB: int(25, 1, 1024),
  MAX_FILES_PER_JOB: int(20, 1, 100),
  MAX_JOB_INPUT_MB: int(100, 1, 4096),
  MAX_PDF_PAGES: int(500, 1, 10000),
  MAX_MERGED_PAGES: int(2000, 1, 20000),
  MAX_SPLIT_PARTS: int(20, 1, 100),
  PDF_TO_IMAGES_MAX_PAGES: int(100, 1, 1000),
  MAX_IMAGE_MEGAPIXELS: int(40, 1, 1000),
  PDF_TO_IMAGES_MAX_PIXELS: int(50000000, 1000000, 1000000000),
  MAX_TEXT_BYTES: int(1048576, 1024, 10485760),
  MAX_CSV_ROWS: int(20000, 100, 200000),

  QUOTA_JOBS_PER_DAY: int(50, 1, 10000),
  QUOTA_BYTES_PER_DAY_MB: int(500, 1, 1048576),
  MAX_ACTIVE_JOBS: int(3, 1, 100),
  RATE_LIMIT_ENABLED: bool(true),

  MERGE_TIMEOUT_MS: int(120000, 1000, 3600000),
  SPLIT_TIMEOUT_MS: int(120000, 1000, 3600000),
  COMPRESS_TIMEOUT_MS: int(180000, 1000, 3600000),
  ROTATE_TIMEOUT_MS: int(90000, 1000, 3600000),
  IMAGES_TO_PDF_TIMEOUT_MS: int(180000, 1000, 3600000),
  PDF_TO_IMAGES_TIMEOUT_MS: int(300000, 1000, 3600000),
  IMAGE_TIMEOUT_MS: int(60000, 1000, 3600000),
  DATA_TIMEOUT_MS: int(60000, 1000, 3600000),
  TEXT_TIMEOUT_MS: int(30000, 1000, 3600000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${fields}`);
}

const env = parsed.data;
const mb = (value) => value * 1024 * 1024;
const isProduction = env.NODE_ENV === "production";

if (isProduction) {
  const unsafe = [];
  if (env.STORAGE_DRIVER !== "gcs") unsafe.push("STORAGE_DRIVER must be gcs");
  if (env.DB_DRIVER !== "firestore") unsafe.push("DB_DRIVER must be firestore");
  if (env.AUTH_MODE !== "firebase") unsafe.push("AUTH_MODE must be firebase");
  if (env.GCS_BUCKET === "utilityhub-local") unsafe.push("GCS_BUCKET must be configured");
  if (env.GCP_PROJECT_ID === "utilityhub-local") unsafe.push("GCP_PROJECT_ID must be configured");
  // The HMAC signing secret is only used by the local storage driver. GCS v4
  // URLs are signed with IAM credentials, so no shared secret is stored.
  if (
    env.STORAGE_DRIVER !== "gcs" &&
    env.SIGNED_URL_SECRET === "local-development-signing-secret-change-me"
  ) {
    unsafe.push("SIGNED_URL_SECRET must be configured");
  }
  if (unsafe.length > 0) {
    throw new Error(
      `Refusing to start in production with local-only configuration: ${unsafe.join("; ")}`,
    );
  }
}

const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isProduction && corsOrigins.some((origin) => !origin.startsWith("https://"))) {
  throw new Error("CORS_ORIGINS must contain HTTPS origins in production.");
}

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  isProduction,
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  publicApiUrl: env.PUBLIC_API_URL.replace(/\/+$/, ""),
  corsOrigins,
  logLevel: env.LOG_LEVEL,
  trustProxy: env.TRUST_PROXY,

  gcpProjectId: env.GCP_PROJECT_ID,
  gcsBucket: env.GCS_BUCKET,
  firestoreDatabaseId: env.FIRESTORE_DATABASE_ID,
  storageDriver: env.STORAGE_DRIVER,
  dbDriver: env.DB_DRIVER,
  authMode: env.AUTH_MODE,
  signedUrlSecret: env.SIGNED_URL_SECRET,
  devUser: Object.freeze({
    uid: env.DEV_USER_ID,
    email: env.DEV_USER_EMAIL,
    displayName: env.DEV_USER_NAME,
  }),
  firebaseAuthEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST ?? null,

  worker: Object.freeze({
    url: env.WORKER_URL ?? null,
    sharedSecret: env.WORKER_SHARED_SECRET ?? null,
    poll: env.WORKER_POLL,
    concurrency: env.WORKER_CONCURRENCY,
    leaseMs: env.WORKER_LEASE_SECONDS * 1000,
    heartbeatMs: env.WORKER_HEARTBEAT_SECONDS * 1000,
    maxAttempts: env.WORKER_MAX_ATTEMPTS,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    runBudgetMs: env.WORKER_RUN_BUDGET_MS,
  }),

  uploadUrlTtlSeconds: env.UPLOAD_URL_TTL_SECONDS,
  downloadUrlTtlSeconds: env.DOWNLOAD_URL_TTL_SECONDS,
  uploadRetentionMs: env.UPLOAD_RETENTION_HOURS * 3600000,
  resultRetentionMs: env.RESULT_RETENTION_HOURS * 3600000,
  metadataRetentionMs: env.METADATA_RETENTION_HOURS * 3600000,

  maxFileSizeBytes: mb(env.MAX_FILE_SIZE_MB),
  maxFilesPerJob: env.MAX_FILES_PER_JOB,
  maxJobInputBytes: mb(env.MAX_JOB_INPUT_MB),
  maxPdfPages: env.MAX_PDF_PAGES,
  maxMergedPages: env.MAX_MERGED_PAGES,
  maxSplitParts: env.MAX_SPLIT_PARTS,
  pdfToImagesMaxPages: env.PDF_TO_IMAGES_MAX_PAGES,
  maxImagePixels: env.MAX_IMAGE_MEGAPIXELS * 1000000,
  pdfToImagesMaxPixels: env.PDF_TO_IMAGES_MAX_PIXELS,
  maxTextBytes: env.MAX_TEXT_BYTES,
  maxCsvRows: env.MAX_CSV_ROWS,

  quotaJobsPerDay: env.QUOTA_JOBS_PER_DAY,
  quotaBytesPerDay: mb(env.QUOTA_BYTES_PER_DAY_MB),
  maxActiveJobs: env.MAX_ACTIVE_JOBS,
  rateLimitEnabled: env.RATE_LIMIT_ENABLED,

  storageRoot: path.resolve(process.env.STORAGE_ROOT || "var/objects"),

  operationTimeouts: Object.freeze({
    "merge-pdf": env.MERGE_TIMEOUT_MS,
    "split-pdf": env.SPLIT_TIMEOUT_MS,
    "compress-pdf": env.COMPRESS_TIMEOUT_MS,
    "rotate-pdf": env.ROTATE_TIMEOUT_MS,
    "images-to-pdf": env.IMAGES_TO_PDF_TIMEOUT_MS,
    "pdf-to-images": env.PDF_TO_IMAGES_TIMEOUT_MS,
    "image-convert": env.IMAGE_TIMEOUT_MS,
    "image-compress": env.IMAGE_TIMEOUT_MS,
    "color-picker": env.IMAGE_TIMEOUT_MS,
    "csv-to-json": env.DATA_TIMEOUT_MS,
    "json-to-csv": env.DATA_TIMEOUT_MS,
    "json-format": env.DATA_TIMEOUT_MS,
    "table-preview": env.DATA_TIMEOUT_MS,
    "text-case": env.TEXT_TIMEOUT_MS,
    "text-counter": env.TEXT_TIMEOUT_MS,
    "text-cleaner": env.TEXT_TIMEOUT_MS,
  }),
});

export function assertCloudModeForProduction() {
  if (config.isProduction && (config.storageDriver !== "gcs" || config.dbDriver !== "firestore")) {
    throw new Error("Cloud adapters are required in production.");
  }
}
