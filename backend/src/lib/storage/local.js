import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsNative from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "../../config/env.js";
import { AppError } from "../errors.js";

function assertKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) {
    throw new AppError("INVALID_UPLOAD", 422, "The storage key is invalid.");
  }
  if (key.startsWith("/") || key.includes("..") || key.includes("\\") || key.includes("\u0000")) {
    throw new AppError("INVALID_UPLOAD", 422, "The storage key is invalid.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) {
    throw new AppError("INVALID_UPLOAD", 422, "The storage key is invalid.");
  }
  return key;
}

function metaPathFor(key) {
  const digest = crypto.createHash("sha256").update(key).digest("hex");
  return path.join(config.storageRoot, ".meta", `${digest}.json`);
}

/**
 * Local object store used only for development and tests. It implements the
 * same signed-URL contract as GCS so the browser flow is genuinely exercised.
 */
export class LocalObjectStore {
  constructor() {
    this.driver = "local";
    this.root = config.storageRoot;
  }

  async init() {
    await fs.mkdir(path.join(this.root, ".meta"), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.root, "uploads"), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.root, "results"), { recursive: true, mode: 0o700 });
  }

  resolve(key) {
    assertKey(key);
    const target = path.resolve(this.root, key);
    const rootWithSeparator = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
    if (target !== this.root && !target.startsWith(rootWithSeparator)) {
      throw new AppError("INVALID_UPLOAD", 422, "The storage key is invalid.");
    }
    return target;
  }

  sign(action, key, expires) {
    return crypto
      .createHmac("sha256", config.signedUrlSecret)
      .update(`${action}\n${key}\n${expires}`)
      .digest("hex");
  }

  buildUrl(action, key, extra = {}) {
    const expires = Date.now() + (action === "write" ? config.uploadUrlTtlSeconds : config.downloadUrlTtlSeconds) * 1000;
    const params = new URLSearchParams({
      key,
      action,
      expires: String(expires),
      signature: this.sign(action, key, expires),
      ...extra,
    });
    return {
      url: `${config.publicApiUrl}/api/v1/dev-storage?${params.toString()}`,
      expiresAt: new Date(expires).toISOString(),
    };
  }

  async createUploadUrl({ key, contentType }) {
    const { url, expiresAt } = this.buildUrl("write", key);
    return { url, method: "PUT", headers: { "Content-Type": contentType }, expiresAt };
  }

  async createDownloadUrl({ key, fileName, mimeType }) {
    const { url, expiresAt } = this.buildUrl("read", key, {
      filename: fileName || "download",
      mime: mimeType || "application/octet-stream",
    });
    return { url, expiresAt };
  }

  verifySignature({ action, key, expires, signature }) {
    const expiresNumber = Number(expires);
    if (!Number.isSafeInteger(expiresNumber) || expiresNumber < Date.now()) {
      throw new AppError("SIGNED_URL_EXPIRED", 410, "This link has expired.");
    }
    if (!["read", "write"].includes(action)) {
      throw new AppError("FORBIDDEN", 403, "This link is not valid.");
    }
    const expected = this.sign(action, key, expiresNumber);
    const provided = String(signature || "");
    if (
      provided.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      throw new AppError("FORBIDDEN", 403, "This link is not valid.");
    }
  }

  async writeObject(key, buffer, contentType) {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, buffer, { mode: 0o600 });
    await fs.rename(temp, target);
    await fs.writeFile(
      metaPathFor(key),
      JSON.stringify({ contentType, sizeBytes: buffer.length, updatedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    return { sizeBytes: buffer.length, key };
  }

  async putFile(key, filePath, contentType) {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await pipeline(fsNative.createReadStream(filePath), fsNative.createWriteStream(target, { mode: 0o600 }));
    const stat = await fs.stat(target);
    await fs.writeFile(
      metaPathFor(key),
      JSON.stringify({ contentType, sizeBytes: stat.size, updatedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    return { sizeBytes: stat.size, key };
  }

  async head(key) {
    try {
      const target = this.resolve(key);
      const stat = await fs.stat(target);
      if (!stat.isFile()) return null;
      let contentType = "application/octet-stream";
      try {
        const meta = JSON.parse(await fs.readFile(metaPathFor(key), "utf8"));
        contentType = meta.contentType || contentType;
      } catch {
        // Metadata is best-effort for the local adapter.
      }
      return { sizeBytes: stat.size, contentType, updatedAt: stat.mtime.toISOString() };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async readHead(key, length = 4100) {
    const target = this.resolve(key);
    const handle = await fs.open(target, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async downloadToFile(key, destination) {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.copyFile(target, destination);
    await fs.chmod(destination, 0o600);
  }

  async delete(key) {
    try {
      await fs.rm(this.resolve(key), { force: true });
      await fs.rm(metaPathFor(key), { force: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async deletePrefix(prefix) {
    const base = this.resolve(prefix.replace(/\/+$/, ""));
    await fs.rm(base, { recursive: true, force: true });
  }

  async health() {
    await fs.access(this.root, fs.constants?.W_OK ?? 2);
    return true;
  }
}
