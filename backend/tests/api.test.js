import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config/env.js";
import {
  asUser,
  createCloudJob,
  createHarness,
  downloadBytes,
  file,
  initUploads,
  processNext,
  putUpload,
  uploadFiles,
} from "./helpers.js";

let harness;

afterEach(async () => {
  if (harness) await harness.close();
  harness = null;
});

describe("api surface", () => {
  it("reports liveness and readiness", async () => {
    harness = await createHarness();
    const live = await harness.api.get("/api/v1/health/live").expect(200);
    expect(live.body.data).toMatchObject({ status: "ok", service: "utilityhub-api", version: "2.0.0" });

    const ready = await harness.api.get("/api/v1/health/ready").expect(200);
    expect(ready.body.data.status).toBe("ready");
    expect(ready.body.data.checks).toEqual({ store: "ok", storage: "ok" });
  });

  it("publishes the catalog with cloud and client tools", async () => {
    harness = await createHarness();
    const response = await harness.api.get("/api/v1/operations").expect(200);
    const { operations, categories } = response.body.data;
    const cloud = operations.filter((operation) => operation.runtime === "cloud");
    const client = operations.filter((operation) => operation.runtime === "client");
    expect(cloud).toHaveLength(16);
    expect(client.map((operation) => operation.id).sort()).toEqual([
      "percentage-calculator",
      "unit-converter",
    ]);
    for (const operation of client) {
      expect(operation.input).toMatchObject({ kind: "none", minFiles: 0, maxFiles: 0 });
    }
    expect(categories.map((category) => category.id)).toEqual([
      "pdf",
      "photo",
      "data",
      "text",
      "utilities",
    ]);
    expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  });

  it("rejects unauthenticated cloud routes", async () => {
    harness = await createHarness();
    const response = await harness.api.get("/api/v1/me").expect(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    await harness.api.get("/api/v1/jobs/job_missing").expect(401);
    await harness.api.post("/api/v1/jobs").send({ operation: "merge-pdf", uploads: ["x"] }).expect(401);
  });

  it("exchanges a session for profile and quota", async () => {
    harness = await createHarness();
    const response = await asUser(harness.api.post("/api/v1/auth/session"), "alice").expect(200);
    expect(response.body.data).toMatchObject({ uid: "alice" });
    expect(response.body.data.quota.jobsPerDay).toBe(config.quotaJobsPerDay);
  });

  it("rejects unsupported upload types before signing", async () => {
    harness = await createHarness();
    const response = await asUser(harness.api.post("/api/v1/uploads/init"), "alice")
      .send({ files: [{ name: "payload.exe", sizeBytes: 10, mimeType: "application/octet-stream" }] })
      .expect(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("rejects tampered signed URLs", async () => {
    harness = await createHarness();
    const uploads = await initUploads(harness, "alice", [file("notes.txt", Buffer.from("hello"), "text/plain")]);
    const url = new URL(uploads[0].url);
    url.searchParams.set("signature", "0".repeat(64));
    const response = await harness.api
      .put(`${url.pathname}${url.search}`)
      .set("Content-Type", "text/plain")
      .send(Buffer.from("hello"))
      .expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("runs a text job through signed upload and signed download", async () => {
    harness = await createHarness();
    const { job } = await createCloudJob(harness, "alice", {
      operation: "text-case",
      files: [file("notes.txt", Buffer.from("hello world\nsecond line"), "text/plain")],
      options: { mode: "upper" },
    });

    expect(job.status).toBe("queued");
    const results = await processNext(harness);
    expect(results).toEqual([{ status: "done" }]);

    const status = await asUser(harness.api.get(`/api/v1/jobs/${job.id}`), "alice").expect(200);
    expect(status.body.data.status).toBe("done");
    expect(status.body.data.downloadAvailable).toBe(true);
    expect(status.body.data.result.mimeType).toBe("text/plain");

    const { info, bytes } = await downloadBytes(harness, "alice", job.id);
    expect(info.fileName).toMatch(/\.txt$/);
    expect(bytes.toString("utf8")).toBe("HELLO WORLD\nSECOND LINE");
  });

  it("does not expose another user's job or upload", async () => {
    harness = await createHarness();
    const { job, uploads } = await createCloudJob(harness, "alice", {
      operation: "text-counter",
      files: [file("notes.txt", Buffer.from("one two three"), "text/plain")],
    });
    await processNext(harness);

    await asUser(harness.api.get(`/api/v1/jobs/${job.id}`), "bob").expect(404);
    await asUser(harness.api.get(`/api/v1/jobs/${job.id}/download`), "bob").expect(404);
    await asUser(harness.api.delete(`/api/v1/uploads/${uploads[0].uploadId}`), "bob").expect(404);
  });

  it("reports expired results and refuses download", async () => {
    harness = await createHarness();
    const { job } = await createCloudJob(harness, "alice", {
      operation: "text-counter",
      files: [file("notes.txt", Buffer.from("one two"), "text/plain")],
    });
    await processNext(harness);

    await harness.store.updateJob(job.id, { expiresAt: new Date(Date.now() - 60_000) });
    const status = await asUser(harness.api.get(`/api/v1/jobs/${job.id}`), "alice").expect(200);
    expect(status.body.data.status).toBe("expired");
    expect(status.body.data.downloadAvailable).toBe(false);

    const download = await asUser(harness.api.get(`/api/v1/jobs/${job.id}/download`), "alice").expect(410);
    expect(download.body.error.code).toBe("JOB_EXPIRED");
  });

  it("refuses to delete consumed uploads and active jobs", async () => {
    harness = await createHarness();
    const { job, uploads } = await createCloudJob(harness, "alice", {
      operation: "text-counter",
      files: [file("notes.txt", Buffer.from("one two"), "text/plain")],
    });

    const consumed = await asUser(
      harness.api.delete(`/api/v1/uploads/${uploads[0].uploadId}`),
      "alice",
    ).expect(409);
    expect(consumed.body.error.code).toBe("UPLOAD_IN_USE");

    const active = await asUser(harness.api.delete(`/api/v1/jobs/${job.id}`), "alice").expect(409);
    expect(active.body.error.code).toBe("JOB_ACTIVE");
  });

  it("deletes a terminal job and its objects", async () => {
    harness = await createHarness();
    const { job } = await createCloudJob(harness, "alice", {
      operation: "text-case",
      files: [file("notes.txt", Buffer.from("clean me"), "text/plain")],
      options: { mode: "lower" },
    });
    await processNext(harness);

    await asUser(harness.api.delete(`/api/v1/jobs/${job.id}`), "alice").expect(204);
    await asUser(harness.api.get(`/api/v1/jobs/${job.id}`), "alice").expect(404);
  });

  it("lists and clears terminal history without touching active jobs", async () => {
    harness = await createHarness();
    const first = await createCloudJob(harness, "alice", {
      operation: "text-counter",
      files: [file("one.txt", Buffer.from("one two"), "text/plain")],
    });
    await processNext(harness);
    const active = await createCloudJob(harness, "alice", {
      operation: "text-counter",
      files: [file("two.txt", Buffer.from("three four"), "text/plain")],
    });

    const listed = await asUser(harness.api.get("/api/v1/me/jobs?limit=10"), "alice").expect(200);
    expect(listed.body.data.jobs).toHaveLength(2);

    const cleared = await asUser(harness.api.delete("/api/v1/me/jobs"), "alice").expect(200);
    expect(cleared.body.data.deleted).toBe(1);

    await asUser(harness.api.get(`/api/v1/jobs/${first.job.id}`), "alice").expect(404);
    await asUser(harness.api.get(`/api/v1/jobs/${active.job.id}`), "alice").expect(200);
  });

  it("enforces the daily job quota", async () => {
    harness = await createHarness();
    const uploads = await uploadFiles(harness, "alice", [
      file("notes.txt", Buffer.from("quota"), "text/plain"),
    ]);
    await harness.store.addUsage("alice", { jobs: config.quotaJobsPerDay });

    const response = await asUser(harness.api.post("/api/v1/jobs"), "alice")
      .send({
        operation: "text-counter",
        uploads: uploads.map((upload) => upload.uploadId),
      })
      .expect(429);
    expect(response.body.error.code).toBe("QUOTA_EXCEEDED");
  });

  it("rejects invalid options with field details", async () => {
    harness = await createHarness();
    const uploads = await uploadFiles(harness, "alice", [
      file("notes.txt", Buffer.from("hello"), "text/plain"),
    ]);
    const response = await asUser(harness.api.post("/api/v1/jobs"), "alice")
      .send({
        operation: "text-case",
        uploads: uploads.map((upload) => upload.uploadId),
        options: { mode: "sideways" },
      })
      .expect(422);
    expect(response.body.error.code).toBe("INVALID_OPTIONS");
    expect(response.body.error.details[0].field).toBe("options.mode");
  });

  it("accepts worker invocations over HTTP", async () => {
    harness = await createHarness();
    const { job } = await createCloudJob(harness, "alice", {
      operation: "text-counter",
      files: [file("notes.txt", Buffer.from("alpha beta gamma"), "text/plain")],
    });

    const response = await harness.worker
      .post("/internal/run")
      .send({ jobId: job.id })
      .expect(200);
    expect(response.body.data.results).toEqual(["done"]);

    const status = await asUser(harness.api.get(`/api/v1/jobs/${job.id}`), "alice").expect(200);
    expect(status.body.data.result.summary.words).toBe(3);
  });

  it("returns a safe error envelope with a request id", async () => {
    harness = await createHarness();
    const response = await asUser(harness.api.get("/api/v1/jobs/job_nope"), "alice").expect(404);
    expect(response.body).toMatchObject({
      error: { code: "JOB_NOT_FOUND" },
      requestId: response.headers["x-request-id"],
    });
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });
});
