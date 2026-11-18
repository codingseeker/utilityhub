import { config } from "../../config/env.js";

export async function runCleanup(context) {
  const { store, storage, logger } = context;
  const now = new Date();
  const results = { expiredJobs: 0, purgedJobs: 0, expiredUploads: 0 };

  for (const job of await store.listExpiredJobs(now)) {
    await storage.deletePrefix(`results/${job.uid}/${job.id}/`).catch(() => undefined);
    for (const input of job.inputs || []) {
      await storage.delete(input.key).catch(() => undefined);
    }
    await store.updateJob(job.id, { status: "expired", updatedAt: new Date() });
    results.expiredJobs += 1;
  }

  for (const upload of await store.listExpiredUploads(now)) {
    await storage.delete(upload.key).catch(() => undefined);
    await store.deleteUpload(upload.id);
    results.expiredUploads += 1;
  }

  const cutoff = new Date(now.getTime() - config.metadataRetentionMs);
  for (const job of await store.listJobsOlderThan(cutoff)) {
    if (job.status === "queued" || job.status === "processing") continue;
    await store.deleteJob(job.id);
    results.purgedJobs += 1;
  }

  logger.info(results, "cleanup complete");
  return results;
}
