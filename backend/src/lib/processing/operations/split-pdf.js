import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { config } from "../../../config/env.js";
import { ProcessingError } from "../../errors.js";
import { chunkPages, parseSplitRanges } from "../../util/pages.js";
import { assertPdfPages } from "../../util/pdfinfo.js";
import { createZip } from "../../util/zip.js";
import { loadPdf, savePdf, throwIfAborted } from "../pdf-helpers.js";

function partName(index) {
  return `part-${String(index + 1).padStart(2, "0")}.pdf`;
}

export async function splitPdf({ inputs, options, workDir, signal }) {
  const source = await loadPdf(inputs[0].filePath);
  const pageCount = source.getPageCount();

  const groups =
    options.mode === "every"
      ? chunkPages(pageCount, options.pagesPerFile)
      : parseSplitRanges(options.ranges, pageCount, config.maxSplitParts);

  if (groups.length === 0) {
    throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.");
  }
  if (groups.length > config.maxSplitParts) {
    throw new ProcessingError("PROCESSING_FAILED", `You can create at most ${config.maxSplitParts} parts.`);
  }

  const parts = [];
  for (let index = 0; index < groups.length; index += 1) {
    throwIfAborted(signal);
    const group = groups[index];
    const document = await PDFDocument.create();
    const pages = await document.copyPages(source, group.map((page) => page - 1));
    for (const page of pages) document.addPage(page);
    const name = partName(index);
    const partPath = path.join(workDir, name);
    await savePdf(document, partPath);
    try {
      await assertPdfPages(partPath, group.length);
    } catch {
      throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
    }
    parts.push({ path: partPath, name, pageCount: group.length });
  }

  const totalPages = parts.reduce((sum, part) => sum + part.pageCount, 0);

  if (parts.length === 1) {
    return {
      artifactPath: parts[0].path,
      mimeType: "application/pdf",
      extension: "pdf",
      fileName: parts[0].name,
      pageCount: totalPages,
      summary: { partCount: 1, pageCount: totalPages, artifactName: parts[0].name },
    };
  }

  throwIfAborted(signal);
  const archivePath = path.join(workDir, "split.zip");
  await createZip(parts, archivePath);

  return {
    artifactPath: archivePath,
    mimeType: "application/zip",
    extension: "zip",
    fileName: "split.zip",
    pageCount: totalPages,
    summary: { partCount: parts.length, pageCount: totalPages, artifactName: "split.zip" },
    expectedEntries: parts.length,
  };
}
