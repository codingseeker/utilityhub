import { Storage } from "@google-cloud/storage";
import { config } from "../../config/env.js";
import { AppError } from "../errors.js";

function safeAsciiName(value) {
  return String(value || "download")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 180);
}

export class GcsObjectStore {
  constructor() {
    this.driver = "gcs";
    this.storage = new Storage({ projectId: config.gcpProjectId });
    this.bucket = this.storage.bucket(config.gcsBucket);
  }

  async init() {
    return true;
  }

  async createUploadUrl({ key, contentType }) {
    const file = this.bucket.file(key);
    const expires = Date.now() + config.uploadUrlTtlSeconds * 1000;
    try {
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires,
        contentType,
      });
      return {
        url,
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresAt: new Date(expires).toISOString(),
      };
    } catch (error) {
      throw new AppError(
        "STORAGE_UNAVAILABLE",
        503,
        "Cloud storage is temporarily unavailable. Try again shortly.",
        undefined,
        { cause: error },
      );
    }
  }

  async createDownloadUrl({ key, fileName, mimeType }) {
    const file = this.bucket.file(key);
    const expires = Date.now() + config.downloadUrlTtlSeconds * 1000;
    try {
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires,
        responseDisposition: `attachment; filename="${safeAsciiName(fileName)}"`,
        responseType: mimeType || "application/octet-stream",
      });
      return { url, expiresAt: new Date(expires).toISOString() };
    } catch (error) {
      throw new AppError(
        "STORAGE_UNAVAILABLE",
        503,
        "Cloud storage is temporarily unavailable. Try again shortly.",
        undefined,
        { cause: error },
      );
    }
  }

  async head(key) {
    try {
      const [metadata] = await this.bucket.file(key).getMetadata();
      return {
        sizeBytes: Number(metadata.size || 0),
        contentType: metadata.contentType || "application/octet-stream",
        updatedAt: metadata.updated || null,
      };
    } catch (error) {
      if (error?.code === 404) return null;
      throw error;
    }
  }

  async readHead(key, length = 4100) {
    try {
      const [buffer] = await this.bucket.file(key).download({ start: 0, end: length - 1 });
      return buffer;
    } catch (error) {
      if (error?.code === 404) {
        throw new AppError("UPLOAD_NOT_FOUND", 404, "An uploaded file could not be found.");
      }
      throw error;
    }
  }

  async downloadToFile(key, destination) {
    try {
      await this.bucket.file(key).download({ destination });
    } catch (error) {
      if (error?.code === 404) {
        throw new AppError("UPLOAD_NOT_FOUND", 404, "An uploaded file could not be found.");
      }
      throw error;
    }
  }

  async putFile(key, filePath, contentType) {
    const [result] = await this.bucket.upload(filePath, {
      destination: key,
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "private, no-store",
      },
    });
    return { sizeBytes: Number(result.metadata.size || 0), key };
  }

  async delete(key) {
    try {
      await this.bucket.file(key).delete({ ignoreNotFound: true });
    } catch (error) {
      if (error?.code !== 404) throw error;
    }
  }

  async deletePrefix(prefix) {
    const [files] = await this.bucket.getFiles({ prefix });
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  }

  async health() {
    const [exists] = await this.bucket.exists();
    if (!exists) {
      throw new Error(`Bucket ${config.gcsBucket} is not accessible.`);
    }
    return true;
  }
}
