import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ProcessingError } from "../../errors.js";

function toHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export async function colorPicker({ inputs, options, workDir }) {
  const input = inputs[0];
  let data;
  let info;

  try {
    const result = await sharp(input.filePath, { limitInputPixels: 40000000 })
      .rotate()
      .resize(64, 64, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = result.data;
    info = result.info;
  } catch (error) {
    throw new ProcessingError("PROCESSING_FAILED", "The image could not be read.", { cause: error });
  }

  const buckets = new Map();
  let counted = 0;

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3] ?? 255;
    if (alpha < 16) continue;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const key = `${r >> 3}:${g >> 3}:${b >> 3}`;
    const current = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    current.count += 1;
    current.r += r;
    current.g += g;
    current.b += b;
    buckets.set(key, current);
    counted += 1;
  }

  if (counted === 0) {
    throw new ProcessingError("PROCESSING_FAILED", "The image has no visible pixels.");
  }

  const colors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, options.paletteSize)
    .map((bucket) => ({
      hex: toHex(
        Math.round(bucket.r / bucket.count),
        Math.round(bucket.g / bucket.count),
        Math.round(bucket.b / bucket.count),
      ),
      share: Math.round((bucket.count / counted) * 10000) / 100,
    }));

  const artifactPath = path.join(workDir, "palette.json");
  await fs.writeFile(
    artifactPath,
    JSON.stringify({ colors, sampledPixels: counted }, null, 2),
    { mode: 0o600 },
  );

  return {
    artifactPath,
    mimeType: "application/json",
    extension: "json",
    fileName: "palette.json",
    pageCount: null,
    summary: { colors, sampledPixels: counted },
  };
}
