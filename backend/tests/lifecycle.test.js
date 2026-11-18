import { afterEach, describe, expect, it } from "vitest";
import { runCleanup } from "../src/lib/services/cleanup.js";
import {
  createCloudJob,
  createHarness,
  file,
  initUploads,
  processNext,
} from "./helpers.js";

let harness;

afterEach(async () => {
  if (harness) await harness.close();
  harness = null;
});

const MINUTE = 60_000;

async function queueTextJob(uid = "alice") {
  const { job } = await createCloudJob(harness, uid, {
    operation: "text-counter",
    files: [file("notes.txt", Buffer.from("One two three."), "text/plain")],
  });
  return job;
}

describe("queue leases", () => {
  it("never claims the same queued job twice", async () => {
    harness = await createHarness();
    const job = await queueTextJob();

    const first = await harness.store.claimNextJob("worker-a", 60_000);
    expect(first.id).toBe(job.id);
    expect(first.status).toBe("processing");

    const second = await harness.store.claimNextJob("worker-b", 60_000);
    expect(second).toBeNull();
  });

  it("requeues an expired lease until max attempts is reached", async () => {
    harness = await createHarness();
    const job = await queueTextJob();

    const claimed = await harness.store.claimNextJob("worker-a", 1);
    expect(claimed.attempts).toBe(1);

    await harness.store.updateJob(job.id, {
      leaseExpiresAt: new Date(Date.now() - MINUTE),
    });
    const recovery = await harness.store.recoverExpiredLeases(2);
    expect(recovery).toEqual({ requeued: 1, failed: 0 });

    const requeued = await harness.store.getJob(job.id);
    expect(requeued.status).toBe("queued");
    expect(requeued.leaseOwner).toBeNull();

    const reclaimed = await harness.store.claimNextJob("worker-b", 60_000);
    expect(reclaimed.id).toBe(job.id);
    expect(reclaimed.attempts).toBe(2);

    await harness.store.updateJob(job.id, {
      leaseExpiresAt: new Date(Date.now() - MINUTE),
    });
    const exhausted = await harness.store.recoverExpiredLeases(2);
    expect(exhausted).toEqual({ requeued: 0, failed: 1 });

    const failed = await harness.store.getJob(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error.code).toBe("WORKER_LOST");
    expect(failed.expiresAt).toBeInstanceOf(Date);
  });

  it("rejects a lease renewal from a different worker", async () => {
    harness = await createHarness();
    const job = await queueTextJob();
    await harness.store.claimNextJob("worker-a", 60_000);

    expect(await harness.store.renewLease(job.id, "worker-b", 60_000)).toBe(false);
    expect(await harness.store.renewLease(job.id, "worker-a", 60_000)).toBe(true);
  });
});

describe("cleanup", () => {
  it("expires finished jobs, deletes objects, and purges old metadata", async () => {
    harness = await createHarness();
    const job = await queueTextJob();
    const [processed] = await processNext(harness);
    expect(processed.status).toBe("done");

    const stored = await harness.store.getJob(job.id);
    expect(await harness.storage.head(stored.output.key)).not.toBeNull();

    await harness.store.updateJob(job.id, {
      expiresAt: new Date(Date.now() - MINUTE),
    });
    const results = await runCleanup(harness.context);
    expect(results.expiredJobs).toBe(1);

    const expired = await harness.store.getJob(job.id);
    expect(expired.status).toBe("expired");
    expect(await harness.storage.head(stored.output.key)).toBeNull();
    for (const input of stored.inputs) {
      expect(await harness.storage.head(input.key)).toBeNull();
    }

    // Metadata older than the retention window is removed on a later run.
    await harness.store.updateJob(job.id, {
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
    });
    const purged = await runCleanup(harness.context);
    expect(purged.purgedJobs).toBe(1);
    expect(await harness.store.getJob(job.id)).toBeNull();
  });

  it("removes expired upload sessions and their objects", async () => {
    harness = await createHarness();
    const uploads = await initUploads(harness, "alice", [
      { name: "orphan.txt", buffer: Buffer.from("orphan"), mimeType: "text/plain" },
    ]);
    await harness.store.updateUpload(uploads[0].uploadId, {
      expiresAt: new Date(Date.now() - MINUTE),
    });

    const results = await runCleanup(harness.context);
    expect(results.expiredUploads).toBe(1);
    expect(await harness.store.getUpload(uploads[0].uploadId)).toBeNull();
  });
});
