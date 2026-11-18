import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ProcessingError } from "../../errors.js";
import { buildBaseName } from "../../util/filenames.js";

const FORMAT_INFO = {
  jpeg: { mime: "image/jpeg", extension: "jpg", sharpFormat: "jpeg" },
  png: { mime: "image/png", extension: "png", sharpFormat: "png" },
  webp: { mime: "image/webp", extension: "webp", sharpFormat: "webp" },
};

export async function imageCompress({ inputs, options, workDir }) {
  const input = inputs[0];
  const originalSize = input.file.sizeBytes;

  let metadata;
  try {
    metadata = await sharp(input.filePath, { limitInputPixels: 40000000 }).metadata();
  } catch (error) {
    throw new ProcessingError("PROCESSING_FAILED", "The image could not be read.", { cause: error });
  }
  if (!metadata.width || !metadata.height) {
    throw new ProcessingError("PROCESSING_FAILED", "The image could not be read.");
  }

  const sourceFormat = FORMAT_INFO[metadata.format] || FORMAT_INFO.jpeg;
  const candidatePath = path.join(workDir, `candidate.${sourceFormat.extension}`);

  let pipeline = sharp(input.filePath, { limitInputPixels: 40000000 })
    .rotate()
    .resize({ width: options.maxWidth, withoutEnlargement: true, fit: "inside" });

  if (sourceFormat.sharpFormat === "jpeg") {
    pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: options.quality, mozjpeg: true });
  } else if (sourceFormat.sharpFormat === "webp") {
    pipeline = pipeline.webp({ quality: options.quality, effort: 4 });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9, quality: options.quality, palette: true });
  }

  try {
    await pipeline.timeout({ seconds: 45 }).toFile(candidatePath);
  } catch (error) {
    throw new ProcessingError("PROCESSING_FAILED", "The image could not be compressed.", { cause: error });
  }

  const candidateStat = await fs.stat(candidatePath);
  const applied = candidateStat.size < originalSize;
  const artifactPath = path.join(workDir, `compressed.${sourceFormat.extension}`);

  if (applied) {
    await fs.rename(candidatePath, artifactPath);
  } else {
    await fs.rm(candidatePath, { force: true });
    await fs.copyFile(input.filePath, artifactPath);
    await fs.chmod(artifactPath, 0o600);
  }

  const outputStat = await fs.stat(artifactPath);
  const reductionPercent =
    originalSize > 0 ? Math.round(((originalSize - outputStat.size) / originalSize) * 10000) / 100 : 0;

  return {
    artifactPath,
    mimeType: sourceFormat.mime,
    extension: sourceFormat.extension,
    fileName: `${buildBaseName(input.file.originalName, "image")}-compressed.${sourceFormat.extension}`,
    pageCount: null,
    summary: {
      originalSizeBytes: originalSize,
      outputSizeBytes: outputStat.size,
      reductionPercent: Math.max(0, reductionPercent),
      quality: options.quality,
      maxWidth: options.maxWidth,
      applied,
      ...(applied ? {} : { message: "No size reduction was achieved" }),
    },
  };
}
