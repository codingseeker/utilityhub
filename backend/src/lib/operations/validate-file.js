import fs from "node:fs/promises";
import sharp from "sharp";
import { config } from "../../config/env.js";
import { ProcessingError } from "../errors.js";
import { inspectPdf, PdfInspectionError } from "../util/pdfinfo.js";
import { detectSignature, extensionInfoFor } from "./catalog.js";

async function readHead(filePath, length = 4100) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function mapPdfError(error) {
  if (error instanceof PdfInspectionError) {
    if (error.code === "ENCRYPTED_PDF") {
      return new ProcessingError("ENCRYPTED_PDF", "Password-protected PDFs are not supported.");
    }
    if (error.code === "ENGINE_UNAVAILABLE") {
      return new ProcessingError("ENGINE_UNAVAILABLE", "A required processing engine is unavailable.", {
        retryable: true,
      });
    }
    return new ProcessingError("PDF_CORRUPTED", "This PDF cannot be read.");
  }
  return error;
}

export async function inspectDownloadedFile({ filePath, name, declaredMime }) {
  const info = extensionInfoFor(name);
  if (!info) {
    throw new ProcessingError("UNSUPPORTED_FILE_TYPE", "One of the files has an unsupported type.");
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw new ProcessingError("PROCESSING_FAILED", "An input file could not be read.", {
      retryable: true,
    });
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new ProcessingError("EMPTY_FILE", "One of the files is empty.");
  }
  if (stat.size > config.maxFileSizeBytes) {
    throw new ProcessingError("FILE_TOO_LARGE", "An input file is too large.");
  }

  const head = await readHead(filePath);
  const detected = detectSignature(head, name);
  if (!detected) {
    throw new ProcessingError("INVALID_FILE_SIGNATURE", "A file's content does not match its type.");
  }
  if (detected.mime !== info.mime) {
    throw new ProcessingError("MIME_MISMATCH", "A file's content does not match its extension.");
  }
  const declared = declaredMime?.split(";")[0]?.trim()?.toLowerCase();
  if (
    declared &&
    declared !== "application/octet-stream" &&
    declared !== detected.mime &&
    !(declared === "image/jpg" && detected.mime === "image/jpeg")
  ) {
    throw new ProcessingError("MIME_MISMATCH", "A file's content does not match its declared type.");
  }

  let pageCount = null;

  if (detected.kind === "pdf") {
    try {
      const pdf = await inspectPdf(filePath);
      pageCount = pdf.pages;
    } catch (error) {
      throw mapPdfError(error);
    }
    if (pageCount > config.maxPdfPages) {
      throw new ProcessingError(
        "PDF_PAGE_LIMIT",
        `This PDF has more than ${config.maxPdfPages} pages.`,
      );
    }
  } else if (detected.kind === "image") {
    let metadata;
    try {
      metadata = await sharp(filePath, { limitInputPixels: config.maxImagePixels }).metadata();
    } catch {
      throw new ProcessingError("INVALID_FILE_SIGNATURE", "An image could not be decoded.");
    }
    const allowed = new Set(["jpeg", "png", "webp", "tiff"]);
    if (!allowed.has(metadata.format) || !metadata.width || !metadata.height) {
      throw new ProcessingError("INVALID_FILE_SIGNATURE", "An image could not be decoded.");
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new ProcessingError("UNSUPPORTED_FILE_TYPE", "Animated and multi-page images are not supported.");
    }
    if (metadata.width * metadata.height > config.maxImagePixels) {
      throw new ProcessingError("IMAGE_PIXEL_LIMIT", "This image is too large to process.");
    }
  } else {
    if (stat.size > config.maxTextBytes) {
      throw new ProcessingError("FILE_TOO_LARGE", "This text file is too large for this tool.");
    }
    let text;
    try {
      text = await fs.readFile(filePath, "utf8");
      new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(filePath));
    } catch {
      throw new ProcessingError("INVALID_FILE_SIGNATURE", "A text file is not valid UTF-8.");
    }
    if (text.includes("\u0000")) {
      throw new ProcessingError("INVALID_FILE_SIGNATURE", "A text file contains binary data.");
    }
  }

  return {
    mimeType: detected.mime,
    kind: detected.kind,
    extension: detected.extension,
    pageCount,
    sizeBytes: stat.size,
  };
}
