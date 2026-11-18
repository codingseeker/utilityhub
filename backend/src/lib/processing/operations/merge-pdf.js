import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "../../errors.js";
import { assertPdfPages } from "../../util/pdfinfo.js";
import { loadPdf, savePdf, throwIfAborted } from "../pdf-helpers.js";

export async function mergePdf({ inputs, workDir, signal }) {
  const expectedPages = inputs.reduce((sum, input) => sum + (input.file.pageCount ?? 0), 0);
  const target = await PDFDocument.create();

  for (const input of inputs) {
    throwIfAborted(signal);
    const source = await loadPdf(input.filePath);
    const pages = await target.copyPages(source, source.getPageIndices());
    for (const page of pages) target.addPage(page);
  }

  throwIfAborted(signal);
  const artifactPath = path.join(workDir, "merged.pdf");
  await savePdf(target, artifactPath);

  try {
    await assertPdfPages(artifactPath, expectedPages);
  } catch {
    throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
  }

  return {
    artifactPath,
    mimeType: "application/pdf",
    extension: "pdf",
    fileName: "merged.pdf",
    pageCount: expectedPages,
    summary: { inputCount: inputs.length, pageCount: expectedPages },
  };
}
