import { runCommand } from "./process.js";

export class PdfInspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PdfInspectionError";
    this.code = code;
  }
}

export async function inspectPdf(filePath, { timeoutMs = 10000 } = {}) {
  let result;
  try {
    result = await runCommand("pdfinfo", [filePath], {
      cwd: process.cwd(),
      timeoutMs,
      maxOutputBytes: 1024 * 1024,
    });
  } catch {
    throw new PdfInspectionError("ENGINE_UNAVAILABLE", "The PDF inspection engine is unavailable.");
  }

  if (result.timedOut || result.aborted) {
    throw new PdfInspectionError("PDF_INSPECTION_TIMEOUT", "PDF inspection took too long.");
  }

  if (/^Encrypted:\s*yes/im.test(result.stdout)) {
    throw new PdfInspectionError("ENCRYPTED_PDF", "Password-protected PDFs are not supported.");
  }

  if (result.code !== 0) {
    throw new PdfInspectionError("PDF_CORRUPTED", "This PDF cannot be read.");
  }

  const pagesMatch = /^Pages:\s+(\d+)/im.exec(result.stdout);
  if (!pagesMatch) {
    throw new PdfInspectionError("PDF_CORRUPTED", "This PDF cannot be read.");
  }

  const pages = Number(pagesMatch[1]);
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new PdfInspectionError("PDF_CORRUPTED", "This PDF cannot be read.");
  }

  return { pages, encrypted: false };
}

export async function assertPdfPages(filePath, expectedPages, timeoutMs = 10000) {
  const info = await inspectPdf(filePath, { timeoutMs });
  if (info.pages !== expectedPages) {
    throw new PdfInspectionError(
      "OUTPUT_INVALID",
      "The generated PDF has an unexpected page count.",
    );
  }
  return info;
}
