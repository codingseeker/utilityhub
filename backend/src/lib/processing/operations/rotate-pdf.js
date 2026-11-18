import path from "node:path";
import { degrees } from "pdf-lib";
import { buildBaseName } from "../../util/filenames.js";
import { ProcessingError } from "../../errors.js";
import { parsePageRange } from "../../util/pages.js";
import { assertPdfPages } from "../../util/pdfinfo.js";
import { loadPdf, savePdf, throwIfAborted } from "../pdf-helpers.js";

function normalizeAngle(value) {
  return ((value % 360) + 360) % 360;
}

export async function rotatePdf({ inputs, options, workDir, signal }) {
  const input = inputs[0];
  const document = await loadPdf(input.filePath);
  const pageCount = document.getPageCount();
  const selected = parsePageRange(options.pages, pageCount);
  const expected = new Map();

  for (const pageNumber of selected) {
    throwIfAborted(signal);
    const page = document.getPage(pageNumber - 1);
    const next = normalizeAngle(page.getRotation().angle + options.angle);
    page.setRotation(degrees(next));
    expected.set(pageNumber, next);
  }

  throwIfAborted(signal);
  const artifactPath = path.join(workDir, "rotated.pdf");
  await savePdf(document, artifactPath);

  try {
    await assertPdfPages(artifactPath, pageCount);
    const output = await loadPdf(artifactPath);
    for (const [pageNumber, angle] of expected) {
      if (output.getPage(pageNumber - 1).getRotation().angle !== angle) {
        throw new Error("rotation mismatch");
      }
    }
  } catch {
    throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
  }

  return {
    artifactPath,
    mimeType: "application/pdf",
    extension: "pdf",
    fileName: `${buildBaseName(input.file.originalName, "document")}-rotated.pdf`,
    pageCount,
    summary: { angle: options.angle, pagesRotated: selected.length, pageCount },
  };
}
