import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../../config/env.js";
import { buildBaseName } from "../../util/filenames.js";
import { ProcessingError } from "../../errors.js";
import { assertPdfPages } from "../../util/pdfinfo.js";
import { runEngine } from "../engine.js";
import { throwIfAborted } from "../pdf-helpers.js";

const PRESET_SETTINGS = { low: "/screen", medium: "/ebook", high: "/printer" };

export async function compressPdf({ inputs, options, workDir, timeoutMs, signal }) {
  throwIfAborted(signal);
  const input = inputs[0];
  const originalSize = input.file.sizeBytes;
  const pageCount = input.file.pageCount;
  const candidatePath = path.join(workDir, "candidate.pdf");

  await runEngine(
    "gs",
    [
      "-q",
      "-dNOPAUSE",
      "-dBATCH",
      "-dSAFER",
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.7",
      `-dPDFSETTINGS=${PRESET_SETTINGS[options.preset]}`,
      "-dAutoRotatePages=/None",
      `-sOutputFile=${candidatePath}`,
      input.filePath,
    ],
    { cwd: workDir, timeoutMs: timeoutMs ?? config.operationTimeouts["compress-pdf"], signal },
  );

  throwIfAborted(signal);

  try {
    await assertPdfPages(candidatePath, pageCount);
  } catch {
    throw new ProcessingError("OUTPUT_INVALID", "The generated file could not be verified.");
  }

  const candidateStat = await fs.stat(candidatePath);
  const applied = candidateStat.size < originalSize;
  const artifactPath = path.join(workDir, "compressed.pdf");

  if (applied) {
    await fs.rename(candidatePath, artifactPath);
  } else {
    await fs.rm(candidatePath, { force: true });
    await fs.copyFile(input.filePath, artifactPath);
    await fs.chmod(artifactPath, 0o600);
  }

  const outputStat = await fs.stat(artifactPath);
  const reductionBytes = Math.max(0, originalSize - outputStat.size);
  const reductionPercent =
    originalSize > 0 ? Math.round((reductionBytes / originalSize) * 10000) / 100 : 0;

  return {
    artifactPath,
    mimeType: "application/pdf",
    extension: "pdf",
    fileName: `${buildBaseName(input.file.originalName, "document")}-compressed.pdf`,
    pageCount,
    summary: {
      preset: options.preset,
      originalSizeBytes: originalSize,
      outputSizeBytes: outputStat.size,
      reductionBytes,
      reductionPercent,
      applied,
      ...(applied ? {} : { message: "No size reduction was achieved" }),
    },
  };
}
