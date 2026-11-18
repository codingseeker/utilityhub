import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Set the secret before importing the environment-bound modules. dotenv does
// not override an existing process value, so .env.test cannot clobber it.
process.env.WORKER_SHARED_SECRET = "worker-test-shared-secret-123456";

let harness;

beforeAll(async () => {
  const { createHarness } = await import("./helpers.js");
  harness = await createHarness();
});

afterAll(async () => {
  if (harness) await harness.close();
});

describe("worker authentication", () => {
  it("rejects a missing shared secret", async () => {
    const response = await harness.worker.post("/internal/run").send({}).expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects an incorrect shared secret", async () => {
    await harness.worker
      .post("/internal/run")
      .set("X-Worker-Secret", "wrong-secret")
      .send({})
      .expect(403);
  });

  it("accepts the configured shared secret and an empty queue", async () => {
    const response = await harness.worker
      .post("/internal/run")
      .set("X-Worker-Secret", "worker-test-shared-secret-123456")
      .send({})
      .expect(200);
    expect(response.body.data.processed).toBe(0);
  });
});
