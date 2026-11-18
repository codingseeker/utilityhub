import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ProcessingError } from "../../errors.js";
import { buildBaseName } from "../../util/filenames.js";

const FORMAT_INFO = {
  png: { mime: "image/png", extension: "png", sharpFormat: "png" },
  jpeg: { mime: "image/jpeg", extension: "jpg", sharpFormat: "jpeg" },
  webp: { mime: "image/webp", extension: "webp", sharpFormat: "webp" },
};

export async function imageConvert({ inputs, options, workDir }) {
  const input = inputs[0];
  const target = FORMAT_INFO[options.format];
  const artifactPath = path.join(workDir, `converted.${target.extension}`);

  let pipeline = sharp(input.filePath, { limitInputPixels: 40000000 }).rotate();
  if (options.format === "jpeg") {
    pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: options.quality, mozjpeg: true });
  } else if (options.format === "webp") {
    pipeline = pipeline.webp({ quality: options.quality, effort: 4 });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9, quality: options.quality });
  }

  try {
    await pipeline.timeout({ seconds: 45 }).toFile(artifactPath);
    const metadata = await sharp(artifactPath).metadata();
    if (metadata.format !== target.sharpFormat || !metadata.width || !metadata.height) {
      throw new Error("invalid output");
    }
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ProcessingError("PROCESSING_FAILED", "The image could not be converted.", { cause: error });
  }

  const stat = await fs.stat(artifactPath);
  return {
    artifactPath,
    mimeType: target.mime,
    extension: target.extension,
    fileName: `${buildBaseName(input.file.originalName, "image")}.${target.extension}`,
    pageCount: null,
    summary: {
      format: options.format,
      quality: options.quality,
      outputSizeBytes: stat.size,
    },
  };
}
