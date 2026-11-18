import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "../errors.js";

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("Processing aborted.");
    error.name = "AbortError";
    throw error;
  }
}

export async function loadPdf(filePath) {
  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.");
  }
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.");
  }
}

export async function savePdf(document, filePath) {
  try {
    const bytes = await document.save();
    await fs.writeFile(filePath, bytes, { mode: 0o600 });
  } catch {
    throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.");
  }
}
