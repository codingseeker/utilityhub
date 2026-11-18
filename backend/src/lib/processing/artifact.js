import fs from "node:fs/promises";
import sharp from "sharp";
import { ProcessingError } from "../errors.js";
import { assertPdfPages } from "../util/pdfinfo.js";

const MIME_EXTENSIONS = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/zip": "zip",
  "application/json": "json",
  "text/plain": "txt",
  "text/csv": "csv",
};

export function extensionForMime(mimeType) {
  return MIME_EXTENSIONS[mimeType] || null;
}

async function readHead(filePath, length) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function countZipEntries(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size < 22) return 0;
    const length = Math.min(size, 65557);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
      if (buffer.readUInt32LE(offset) === 0x06054b50) {
        return buffer.readUInt16LE(offset + 10);
      }
    }
    return 0;
  } finally {
    await handle.close();
  }
}

function invalid() {
  return new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
}

export async function validateArtifact({ filePath, mimeType, expectedPages, expectedEntries }) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw invalid();
  }
  if (!stat.isFile() || stat.size <= 0) throw invalid();

  if (mimeType === "application/pdf") {
    const head = await readHead(filePath, 1024);
    if (!head.includes(Buffer.from("%PDF-"))) throw invalid();
    try {
      const info = await assertPdfPages(filePath, expectedPages);
      return { pageCount: info.pages, size: stat.size };
    } catch {
      throw invalid();
    }
  }

  if (["image/png", "image/jpeg", "image/webp", "image/tiff"].includes(mimeType)) {
    const format = mimeType.split("/")[1];
    try {
      const metadata = await sharp(filePath).metadata();
      if (metadata.format !== format || !metadata.width || !metadata.height) throw new Error("invalid");
      return { pageCount: null, size: stat.size, width: metadata.width, height: metadata.height };
    } catch {
      throw invalid();
    }
  }

  if (mimeType === "application/zip") {
    const head = await readHead(filePath, 4);
    if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b) throw invalid();
    if (Number.isInteger(expectedEntries)) {
      const entries = await countZipEntries(filePath);
      if (entries !== expectedEntries) throw invalid();
    }
    return { pageCount: null, size: stat.size };
  }

  if (mimeType === "application/json") {
    try {
      JSON.parse(await fs.readFile(filePath, "utf8"));
      return { pageCount: null, size: stat.size };
    } catch {
      throw invalid();
    }
  }

  if (mimeType === "text/plain" || mimeType === "text/csv") {
    const text = await fs.readFile(filePath, "utf8");
    if (text.length === 0 && stat.size > 0) throw invalid();
    return { pageCount: null, size: stat.size };
  }

  throw invalid();
}
