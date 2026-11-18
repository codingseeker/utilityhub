import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { config } from "../../../config/env.js";
import { ProcessingError } from "../../errors.js";
import { assertPdfPages } from "../../util/pdfinfo.js";
import { savePdf, throwIfAborted } from "../pdf-helpers.js";

const FIXED_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

function pageDimensions({ pageSize, orientation, imageWidth, imageHeight }) {
  if (pageSize === "fit") {
    return { width: (imageWidth * 72) / 96, height: (imageHeight * 72) / 96 };
  }
  const base = FIXED_SIZES[pageSize];
  const landscape = orientation === "landscape" || (orientation === "auto" && imageWidth > imageHeight);
  return landscape
    ? { width: Math.max(base.width, base.height), height: Math.min(base.width, base.height) }
    : { width: Math.min(base.width, base.height), height: Math.max(base.width, base.height) };
}

export async function imagesToPdf({ inputs, options, workDir, signal }) {
  const document = await PDFDocument.create();

  for (let index = 0; index < inputs.length; index += 1) {
    throwIfAborted(signal);
    const normalizedPath = path.join(workDir, `image-${index + 1}.jpg`);

    try {
      await sharp(inputs[index].filePath, { limitInputPixels: config.maxImagePixels })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .timeout({ seconds: 30 })
        .toFile(normalizedPath);
    } catch (error) {
      throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.", {
        cause: error,
      });
    }

    const metadata = await sharp(normalizedPath).metadata();
    if (!metadata.width || !metadata.height) {
      throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.");
    }

    const dimensions = pageDimensions({
      pageSize: options.pageSize,
      orientation: options.orientation,
      imageWidth: metadata.width,
      imageHeight: metadata.height,
    });

    const bytes = await fs.readFile(normalizedPath);
    const image = await document.embedJpg(bytes);
    const page = document.addPage([dimensions.width, dimensions.height]);

    const availableWidth = dimensions.width - options.margin * 2;
    const availableHeight = dimensions.height - options.margin * 2;
    const scale = Math.min(availableWidth / metadata.width, availableHeight / metadata.height);
    const drawWidth = metadata.width * scale;
    const drawHeight = metadata.height * scale;

    page.drawImage(image, {
      x: (dimensions.width - drawWidth) / 2,
      y: (dimensions.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }

  throwIfAborted(signal);
  const artifactPath = path.join(workDir, "images.pdf");
  await savePdf(document, artifactPath);

  try {
    await assertPdfPages(artifactPath, inputs.length);
  } catch {
    throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
  }

  return {
    artifactPath,
    mimeType: "application/pdf",
    extension: "pdf",
    fileName: "images.pdf",
    pageCount: inputs.length,
    summary: { imageCount: inputs.length, pageCount: inputs.length },
  };
}
