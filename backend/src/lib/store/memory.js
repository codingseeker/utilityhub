import { LeaseLostError } from "../errors.js";
import { clone, utcDay } from "./helpers.js";

/**
 * In-memory persistence adapter. It is only used for local development and
 * automated tests. Production startup refuses DB_DRIVER=memory.
 */
export class MemoryStore {
  constructor() {
    this.driver = "memory";
    this.jobs = new Map();
    this.uploads = new Map();
    this.users = new Map();
    this.usage = new Map();
  }

  async init() {
    return true;
  }

  async health() {
    return true;
  }

  reset() {
    this.jobs.clear();
    this.uploads.clear();
    this.users.clear();
    this.usage.clear();
  }

  async createUpload(doc) {
    this.uploads.set(doc.id, clone(doc));
    return clone(doc);
  }

  async getUpload(id) {
    return clone(this.uploads.get(id)) || null;
  }

  async updateUpload(id, patch) {
    const current = this.uploads.get(id);
    if (!current) return null;
    const next = { ...current, ...clone(patch) };
    this.uploads.set(id, next);
    return clone(next);
  }

  async deleteUpload(id) {
    this.uploads.delete(id);
  }

  async listExpiredUploads(now = new Date()) {
    return [...this.uploads.values()]
      .filter((upload) => upload.status === "pending" && upload.expiresAt <= now)
      .map(clone);
  }

  async createJob(doc) {
    this.jobs.set(doc.id, clone(doc));
    return clone(doc);
  }

  async getJob(id) {
    return clone(this.jobs.get(id)) || null;
  }

  async updateJob(id, patch) {
    const current = this.jobs.get(id);
    if (!current) return null;
    const next = { ...current, ...clone(patch) };
    this.jobs.set(id, next);
    return clone(next);
  }

  async claimNextJob(workerId, leaseMs) {
    const now = new Date();
    const candidates = [...this.jobs.values()]
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt);
    const job = candidates[0];
    if (!job) return null;

    const next = {
      ...job,
      status: "processing",
      attempts: (job.attempts || 0) + 1,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      startedAt: job.startedAt || now,
      updatedAt: now,
    };
    this.jobs.set(job.id, next);
    return clone(next);
  }

  async renewLease(jobId, workerId, leaseMs) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "processing" || job.leaseOwner !== workerId) {
      return false;
    }
    job.leaseExpiresAt = new Date(Date.now() + leaseMs);
    job.updatedAt = new Date();
    return true;
  }

  async completeJob(jobId, workerId, { result, output, expiresAt }) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "processing" || job.leaseOwner !== workerId) {
      throw new LeaseLostError();
    }
    const now = new Date();
    const next = {
      ...job,
      status: "done",
      result: { ...clone(result), key: output.key },
      output: clone(output),
      error: null,
      completedAt: now,
      updatedAt: now,
      expiresAt,
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    this.jobs.set(jobId, next);
    return clone(next);
  }

  async failJob(jobId, workerId, { error, expiresAt }) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "processing" || job.leaseOwner !== workerId) {
      throw new LeaseLostError();
    }
    const now = new Date();
    const next = {
      ...job,
      status: "failed",
      error: clone(error),
      completedAt: now,
      updatedAt: now,
      expiresAt,
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    this.jobs.set(jobId, next);
    return clone(next);
  }

  async requeueJob(jobId, workerId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "processing" || job.leaseOwner !== workerId) {
      return false;
    }
    const next = {
      ...job,
      status: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
      queuedAt: new Date(),
    };
    this.jobs.set(jobId, next);
    return true;
  }

  async recoverExpiredLeases(maxAttempts) {
    const now = new Date();
    let requeued = 0;
    let failed = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== "processing" || !job.leaseExpiresAt || job.leaseExpiresAt > now) {
        continue;
      }
      if ((job.attempts || 0) < maxAttempts) {
        job.status = "queued";
        job.leaseOwner = null;
        job.leaseExpiresAt = null;
        job.queuedAt = now;
        job.updatedAt = now;
        requeued += 1;
      } else {
        job.status = "failed";
        job.error = {
          code: "WORKER_LOST",
          message: "Processing was interrupted. Please try again.",
        };
        job.completedAt = now;
        job.updatedAt = now;
        job.expiresAt = new Date(now.getTime() + 24 * 3600000);
        job.leaseOwner = null;
        job.leaseExpiresAt = null;
        failed += 1;
      }
    }
    return { requeued, failed };
  }

  async listUserJobs(uid, limit = 25) {
    return [...this.jobs.values()]
      .filter((job) => job.uid === uid)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(clone);
  }

  async countActiveJobs(uid) {
    return [...this.jobs.values()].filter(
      (job) => job.uid === uid && (job.status === "queued" || job.status === "processing"),
    ).length;
  }

  async deleteJob(id) {
    this.jobs.delete(id);
  }

  async deleteUserTerminalJobs(uid) {
    let deleted = 0;
    for (const [id, job] of this.jobs) {
      if (job.uid === uid && (job.status === "done" || job.status === "failed" || job.status === "expired")) {
        this.jobs.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  async listExpiredJobs(now = new Date()) {
    return [...this.jobs.values()]
      .filter(
        (job) =>
          (job.status === "done" || job.status === "failed") &&
          job.expiresAt &&
          job.expiresAt <= now,
      )
      .map(clone);
  }

  async listJobsOlderThan(cutoff) {
    return [...this.jobs.values()].filter((job) => job.createdAt < cutoff).map(clone);
  }

  async getUsage(uid) {
    const current = this.usage.get(uid);
    const day = utcDay();
    if (!current || current.day !== day) {
      return { uid, day, jobsToday: 0, bytesToday: 0 };
    }
    return clone(current);
  }

  async addUsage(uid, { jobs = 0, bytes = 0 }) {
    const day = utcDay();
    const current = this.usage.get(uid);
    const base = current && current.day === day ? current : { uid, day, jobsToday: 0, bytesToday: 0 };
    this.usage.set(uid, {
      ...base,
      jobsToday: base.jobsToday + jobs,
      bytesToday: base.bytesToday + bytes,
    });
  }

  async upsertUser(user) {
    const current = this.users.get(user.uid) || {};
    this.users.set(user.uid, { ...current, ...clone(user), updatedAt: new Date() });
  }
}
