import { z } from "zod";
import { config } from "../../config/env.js";
import { AppError } from "../errors.js";

const PDF = "application/pdf";
const IMAGES = ["image/jpeg", "image/png", "image/webp"];
const TEXT = ["text/plain", "text/markdown"];
const CSV = ["text/csv", "text/plain", "application/vnd.ms-excel"];
const JSON_MIME = ["application/json", "text/plain"];

const rangePattern = /^\d+(-\d+)?$/;

function validateRangeSyntax(value, { allowAll = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (allowAll && text.toLowerCase() === "all") return true;
  const parts = text.split(",").map((part) => part.trim());
  return parts.length > 0 && parts.every((part) => rangePattern.test(part));
}

const emptyOptions = z.strictObject({});

const splitOptions = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("ranges"),
    ranges: z.array(z.string().min(1)).min(1).max(config.maxSplitParts),
  }),
  z.strictObject({
    mode: z.literal("every"),
    pagesPerFile: z.coerce.number().int().min(1).max(100),
  }),
]);

const compressOptions = z.strictObject({
  preset: z.enum(["low", "medium", "high"]).default("medium"),
});

const rotateOptions = z.strictObject({
  angle: z.union([z.literal(90), z.literal(180), z.literal(270)]),
  pages: z.string().min(1).default("all"),
});

const imagesOptions = z
  .strictObject({
    pageSize: z.enum(["fit", "a4", "letter"]).default("fit"),
    orientation: z.enum(["auto", "portrait", "landscape"]).default("auto"),
    margin: z.coerce.number().int().min(0).max(50).default(0),
  })
  .refine((value) => value.pageSize !== "fit" || value.margin === 0, {
    message: "Margin must be 0 when page size is fit.",
    path: ["margin"],
  });

const pdfToImagesOptions = z.strictObject({
  format: z.enum(["png", "jpeg"]).default("png"),
  dpi: z.coerce.number().int().min(72).max(200).default(150),
  pages: z.string().min(1).default("all"),
});

const imageConvertOptions = z.strictObject({
  format: z.enum(["png", "jpeg", "webp"]).default("png"),
  quality: z.coerce.number().int().min(40).max(100).default(85),
});

const imageCompressOptions = z.strictObject({
  quality: z.coerce.number().int().min(40).max(95).default(75),
  maxWidth: z.coerce.number().int().min(320).max(4096).default(1920),
});

const paletteOptions = z.strictObject({
  paletteSize: z.coerce.number().int().min(3).max(8).default(6),
});

const delimiterOptions = z.strictObject({
  delimiter: z.enum([",", ";", "\t"]).default(","),
});

const jsonFormatOptions = z.strictObject({
  mode: z.enum(["pretty", "minify"]).default("pretty"),
});

const tableOptions = z.strictObject({
  delimiter: z.enum([",", ";", "\t"]).default(","),
  maxRows: z.coerce.number().int().min(5).max(50).default(20),
});

const textCaseOptions = z.strictObject({
  mode: z.enum(["upper", "lower", "title", "sentence"]).default("upper"),
});

const textCleanerOptions = z.strictObject({
  trimLines: z.coerce.boolean().default(true),
  collapseSpaces: z.coerce.boolean().default(true),
  removeBlankLines: z.coerce.boolean().default(true),
  stripHtml: z.coerce.boolean().default(false),
});

const definitions = {
  "merge-pdf": {
    id: "merge-pdf",
    name: "Merge PDF",
    category: "pdf",
    description: "Combine PDFs in the order you choose.",
    kind: "pdf",
    minFiles: 2,
    maxFiles: Math.min(20, config.maxFilesPerJob),
    accept: [PDF],
    extensions: [".pdf"],
    optionsSchema: emptyOptions,
    options: [],
    limits: { maxOutputPages: config.maxMergedPages },
  },
  "split-pdf": {
    id: "split-pdf",
    name: "Split PDF",
    category: "pdf",
    description: "Extract page ranges or split every N pages.",
    kind: "pdf",
    minFiles: 1,
    maxFiles: 1,
    accept: [PDF],
    extensions: [".pdf"],
    optionsSchema: splitOptions,
    options: [
      {
        name: "mode",
        label: "Split method",
        type: "enum",
        default: "ranges",
        choices: ["ranges", "every"],
      },
      {
        name: "ranges",
        label: "Page ranges",
        type: "pageRangeList",
        requiredWhen: { field: "mode", equals: "ranges" },
        help: "Example: 1-3, 5, 8-10",
      },
      {
        name: "pagesPerFile",
        label: "Pages per file",
        type: "integer",
        requiredWhen: { field: "mode", equals: "every" },
        min: 1,
        max: 100,
        default: 1,
      },
    ],
    limits: { maxParts: config.maxSplitParts },
  },
  "compress-pdf": {
    id: "compress-pdf",
    name: "Compress PDF",
    category: "pdf",
    description: "Reduce PDF size with a quality preset.",
    kind: "pdf",
    minFiles: 1,
    maxFiles: 1,
    accept: [PDF],
    extensions: [".pdf"],
    optionsSchema: compressOptions,
    options: [
      {
        name: "preset",
        label: "Compression",
        type: "enum",
        default: "medium",
        choices: ["low", "medium", "high"],
      },
    ],
    limits: {},
  },
  "rotate-pdf": {
    id: "rotate-pdf",
    name: "Rotate PDF",
    category: "pdf",
    description: "Rotate every page or only the pages you choose.",
    kind: "pdf",
    minFiles: 1,
    maxFiles: 1,
    accept: [PDF],
    extensions: [".pdf"],
    optionsSchema: rotateOptions,
    options: [
      {
        name: "angle",
        label: "Angle",
        type: "enum",
        choices: [90, 180, 270],
        default: 90,
      },
      {
        name: "pages",
        label: "Pages",
        type: "pageRange",
        default: "all",
        help: "Use all or a range such as 1-3,5",
      },
    ],
    limits: {},
  },
  "images-to-pdf": {
    id: "images-to-pdf",
    name: "Images to PDF",
    category: "photo",
    description: "Turn JPG, PNG, WebP, or TIFF images into one PDF.",
    kind: "image",
    minFiles: 1,
    maxFiles: Math.min(20, config.maxFilesPerJob),
    accept: [...IMAGES, "image/tiff"],
    extensions: [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"],
    optionsSchema: imagesOptions,
    options: [
      {
        name: "pageSize",
        label: "Page size",
        type: "enum",
        default: "fit",
        choices: ["fit", "a4", "letter"],
      },
      {
        name: "orientation",
        label: "Orientation",
        type: "enum",
        default: "auto",
        choices: ["auto", "portrait", "landscape"],
      },
      {
        name: "margin",
        label: "Margin (points)",
        type: "integer",
        default: 0,
        min: 0,
        max: 50,
      },
    ],
    limits: { maxPixelsPerImage: config.maxImagePixels },
  },
  "pdf-to-images": {
    id: "pdf-to-images",
    name: "PDF to Images",
    category: "pdf",
    description: "Render PDF pages as PNG or JPEG images.",
    kind: "pdf",
    minFiles: 1,
    maxFiles: 1,
    accept: [PDF],
    extensions: [".pdf"],
    optionsSchema: pdfToImagesOptions,
    options: [
      {
        name: "format",
        label: "Image format",
        type: "enum",
        default: "png",
        choices: ["png", "jpeg"],
      },
      {
        name: "dpi",
        label: "Resolution (DPI)",
        type: "integer",
        default: 150,
        min: 72,
        max: 200,
      },
      {
        name: "pages",
        label: "Pages",
        type: "pageRange",
        default: "all",
        help: "Use all or a range such as 1-3,5",
      },
    ],
    limits: { maxPages: config.pdfToImagesMaxPages },
  },
  "image-convert": {
    id: "image-convert",
    name: "Image Converter",
    category: "photo",
    description: "Convert between PNG, JPEG, and WebP.",
    kind: "image",
    minFiles: 1,
    maxFiles: 1,
    accept: IMAGES,
    extensions: [".jpg", ".jpeg", ".png", ".webp"],
    optionsSchema: imageConvertOptions,
    options: [
      {
        name: "format",
        label: "Output format",
        type: "enum",
        default: "png",
        choices: ["png", "jpeg", "webp"],
      },
      {
        name: "quality",
        label: "Quality",
        type: "integer",
        default: 85,
        min: 40,
        max: 100,
      },
    ],
    limits: {},
  },
  "image-compress": {
    id: "image-compress",
    name: "Image Compressor",
    category: "photo",
    description: "Shrink photos with a quality and width limit.",
    kind: "image",
    minFiles: 1,
    maxFiles: 1,
    accept: IMAGES,
    extensions: [".jpg", ".jpeg", ".png", ".webp"],
    optionsSchema: imageCompressOptions,
    options: [
      {
        name: "quality",
        label: "Quality",
        type: "integer",
        default: 75,
        min: 40,
        max: 95,
      },
      {
        name: "maxWidth",
        label: "Max width (px)",
        type: "integer",
        default: 1920,
        min: 320,
        max: 4096,
      },
    ],
    limits: {},
  },
  "color-picker": {
    id: "color-picker",
    name: "Color Picker",
    category: "photo",
    description: "Extract a dominant colour palette from an image.",
    kind: "image",
    minFiles: 1,
    maxFiles: 1,
    accept: IMAGES,
    extensions: [".jpg", ".jpeg", ".png", ".webp"],
    optionsSchema: paletteOptions,
    options: [
      {
        name: "paletteSize",
        label: "Colours",
        type: "integer",
        default: 6,
        min: 3,
        max: 8,
      },
    ],
    limits: {},
  },
  "csv-to-json": {
    id: "csv-to-json",
    name: "CSV to JSON",
    category: "data",
    description: "Convert a CSV table into a JSON array.",
    kind: "csv",
    minFiles: 1,
    maxFiles: 1,
    accept: CSV,
    extensions: [".csv", ".tsv"],
    optionsSchema: delimiterOptions,
    options: [
      {
        name: "delimiter",
        label: "Delimiter",
        type: "enum",
        default: ",",
        choices: [",", ";", "\t"],
      },
    ],
    limits: { maxRows: config.maxCsvRows },
  },
  "json-to-csv": {
    id: "json-to-csv",
    name: "JSON to CSV",
    category: "data",
    description: "Turn an array of JSON objects into a CSV table.",
    kind: "json",
    minFiles: 1,
    maxFiles: 1,
    accept: JSON_MIME,
    extensions: [".json"],
    optionsSchema: emptyOptions,
    options: [],
    limits: { maxRows: config.maxCsvRows },
  },
  "json-format": {
    id: "json-format",
    name: "JSON Formatter",
    category: "data",
    description: "Pretty-print or minify a JSON document.",
    kind: "json",
    minFiles: 1,
    maxFiles: 1,
    accept: JSON_MIME,
    extensions: [".json"],
    optionsSchema: jsonFormatOptions,
    options: [
      {
        name: "mode",
        label: "Output",
        type: "enum",
        default: "pretty",
        choices: ["pretty", "minify"],
      },
    ],
    limits: {},
  },
  "table-preview": {
    id: "table-preview",
    name: "Table Preview",
    category: "data",
    description: "Inspect CSV headers and rows before converting.",
    kind: "csv",
    minFiles: 1,
    maxFiles: 1,
    accept: CSV,
    extensions: [".csv", ".tsv"],
    optionsSchema: tableOptions,
    options: [
      {
        name: "delimiter",
        label: "Delimiter",
        type: "enum",
        default: ",",
        choices: [",", ";", "\t"],
      },
      {
        name: "maxRows",
        label: "Preview rows",
        type: "integer",
        default: 20,
        min: 5,
        max: 50,
      },
    ],
    limits: { maxRows: config.maxCsvRows },
  },
  "text-case": {
    id: "text-case",
    name: "Case Changer",
    category: "text",
    description: "Convert text to upper, lower, title, or sentence case.",
    kind: "text",
    minFiles: 1,
    maxFiles: 1,
    accept: TEXT,
    extensions: [".txt", ".md"],
    optionsSchema: textCaseOptions,
    options: [
      {
        name: "mode",
        label: "Case",
        type: "enum",
        default: "upper",
        choices: ["upper", "lower", "title", "sentence"],
      },
    ],
    limits: {},
  },
  "text-counter": {
    id: "text-counter",
    name: "Word Counter",
    category: "text",
    description: "Count characters, words, lines, and sentences.",
    kind: "text",
    minFiles: 1,
    maxFiles: 1,
    accept: TEXT,
    extensions: [".txt", ".md"],
    optionsSchema: emptyOptions,
    options: [],
    limits: {},
  },
  "text-cleaner": {
    id: "text-cleaner",
    name: "Text Cleaner",
    category: "text",
    description: "Trim, collapse, and strip messy text.",
    kind: "text",
    minFiles: 1,
    maxFiles: 1,
    accept: TEXT,
    extensions: [".txt", ".md"],
    optionsSchema: textCleanerOptions,
    options: [
      { name: "trimLines", label: "Trim each line", type: "boolean", default: true },
      { name: "collapseSpaces", label: "Collapse spaces", type: "boolean", default: true },
      { name: "removeBlankLines", label: "Remove blank lines", type: "boolean", default: true },
      { name: "stripHtml", label: "Strip HTML tags", type: "boolean", default: false },
    ],
    limits: {},
  },
};

const clientDefinitions = [
  {
    id: "unit-converter",
    name: "Unit Converter",
    category: "utilities",
    description: "Convert length, mass, temperature, and data sizes instantly.",
    runtime: "client",
    input: { kind: "none", minFiles: 0, maxFiles: 0, accept: [], extensions: [] },
    options: [],
    limits: {},
  },
  {
    id: "percentage-calculator",
    name: "Percentage Calculator",
    category: "utilities",
    description: "Percent-of, change, increase, and decrease calculations.",
    runtime: "client",
    input: { kind: "none", minFiles: 0, maxFiles: 0, accept: [], extensions: [] },
    options: [],
    limits: {},
  },
];

const categories = [
  { id: "pdf", name: "PDF" },
  { id: "photo", name: "Photo" },
  { id: "data", name: "Data" },
  { id: "text", name: "Text" },
  { id: "utilities", name: "Utilities" },
];

const extensionInfo = new Map([
  [".pdf", { mime: PDF, kind: "pdf", extension: "pdf" }],
  [".jpg", { mime: "image/jpeg", kind: "image", extension: "jpg" }],
  [".jpeg", { mime: "image/jpeg", kind: "image", extension: "jpg" }],
  [".png", { mime: "image/png", kind: "image", extension: "png" }],
  [".webp", { mime: "image/webp", kind: "image", extension: "webp" }],
  [".tif", { mime: "image/tiff", kind: "image", extension: "tiff" }],
  [".tiff", { mime: "image/tiff", kind: "image", extension: "tiff" }],
  [".txt", { mime: "text/plain", kind: "text", extension: "txt" }],
  [".md", { mime: "text/markdown", kind: "text", extension: "txt" }],
  [".csv", { mime: "text/csv", kind: "csv", extension: "csv" }],
  [".tsv", { mime: "text/csv", kind: "csv", extension: "csv" }],
  [".json", { mime: "application/json", kind: "json", extension: "json" }],
]);

const mimeAliases = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/x-png", "image/png"],
  ["image/x-tiff", "image/tiff"],
  ["text/x-markdown", "text/markdown"],
  ["application/vnd.ms-excel", "text/csv"],
  ["application/csv", "text/csv"],
]);

export function normalizeMime(value) {
  if (!value || typeof value !== "string") return null;
  const lower = value.split(";")[0].trim().toLowerCase();
  if (!lower || lower === "application/octet-stream") return null;
  return mimeAliases.get(lower) || lower;
}

export function extensionInfoFor(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name || ""));
  if (!match) return null;
  return extensionInfo.get(`.${match[1].toLowerCase()}`) || null;
}

export function getOperation(operationId) {
  return definitions[operationId] || null;
}

export function listOperations() {
  const cloud = Object.values(definitions).map((definition) => ({
    id: definition.id,
    name: definition.name,
    category: definition.category,
    description: definition.description,
    runtime: "cloud",
    input: {
      kind: definition.kind,
      minFiles: definition.minFiles,
      maxFiles: definition.maxFiles,
      maxFileSizeBytes: config.maxFileSizeBytes,
      maxTotalBytes: Math.min(config.maxJobInputBytes, config.maxFileSizeBytes * definition.maxFiles),
      accept: [...definition.accept],
      extensions: [...definition.extensions],
    },
    options: definition.options,
    limits: definition.limits,
  }));
  return { operations: [...cloud, ...clientDefinitions], categories };
}

export function validateUploadDescriptor({ name, sizeBytes, mimeType }) {
  const info = extensionInfoFor(name);
  if (!info) {
    throw new AppError(
      "UNSUPPORTED_FILE_TYPE",
      415,
      "This file type is not supported. Use PDF, image, CSV, JSON, or text.",
    );
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new AppError("INVALID_UPLOAD", 422, "A file size is missing or invalid.");
  }
  if (sizeBytes > config.maxFileSizeBytes) {
    throw new AppError(
      "FILE_TOO_LARGE",
      413,
      `Each file must be ${Math.round(config.maxFileSizeBytes / 1024 / 1024)} MB or smaller.`,
    );
  }
  const declared = normalizeMime(mimeType);
  if (declared && declared !== info.mime) {
    throw new AppError("MIME_MISMATCH", 422, "The file type does not match its extension.");
  }
  return info;
}

export function detectSignature(head, name) {
  const info = extensionInfoFor(name);
  if (!info) return null;

  const ascii = (start, end) => head.subarray(start, end).toString("ascii");

  if (head.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    return { mime: PDF, kind: "pdf", extension: "pdf" };
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: "image/jpeg", kind: "image", extension: "jpg" };
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    ascii(1, 4) === "PNG" &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return { mime: "image/png", kind: "image", extension: "png" };
  }
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { mime: "image/webp", kind: "image", extension: "webp" };
  }
  if (
    head.length >= 4 &&
    ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00) ||
      (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a))
  ) {
    return { mime: "image/tiff", kind: "image", extension: "tiff" };
  }

  if (["text", "csv", "json"].includes(info.kind)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(head);
    } catch {
      return null;
    }
    if (head.includes(0x00)) return null;
    const mime = info.kind === "json" ? "application/json" : info.kind === "csv" ? "text/csv" : info.mime;
    return { mime, kind: info.kind, extension: info.extension };
  }

  return null;
}

export function validateUploadedBytes({ head, name, declaredMime, actualSize, operationId }) {
  const definition = operationId ? getOperation(operationId) : null;
  if (operationId && !definition) {
    throw new AppError("INVALID_OPERATION", 422, "This operation is not available.");
  }

  const byExtension = extensionInfoFor(name);
  if (!byExtension) {
    throw new AppError("UNSUPPORTED_FILE_TYPE", 415, "This file type is not supported.");
  }

  const detected = detectSignature(head, name);
  if (!detected) {
    throw new AppError("INVALID_FILE_SIGNATURE", 422, "The file content does not match its type.");
  }

  if (detected.mime !== byExtension.mime) {
    throw new AppError("MIME_MISMATCH", 422, "The file content does not match its extension.");
  }

  const declared = normalizeMime(declaredMime);
  if (declared && declared !== detected.mime) {
    throw new AppError("MIME_MISMATCH", 422, "The file content does not match its declared type.");
  }

  if (!Number.isSafeInteger(actualSize) || actualSize <= 0) {
    throw new AppError("EMPTY_FILE", 422, "One of the files is empty.");
  }
  if (actualSize > config.maxFileSizeBytes) {
    throw new AppError("FILE_TOO_LARGE", 413, "This file is too large.");
  }

  if (detected.kind === "text" || detected.kind === "csv" || detected.kind === "json") {
    if (actualSize > config.maxTextBytes) {
      throw new AppError("FILE_TOO_LARGE", 413, "This text file is too large for this tool.");
    }
  }

  if (definition) {
    if (detected.mime === "image/tiff" && !definition.accept.includes("image/tiff")) {
      throw new AppError("UNSUPPORTED_FILE_TYPE", 415, "TIFF is not supported for this tool.");
    }
    if (!definition.accept.includes(detected.mime)) {
      throw new AppError("INVALID_INPUT", 422, "One or more files are not valid for this tool.");
    }
  }

  return detected;
}

function zodDetails(error) {
  return error.issues.map((issue) => ({
    field: `options.${issue.path.join(".") || "options"}`,
    message: issue.message,
  }));
}

export function prepareOptions(operationId, rawOptions) {
  const definition = getOperation(operationId);
  if (!definition) {
    throw new AppError("INVALID_OPERATION", 422, "This operation is not available.");
  }
  const parsed = definition.optionsSchema.safeParse(rawOptions ?? {});
  if (!parsed.success) {
    throw new AppError(
      "INVALID_OPTIONS",
      422,
      "Check the selected options and try again.",
      zodDetails(parsed.error),
    );
  }

  const options = parsed.data;

  if (operationId === "split-pdf" && options.mode === "ranges") {
    if (!options.ranges.every((range) => validateRangeSyntax(range))) {
      throw new AppError("INVALID_OPTIONS", 422, "Use page ranges such as 1-3, 5, 8-10.");
    }
    if (options.ranges.length > config.maxSplitParts) {
      throw new AppError("INVALID_OPTIONS", 422, `You can create at most ${config.maxSplitParts} parts.`);
    }
  }

  if (
    (operationId === "rotate-pdf" || operationId === "pdf-to-images") &&
    !validateRangeSyntax(options.pages, { allowAll: true })
  ) {
    throw new AppError("INVALID_OPTIONS", 422, "Use all or a page range such as 1-3,5.");
  }

  return options;
}

export function validateJobFiles(operationId, files) {
  const definition = getOperation(operationId);
  if (!definition) {
    throw new AppError("INVALID_OPERATION", 422, "This operation is not available.");
  }
  if (files.length < definition.minFiles || files.length > definition.maxFiles) {
    throw new AppError(
      "INVALID_INPUT",
      422,
      `This tool needs ${definition.minFiles === definition.maxFiles ? definition.minFiles : `${definition.minFiles}-${definition.maxFiles}`} file(s).`,
    );
  }

  let totalBytes = 0;
  for (const file of files) {
    const detected = extensionInfoFor(file.name);
    if (!detected || !definition.accept.includes(detected.mime)) {
      throw new AppError("INVALID_INPUT", 422, "One or more files are not valid for this tool.");
    }
    if (
      detected.mime === "image/tiff" &&
      !definition.accept.includes("image/tiff")
    ) {
      throw new AppError("UNSUPPORTED_FILE_TYPE", 415, "TIFF is not supported for this tool.");
    }
    totalBytes += file.sizeBytes;
  }

  if (totalBytes > config.maxJobInputBytes) {
    throw new AppError(
      "REQUEST_TOO_LARGE",
      413,
      `The combined files must be ${Math.round(config.maxJobInputBytes / 1024 / 1024)} MB or smaller.`,
    );
  }

  return { totalBytes, definition };
}
