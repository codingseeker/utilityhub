import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../../config/env.js";
import { LeaseLostError, ProcessingError } from "../errors.js";
import { getOperation, validateJobFiles } from "../operations/catalog.js";
import { inspectDownloadedFile } from "../operations/validate-file.js";
import { sanitizeFileName } from "../util/filenames.js";
import { validateArtifact } from "./artifact.js";
import { getProcessor } from "./operations/index.js";

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", resolve);
    input.on("error", reject);
  });
  return hash.digest("hex");
}

function publicFailure(error, timedOut) {
  if (error instanceof ProcessingError) {
    return { code: error.code, message: error.publicMessage, retryable: error.retryable };
  }
  if (error?.name === "AbortError" || timedOut) {
    return {
      code: "PROCESSING_TIMEOUT",
      message: "Processing took too long and was stopped.",
      retryable: false,
    };
  }
  return {
    code: "PROCESSING_FAILED",
    message: "The document could not be processed.",
    retryable: false,
  };
}

export class JobRunner {
  constructor({ store, storage, logger }) {
    this.store = store;
    this.storage = storage;
    this.logger = logger;
    this.workerId = `worker-${crypto.randomUUID()}`;
  }

  async next() {
    await this.store.recoverExpiredLeases(config.worker.maxAttempts);
    return this.store.claimNextJob(this.workerId, config.worker.leaseMs);
  }

  async run(job) {
    const controller = new AbortController();
    let workDir = null;
    let outputKey = null;
    let timedOut = false;
    let leaseLost = false;
    let heartbeatBusy = false;
    let timeoutTimer = null;

    const heartbeat = setInterval(async () => {
      if (heartbeatBusy || leaseLost) return;
      heartbeatBusy = true;
      try {
        const renewed = await this.store.renewLease(job.id, this.workerId, config.worker.leaseMs);
        if (!renewed) {
          leaseLost = true;
          controller.abort();
        }
      } catch {
        leaseLost = true;
        controller.abort();
      } finally {
        heartbeatBusy = false;
      }
    }, config.worker.heartbeatMs);

    const operationTimeout = config.operationTimeouts[job.operation] ?? 120000;

    try {
      const definition = getOperation(job.operation);
      if (!definition) {
        throw new ProcessingError("INVALID_OPERATION", "This operation is not available.");
      }
      const processor = getProcessor(job.operation);
      if (!processor) {
        throw new ProcessingError("PROCESSING_FAILED", "This operation is not available.");
      }

      workDir = await fs.mkdtemp(path.join(os.tmpdir(), "utilityhub-"));
      const inputs = [];

      for (let index = 0; index < job.inputs.length; index += 1) {
        const input = job.inputs[index];
        const extension = path.extname(input.name).slice(1) || "bin";
        const filePath = path.join(workDir, `input-${index + 1}.${extension}`);
        try {
          await this.storage.downloadToFile(input.key, filePath);
        } catch (error) {
          if (error?.status === 404) {
            throw new ProcessingError(
              "UPLOAD_NOT_FOUND",
              "An input file is no longer available. Upload it again.",
            );
          }
          throw new ProcessingError("STORAGE_UNAVAILABLE", "Processing is temporarily unavailable.", {
            cause: error,
            retryable: true,
          });
        }

        const verified = await inspectDownloadedFile({
          filePath,
          name: input.name,
          declaredMime: input.mimeType,
        });

        if (!definition.accept.includes(verified.mimeType)) {
          throw new ProcessingError("INVALID_INPUT", "One or more files are not valid for this tool.");
        }

        inputs.push({
          file: {
            name: input.name,
            originalName: input.name,
            mimeType: verified.mimeType,
            sizeBytes: verified.sizeBytes,
            pageCount: verified.pageCount,
            extension: verified.extension,
          },
          filePath,
        });
      }

      validateJobFiles(job.operation, inputs.map((input) => input.file));

      const timeoutPromise = new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(
            new ProcessingError("PROCESSING_TIMEOUT", "Processing took too long and was stopped."),
          );
        }, operationTimeout);
      });

      const result = await Promise.race([
        Promise.resolve().then(() =>
          processor({
            job,
            inputs,
            options: job.options,
            workDir,
            timeoutMs: operationTimeout,
            signal: controller.signal,
          }),
        ),
        timeoutPromise,
      ]);

      if (controller.signal.aborted) {
        throw new ProcessingError(
          timedOut ? "PROCESSING_TIMEOUT" : "PROCESSING_FAILED",
          timedOut ? "Processing took too long and was stopped." : "The document could not be processed.",
        );
      }

      const artifact = await validateArtifact({
        filePath: result.artifactPath,
        mimeType: result.mimeType,
        expectedPages: result.pageCount,
        expectedEntries: result.expectedEntries,
      });

      const fileName = sanitizeFileName(result.fileName, `result.${result.extension}`);
      outputKey = `results/${job.uid}/${job.id}/${fileName}`;
      const stored = await this.storage.putFile(outputKey, result.artifactPath, result.mimeType);
      const digest = await sha256(result.artifactPath);

      const pageCount = result.pageCount ?? artifact.pageCount ?? null;
      const resultPayload = {
        fileName,
        mimeType: result.mimeType,
        extension: result.extension,
        sizeBytes: stored.sizeBytes,
        pageCount,
        summary: result.summary ?? {},
        sha256: digest,
      };

      await this.store.completeJob(job.id, this.workerId, {
        result: resultPayload,
        output: { key: outputKey, ...resultPayload },
        expiresAt: new Date(Date.now() + config.resultRetentionMs),
      });

      this.logger.info(
        {
          jobId: job.id,
          operation: job.operation,
          inputSizeBytes: job.inputSizeBytes,
          outputSizeBytes: stored.sizeBytes,
        },
        "job completed",
      );

      return { status: "done" };
    } catch (error) {
      if (leaseLost) {
        this.logger.warn({ jobId: job.id }, "job lease lost");
        return { status: "lease-lost" };
      }

      if (outputKey) {
        await this.storage.delete(outputKey).catch(() => undefined);
      }

      const failure = publicFailure(error, timedOut);

      if (
        failure.retryable &&
        !timedOut &&
        job.attempts < config.worker.maxAttempts &&
        !(error instanceof LeaseLostError)
      ) {
        try {
          const requeued = await this.store.requeueJob(job.id, this.workerId);
          if (requeued) {
            this.logger.warn({ jobId: job.id, code: failure.code }, "job requeued");
            return { status: "retried" };
          }
        } catch {
          // Fall through to failure recording.
        }
      }

      try {
        await this.store.failJob(job.id, this.workerId, {
          error: { code: failure.code, message: failure.message },
          expiresAt: new Date(Date.now() + config.resultRetentionMs),
        });
      } catch (updateError) {
        if (!(updateError instanceof LeaseLostError)) {
          this.logger.error({ jobId: job.id, err: updateError }, "failed to record job failure");
        }
      }

      this.logger.warn(
        {
          jobId: job.id,
          operation: job.operation,
          code: failure.code,
          internal: error?.message,
        },
        "job failed",
      );

      return { status: "failed", code: failure.code };
    } finally {
      clearInterval(heartbeat);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (workDir) {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  async drain({ max = 1, budgetMs = config.worker.runBudgetMs } = {}) {
    const started = Date.now();
    const results = [];
    while (results.length < max && Date.now() - started < budgetMs) {
      const job = await this.next();
      if (!job) break;
      const result = await this.run(job);
      results.push(result);
      if (result.status === "lease-lost") break;
    }
    return results;
  }

  async runById(jobId) {
    const job = await this.store.getJob(jobId);
    if (!job) return { status: "not-found" };
    if (job.status !== "queued") return { status: "skipped", state: job.status };
    const claimed = await this.store.claimNextJob(this.workerId, config.worker.leaseMs);
    if (!claimed || claimed.id !== jobId) {
      return { status: "skipped", state: "not-claimed" };
    }
    return this.run(claimed);
  }
}

export function createRunner(context) {
  return new JobRunner(context);
}
