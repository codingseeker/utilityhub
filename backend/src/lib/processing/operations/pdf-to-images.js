import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../../../config/env.js";
import { ProcessingError } from "../../errors.js";
import { parsePageRange } from "../../util/pages.js";
import { createZip } from "../../util/zip.js";
import { runEngine } from "../engine.js";
import { loadPdf, throwIfAborted } from "../pdf-helpers.js";

function pageName(index, extension) {
  return `page-${String(index + 1).padStart(2, "0")}.${extension}`;
}

export async function pdfToImages({ inputs, options, workDir, signal }) {
  const input = inputs[0];
  const document = await loadPdf(input.filePath);
  const pageCount = document.getPageCount();

  if (pageCount > config.pdfToImagesMaxPages) {
    throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.");
  }

  const selected = parsePageRange(options.pages, pageCount, config.pdfToImagesMaxPages);
  const extension = options.format === "jpeg" ? "jpg" : "png";
  const rendered = [];

  for (let index = 0; index < selected.length; index += 1) {
    throwIfAborted(signal);
    const pageNumber = selected[index];
    const size = document.getPage(pageNumber - 1).getSize();
    const pixels =
      Math.ceil((size.width * options.dpi) / 72) * Math.ceil((size.height * options.dpi) / 72);
    if (pixels > config.pdfToImagesMaxPixels) {
      throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.");
    }

    const basePath = path.join(workDir, `render-${index + 1}`);
    const args = [
      "-q",
      "-r",
      String(options.dpi),
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-singlefile",
    ];
    if (options.format === "jpeg") {
      args.push("-jpeg", "-jpegopt", "quality=85");
    } else {
      args.push("-png");
    }
    args.push(input.filePath, basePath);

    await runEngine("pdftoppm", args, { cwd: workDir, timeoutMs: 60000, signal });

    const renderedPath = `${basePath}.${extension}`;
    const name = pageName(index, extension);
    const finalPath = path.join(workDir, name);

    let stat;
    try {
      stat = await fs.stat(renderedPath);
    } catch {
      throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
    }
    if (!stat.isFile() || stat.size === 0) {
      throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
    }

    try {
      const metadata = await sharp(renderedPath).metadata();
      const expectedFormat = options.format === "jpeg" ? "jpeg" : "png";
      if (
        metadata.format !== expectedFormat ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > config.pdfToImagesMaxPixels
      ) {
        throw new Error("invalid render");
      }
    } catch {
      throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
    }

    await fs.rename(renderedPath, finalPath);
    rendered.push({ path: finalPath, name });
  }

  if (rendered.length === 0) {
    throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
  }

  if (rendered.length === 1) {
    return {
      artifactPath: rendered[0].path,
      mimeType: options.format === "jpeg" ? "image/jpeg" : "image/png",
      extension,
      fileName: rendered[0].name,
      pageCount: null,
      summary: {
        format: options.format,
        dpi: options.dpi,
        pageCount: 1,
        artifactName: rendered[0].name,
      },
    };
  }

  throwIfAborted(signal);
  const archivePath = path.join(workDir, "pages.zip");
  await createZip(rendered, archivePath);

  return {
    artifactPath: archivePath,
    mimeType: "application/zip",
    extension: "zip",
    fileName: "pages.zip",
    pageCount: null,
    summary: { format: options.format, dpi: options.dpi, pageCount: rendered.length, artifactName: "pages.zip" },
    expectedEntries: rendered.length,
  };
}
