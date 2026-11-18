import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const backendRoot = path.resolve(import.meta.dirname, "..");
const importConfig = "import('./src/config/env.js').then(() => process.exit(0))";

function loadConfig(overrides) {
  return spawnSync(process.execPath, ["-e", importConfig], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      CORS_ORIGINS: "https://utilityhub.example",
      ...overrides,
    },
    encoding: "utf8",
  });
}

describe("production configuration guardrails", () => {
  it("refuses memory, local storage, and dev auth in production", () => {
    const result = loadConfig({
      STORAGE_DRIVER: "local",
      DB_DRIVER: "memory",
      AUTH_MODE: "dev",
      GCP_PROJECT_ID: "utilityhub-local",
      GCS_BUCKET: "utilityhub-local",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing to start in production");
    expect(result.stderr).toContain("STORAGE_DRIVER must be gcs");
    expect(result.stderr).toContain("DB_DRIVER must be firestore");
    expect(result.stderr).toContain("AUTH_MODE must be firebase");
  });

  it("accepts a complete cloud configuration without a local signing secret", () => {
    const result = loadConfig({
      STORAGE_DRIVER: "gcs",
      DB_DRIVER: "firestore",
      AUTH_MODE: "firebase",
      GCP_PROJECT_ID: "utilityhub-prod-project",
      GCS_BUCKET: "utilityhub-prod-bucket",
      SIGNED_URL_SECRET: "local-development-signing-secret-change-me",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects non-HTTPS CORS origins in production", () => {
    const result = loadConfig({
      STORAGE_DRIVER: "gcs",
      DB_DRIVER: "firestore",
      AUTH_MODE: "firebase",
      GCP_PROJECT_ID: "utilityhub-prod-project",
      GCS_BUCKET: "utilityhub-prod-bucket",
      CORS_ORIGINS: "http://localhost:5173",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CORS_ORIGINS must contain HTTPS origins");
  });
});
