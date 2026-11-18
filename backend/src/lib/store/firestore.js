import { Firestore, Timestamp } from "@google-cloud/firestore";
import { config } from "../../config/env.js";
import { LeaseLostError } from "../errors.js";
import { utcDay } from "./helpers.js";

function isTimestamp(value) {
  return value instanceof Timestamp;
}

function toFirestore(value) {
  if (value === undefined) return undefined;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(toFirestore);
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) output[key] = toFirestore(entry);
    }
    return output;
  }
  return value;
}

function fromFirestore(value) {
  if (isTimestamp(value)) return value.toDate();
  if (Array.isArray(value)) return value.map(fromFirestore);
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = fromFirestore(entry);
    }
    return output;
  }
  return value;
}

function withId(snapshot) {
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...fromFirestore(snapshot.data()) };
}

/**
 * Firestore-backed persistence for jobs, uploads, users and daily quota.
 * All writes go through the Admin SDK; client writes are denied by rules.
 */
export class FirestoreStore {
  constructor() {
    this.driver = "firestore";
    this.db = new Firestore({
      projectId: config.gcpProjectId,
      databaseId: config.firestoreDatabaseId,
      ignoreUndefined: true,
    });
    this.jobs = this.db.collection("jobs");
    this.uploads = this.db.collection("uploads");
    this.users = this.db.collection("users");
    this.usage = this.db.collection("usage");
  }

  async init() {
    return true;
  }

  async health() {
    await this.jobs.limit(1).get();
    return true;
  }

  async createUpload(doc) {
    await this.uploads.doc(doc.id).set(toFirestore(doc));
    return doc;
  }

  async getUpload(id) {
    return withId(await this.uploads.doc(id).get());
  }

  async updateUpload(id, patch) {
    const ref = this.uploads.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    await ref.set(toFirestore(patch), { merge: true });
    return { id, ...fromFirestore(snap.data()), ...patch };
  }

  async deleteUpload(id) {
    await this.uploads.doc(id).delete();
  }

  async listExpiredUploads(now = new Date()) {
    const snap = await this.uploads
      .where("status", "==", "pending")
      .where("expiresAt", "<=", Timestamp.fromDate(now))
      .limit(100)
      .get();
    return snap.docs.map(withId);
  }

  async createJob(doc) {
    await this.jobs.doc(doc.id).set(toFirestore(doc));
    return doc;
  }

  async getJob(id) {
    return withId(await this.jobs.doc(id).get());
  }

  async updateJob(id, patch) {
    const ref = this.jobs.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    await ref.set(toFirestore(patch), { merge: true });
    return { id, ...fromFirestore(snap.data()), ...patch };
  }

  async claimNextJob(workerId, leaseMs) {
    return this.db.runTransaction(async (transaction) => {
      const query = this.jobs
        .where("status", "==", "queued")
        .orderBy("createdAt", "asc")
        .limit(5);
      const snap = await transaction.get(query);
      const candidate = snap.docs.find((doc) => doc.data().status === "queued");
      if (!candidate) return null;

      const data = fromFirestore(candidate.data());
      const now = new Date();
      const patch = {
        status: "processing",
        attempts: (data.attempts || 0) + 1,
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        startedAt: data.startedAt || now,
        updatedAt: now,
      };
      transaction.update(candidate.ref, toFirestore(patch));
      return { id: candidate.id, ...data, ...patch };
    });
  }

  async renewLease(jobId, workerId, leaseMs) {
    const ref = this.jobs.doc(jobId);
    return this.db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return false;
      const data = snap.data();
      if (data.status !== "processing" || data.leaseOwner !== workerId) return false;
      transaction.update(ref, {
        leaseExpiresAt: Timestamp.fromDate(new Date(Date.now() + leaseMs)),
        updatedAt: Timestamp.now(),
      });
      return true;
    });
  }

  async completeJob(jobId, workerId, { result, output, expiresAt }) {
    const ref = this.jobs.doc(jobId);
    return this.db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new LeaseLostError();
      const data = fromFirestore(snap.data());
      if (data.status !== "processing" || data.leaseOwner !== workerId) {
        throw new LeaseLostError();
      }
      const now = new Date();
      const patch = {
        status: "done",
        result: { ...result, key: output.key },
        output,
        error: null,
        completedAt: now,
        updatedAt: now,
        expiresAt,
        leaseOwner: null,
        leaseExpiresAt: null,
      };
      transaction.update(ref, toFirestore(patch));
      return { id: jobId, ...data, ...patch };
    });
  }

  async failJob(jobId, workerId, { error, expiresAt }) {
    const ref = this.jobs.doc(jobId);
    return this.db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new LeaseLostError();
      const data = fromFirestore(snap.data());
      if (data.status !== "processing" || data.leaseOwner !== workerId) {
        throw new LeaseLostError();
      }
      const now = new Date();
      const patch = {
        status: "failed",
        error,
        completedAt: now,
        updatedAt: now,
        expiresAt,
        leaseOwner: null,
        leaseExpiresAt: null,
      };
      transaction.update(ref, toFirestore(patch));
      return { id: jobId, ...data, ...patch };
    });
  }

  async requeueJob(jobId, workerId) {
    const ref = this.jobs.doc(jobId);
    return this.db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return false;
      const data = snap.data();
      if (data.status !== "processing" || data.leaseOwner !== workerId) return false;
      const now = new Date();
      transaction.update(ref, {
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        queuedAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
      return true;
    });
  }

  async recoverExpiredLeases(maxAttempts) {
    const now = new Date();
    const snap = await this.jobs
      .where("status", "==", "processing")
      .where("leaseExpiresAt", "<", Timestamp.fromDate(now))
      .limit(50)
      .get();

    let requeued = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      const outcome = await this.db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(doc.ref);
        if (!fresh.exists) return null;
        const data = fromFirestore(fresh.data());
        if (data.status !== "processing" || !data.leaseExpiresAt || data.leaseExpiresAt > new Date()) {
          return null;
        }
        const stamp = new Date();
        if ((data.attempts || 0) < maxAttempts) {
          transaction.update(doc.ref, {
            status: "queued",
            leaseOwner: null,
            leaseExpiresAt: null,
            queuedAt: Timestamp.fromDate(stamp),
            updatedAt: Timestamp.fromDate(stamp),
          });
          return "requeued";
        }
        transaction.update(doc.ref, {
          status: "failed",
          error: {
            code: "WORKER_LOST",
            message: "Processing was interrupted. Please try again.",
          },
          completedAt: Timestamp.fromDate(stamp),
          updatedAt: Timestamp.fromDate(stamp),
          expiresAt: Timestamp.fromDate(new Date(stamp.getTime() + config.resultRetentionMs)),
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return "failed";
      });
      if (outcome === "requeued") requeued += 1;
      if (outcome === "failed") failed += 1;
    }

    return { requeued, failed };
  }

  async listUserJobs(uid, limit = 25) {
    const snap = await this.jobs
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map(withId);
  }

  async countActiveJobs(uid) {
    const snap = await this.jobs
      .where("uid", "==", uid)
      .where("status", "in", ["queued", "processing"])
      .count()
      .get();
    return snap.data().count;
  }

  async deleteJob(id) {
    await this.jobs.doc(id).delete();
  }

  async deleteUserTerminalJobs(uid) {
    const snap = await this.jobs
      .where("uid", "==", uid)
      .where("status", "in", ["done", "failed", "expired"])
      .limit(400)
      .get();
    const batch = this.db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    if (snap.size > 0) await batch.commit();
    return snap.size;
  }

  async listExpiredJobs(now = new Date()) {
    const snap = await this.jobs
      .where("status", "in", ["done", "failed"])
      .where("expiresAt", "<=", Timestamp.fromDate(now))
      .limit(100)
      .get();
    return snap.docs.map(withId);
  }

  async listJobsOlderThan(cutoff) {
    const snap = await this.jobs
      .where("createdAt", "<", Timestamp.fromDate(cutoff))
      .limit(100)
      .get();
    return snap.docs.map(withId);
  }

  async getUsage(uid) {
    const day = utcDay();
    const snap = await this.usage.doc(uid).get();
    const data = snap.exists ? fromFirestore(snap.data()) : null;
    if (!data || data.day !== day) {
      return { uid, day, jobsToday: 0, bytesToday: 0 };
    }
    return { uid, ...data };
  }

  async addUsage(uid, { jobs = 0, bytes = 0 }) {
    const ref = this.usage.doc(uid);
    await this.db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const day = utcDay();
      const current = snap.exists ? fromFirestore(snap.data()) : null;
      const base = current && current.day === day ? current : { jobsToday: 0, bytesToday: 0 };
      transaction.set(
        ref,
        toFirestore({
          uid,
          day,
          jobsToday: base.jobsToday + jobs,
          bytesToday: base.bytesToday + bytes,
          updatedAt: new Date(),
        }),
        { merge: true },
      );
    });
  }

  async upsertUser(user) {
    await this.users.doc(user.uid).set(
      toFirestore({
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
        updatedAt: new Date(),
        createdAt: user.createdAt || new Date(),
      }),
      { merge: true },
    );
  }
}
