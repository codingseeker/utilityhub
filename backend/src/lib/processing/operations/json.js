import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { config } from "../../../config/env.js";
import { ProcessingError } from "../../errors.js";
import { buildBaseName } from "../../util/filenames.js";

function readJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ProcessingError("INVALID_INPUT", "This file is not valid JSON.");
  }
}

export async function jsonToCsv({ inputs, workDir }) {
  const input = inputs[0];
  const text = await fs.readFile(input.filePath, "utf8");
  const parsed = readJson(text);

  const rows = Array.isArray(parsed) ? parsed : null;
  if (!rows || rows.length === 0) {
    throw new ProcessingError("INVALID_INPUT", "JSON must be a non-empty array of objects.");
  }
  if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new ProcessingError("INVALID_INPUT", "JSON must be a non-empty array of objects.");
  }
  if (rows.length > config.maxCsvRows) {
    throw new ProcessingError("FILE_TOO_LARGE", `This JSON has more than ${config.maxCsvRows} rows.`);
  }

  const flattened = rows.map((row) => {
    const output = {};
    for (const [key, value] of Object.entries(row)) {
      output[key] = value !== null && typeof value === "object" ? JSON.stringify(value) : value ?? "";
    }
    return output;
  });

  const csv = Papa.unparse(flattened, { quotes: true, newline: "\n" });
  const artifactPath = path.join(workDir, "data.csv");
  await fs.writeFile(artifactPath, csv, { mode: 0o600 });

  return {
    artifactPath,
    mimeType: "text/csv",
    extension: "csv",
    fileName: `${buildBaseName(input.file.originalName, "data")}.csv`,
    pageCount: null,
    summary: { rows: rows.length, columns: Object.keys(flattened[0]).length },
  };
}

export async function jsonFormat({ inputs, options, workDir }) {
  const input = inputs[0];
  const text = await fs.readFile(input.filePath, "utf8");
  const parsed = readJson(text);
  const output = JSON.stringify(parsed, null, options.mode === "pretty" ? 2 : 0);

  const artifactPath = path.join(workDir, "formatted.json");
  await fs.writeFile(artifactPath, output, { mode: 0o600 });

  return {
    artifactPath,
    mimeType: "application/json",
    extension: "json",
    fileName: `${buildBaseName(input.file.originalName, "data")}-formatted.json`,
    pageCount: null,
    summary: {
      mode: options.mode,
      outputSizeBytes: Buffer.byteLength(output),
    },
  };
}
