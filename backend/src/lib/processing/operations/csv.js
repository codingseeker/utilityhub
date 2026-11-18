import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { config } from "../../../config/env.js";
import { ProcessingError } from "../../errors.js";
import { buildBaseName } from "../../util/filenames.js";

function parseCsv(text, delimiter) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    dynamicTyping: false,
    transformHeader: (header) => header.trim(),
  });
  if (result.errors.length > 0) {
    const fatal = result.errors.find((error) => error.type === "Quotes" || error.type === "Delimiter");
    if (fatal) {
      throw new ProcessingError("INVALID_INPUT", "This CSV could not be parsed.");
    }
  }
  const rows = result.data.filter((row) => row && Object.keys(row).length > 0);
  if (rows.length > config.maxCsvRows) {
    throw new ProcessingError("FILE_TOO_LARGE", `This CSV has more than ${config.maxCsvRows} rows.`);
  }
  const headers = result.meta.fields || [];
  if (headers.length === 0) {
    throw new ProcessingError("INVALID_INPUT", "This CSV has no header row.");
  }
  return { rows, headers };
}

export async function csvToJson({ inputs, options, workDir }) {
  const input = inputs[0];
  const text = await fs.readFile(input.filePath, "utf8");
  const { rows } = parseCsv(text, options.delimiter);

  const artifactPath = path.join(workDir, "data.json");
  await fs.writeFile(artifactPath, JSON.stringify(rows, null, 2), { mode: 0o600 });

  return {
    artifactPath,
    mimeType: "application/json",
    extension: "json",
    fileName: `${buildBaseName(input.file.originalName, "data")}.json`,
    pageCount: null,
    summary: { rows: rows.length, columns: Object.keys(rows[0] || {}).length },
  };
}

export async function tablePreview({ inputs, options, workDir }) {
  const input = inputs[0];
  const text = await fs.readFile(input.filePath, "utf8");
  const { rows, headers } = parseCsv(text, options.delimiter);
  const preview = {
    headers,
    rows: rows.slice(0, options.maxRows),
    totalRows: rows.length,
    columns: headers.length,
  };

  const artifactPath = path.join(workDir, "preview.json");
  await fs.writeFile(artifactPath, JSON.stringify(preview, null, 2), { mode: 0o600 });

  return {
    artifactPath,
    mimeType: "application/json",
    extension: "json",
    fileName: `${buildBaseName(input.file.originalName, "table")}-preview.json`,
    pageCount: null,
    summary: {
      totalRows: rows.length,
      columns: headers.length,
      previewRows: preview.rows.length,
      headers: headers.slice(0, 12),
    },
  };
}
