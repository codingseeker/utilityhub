const PDF = ["application/pdf"];
const IMAGES = ["image/jpeg", "image/png", "image/webp"];
const TEXT = ["text/plain", "text/markdown"];
const CSV = ["text/csv", "text/plain", "application/vnd.ms-excel"];
const JSON_MIME = ["application/json", "text/plain"];
const DOCX = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const PPTX = ["application/vnd.openxmlformats-officedocument.presentationml.presentation"];

export const CATEGORY_META = {
  pdf: { id: "pdf", name: "PDF", tagline: "Assemble, split, compress, rotate." },
  photo: { id: "photo", name: "Photo", tagline: "Convert, shrink, sample colour." },
  data: { id: "data", name: "Data", tagline: "CSV, JSON, and table inspection." },
  text: { id: "text", name: "Text", tagline: "Case, counts, and cleanup." },
  office: { id: "office", name: "Office", tagline: "Word and slides, entirely local." },
  utilities: { id: "utilities", name: "Utilities", tagline: "Instant client-side maths." },
};

/**
 * Office tools are defined in the frontend on purpose. The backend catalog
 * cannot advertise them, and no Office byte should ever reach it.
 */
export const LOCAL_TOOLS = [
  {
    id: "docx-to-txt",
    name: "DOCX to TXT",
    category: "office",
    description: "Extract raw text from a Word document without uploading it.",
    runtime: "local",
    local: true,
    input: {
      kind: "office",
      minFiles: 1,
      maxFiles: 1,
      maxFileSizeBytes: 25 * 1024 * 1024,
      accept: DOCX,
      extensions: [".docx"],
    },
    options: [],
  },
  {
    id: "txt-to-docx",
    name: "TXT to DOCX",
    category: "office",
    description: "Build a Word document from plain text, in this tab.",
    runtime: "local",
    local: true,
    input: {
      kind: "text",
      minFiles: 1,
      maxFiles: 1,
      maxFileSizeBytes: 25 * 1024 * 1024,
      accept: TEXT,
      extensions: [".txt", ".md"],
    },
    options: [],
  },
  {
    id: "pptx-to-txt",
    name: "PPTX to TXT",
    category: "office",
    description: "Pull the text out of PowerPoint slides without a worker.",
    runtime: "local",
    local: true,
    input: {
      kind: "office",
      minFiles: 1,
      maxFiles: 1,
      maxFileSizeBytes: 25 * 1024 * 1024,
      accept: PPTX,
      extensions: [".pptx"],
    },
    options: [],
  },
  {
    id: "txt-to-pptx",
    name: "TXT to PPTX",
    category: "office",
    description: "Turn every non-empty line into a slide, locally.",
    runtime: "local",
    local: true,
    input: {
      kind: "text",
      minFiles: 1,
      maxFiles: 1,
      maxFileSizeBytes: 25 * 1024 * 1024,
      accept: TEXT,
      extensions: [".txt", ".md"],
    },
    options: [],
  },
];

export const FALLBACK_TOOLS = [
  {
    id: "merge-pdf",
    name: "Merge PDF",
    category: "pdf",
    description: "Combine PDFs in the order you choose.",
    runtime: "cloud",
    input: { kind: "pdf", minFiles: 2, maxFiles: 20, accept: PDF, extensions: [".pdf"] },
    options: [],
  },
  {
    id: "split-pdf",
    name: "Split PDF",
    category: "pdf",
    description: "Extract page ranges or split every N pages.",
    runtime: "cloud",
    input: { kind: "pdf", minFiles: 1, maxFiles: 1, accept: PDF, extensions: [".pdf"] },
    options: [
      { name: "mode", label: "Split method", type: "enum", default: "ranges", choices: ["ranges", "every"] },
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
  },
  {
    id: "compress-pdf",
    name: "Compress PDF",
    category: "pdf",
    description: "Reduce PDF size with a quality preset.",
    runtime: "cloud",
    input: { kind: "pdf", minFiles: 1, maxFiles: 1, accept: PDF, extensions: [".pdf"] },
    options: [
      { name: "preset", label: "Compression", type: "enum", default: "medium", choices: ["low", "medium", "high"] },
    ],
  },
  {
    id: "rotate-pdf",
    name: "Rotate PDF",
    category: "pdf",
    description: "Rotate every page or only the pages you choose.",
    runtime: "cloud",
    input: { kind: "pdf", minFiles: 1, maxFiles: 1, accept: PDF, extensions: [".pdf"] },
    options: [
      { name: "angle", label: "Angle", type: "enum", choices: [90, 180, 270], default: 90 },
      { name: "pages", label: "Pages", type: "pageRange", default: "all", help: "Use all or a range such as 1-3,5" },
    ],
  },
  {
    id: "images-to-pdf",
    name: "Images to PDF",
    category: "photo",
    description: "Turn JPG, PNG, WebP, or TIFF images into one PDF.",
    runtime: "cloud",
    input: { kind: "image", minFiles: 1, maxFiles: 20, accept: [...IMAGES, "image/tiff"], extensions: [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"] },
    options: [
      { name: "pageSize", label: "Page size", type: "enum", default: "fit", choices: ["fit", "a4", "letter"] },
      { name: "orientation", label: "Orientation", type: "enum", default: "auto", choices: ["auto", "portrait", "landscape"] },
      { name: "margin", label: "Margin (points)", type: "integer", default: 0, min: 0, max: 50 },
    ],
  },
  {
    id: "pdf-to-images",
    name: "PDF to Images",
    category: "pdf",
    description: "Render PDF pages as PNG or JPEG images.",
    runtime: "cloud",
    input: { kind: "pdf", minFiles: 1, maxFiles: 1, accept: PDF, extensions: [".pdf"] },
    options: [
      { name: "format", label: "Image format", type: "enum", default: "png", choices: ["png", "jpeg"] },
      { name: "dpi", label: "Resolution (DPI)", type: "integer", default: 150, min: 72, max: 200 },
      { name: "pages", label: "Pages", type: "pageRange", default: "all", help: "Use all or a range such as 1-3,5" },
    ],
  },
  {
    id: "image-convert",
    name: "Image Converter",
    category: "photo",
    description: "Convert between PNG, JPEG, and WebP.",
    runtime: "cloud",
    input: { kind: "image", minFiles: 1, maxFiles: 1, accept: IMAGES, extensions: [".jpg", ".jpeg", ".png", ".webp"] },
    options: [
      { name: "format", label: "Output format", type: "enum", default: "png", choices: ["png", "jpeg", "webp"] },
      { name: "quality", label: "Quality", type: "integer", default: 85, min: 40, max: 100 },
    ],
  },
  {
    id: "image-compress",
    name: "Image Compressor",
    category: "photo",
    description: "Shrink photos with a quality and width limit.",
    runtime: "cloud",
    input: { kind: "image", minFiles: 1, maxFiles: 1, accept: IMAGES, extensions: [".jpg", ".jpeg", ".png", ".webp"] },
    options: [
      { name: "quality", label: "Quality", type: "integer", default: 75, min: 40, max: 95 },
      { name: "maxWidth", label: "Max width (px)", type: "integer", default: 1920, min: 320, max: 4096 },
    ],
  },
  {
    id: "color-picker",
    name: "Color Picker",
    category: "photo",
    description: "Extract a dominant colour palette from an image.",
    runtime: "cloud",
    input: { kind: "image", minFiles: 1, maxFiles: 1, accept: IMAGES, extensions: [".jpg", ".jpeg", ".png", ".webp"] },
    options: [
      { name: "paletteSize", label: "Colours", type: "integer", default: 6, min: 3, max: 8 },
    ],
  },
  {
    id: "csv-to-json",
    name: "CSV to JSON",
    category: "data",
    description: "Convert a CSV table into a JSON array.",
    runtime: "cloud",
    input: { kind: "csv", minFiles: 1, maxFiles: 1, accept: CSV, extensions: [".csv", ".tsv"] },
    options: [
      { name: "delimiter", label: "Delimiter", type: "enum", default: ",", choices: [",", ";", "\t"] },
    ],
  },
  {
    id: "json-to-csv",
    name: "JSON to CSV",
    category: "data",
    description: "Turn an array of JSON objects into a CSV table.",
    runtime: "cloud",
    input: { kind: "json", minFiles: 1, maxFiles: 1, accept: JSON_MIME, extensions: [".json"] },
    options: [],
  },
  {
    id: "json-format",
    name: "JSON Formatter",
    category: "data",
    description: "Pretty-print or minify a JSON document.",
    runtime: "cloud",
    input: { kind: "json", minFiles: 1, maxFiles: 1, accept: JSON_MIME, extensions: [".json"] },
    options: [
      { name: "mode", label: "Output", type: "enum", default: "pretty", choices: ["pretty", "minify"] },
    ],
  },
  {
    id: "table-preview",
    name: "Table Preview",
    category: "data",
    description: "Inspect CSV headers and rows before converting.",
    runtime: "cloud",
    input: { kind: "csv", minFiles: 1, maxFiles: 1, accept: CSV, extensions: [".csv", ".tsv"] },
    options: [
      { name: "delimiter", label: "Delimiter", type: "enum", default: ",", choices: [",", ";", "\t"] },
      { name: "maxRows", label: "Preview rows", type: "integer", default: 20, min: 5, max: 50 },
    ],
  },
  {
    id: "text-case",
    name: "Case Changer",
    category: "text",
    description: "Convert text to upper, lower, title, or sentence case.",
    runtime: "cloud",
    input: { kind: "text", minFiles: 1, maxFiles: 1, accept: TEXT, extensions: [".txt", ".md"] },
    options: [
      { name: "mode", label: "Case", type: "enum", default: "upper", choices: ["upper", "lower", "title", "sentence"] },
    ],
  },
  {
    id: "text-counter",
    name: "Word Counter",
    category: "text",
    description: "Count characters, words, lines, and sentences.",
    runtime: "cloud",
    input: { kind: "text", minFiles: 1, maxFiles: 1, accept: TEXT, extensions: [".txt", ".md"] },
    options: [],
  },
  {
    id: "text-cleaner",
    name: "Text Cleaner",
    category: "text",
    description: "Trim, collapse, and strip messy text.",
    runtime: "cloud",
    input: { kind: "text", minFiles: 1, maxFiles: 1, accept: TEXT, extensions: [".txt", ".md"] },
    options: [
      { name: "trimLines", label: "Trim each line", type: "boolean", default: true },
      { name: "collapseSpaces", label: "Collapse spaces", type: "boolean", default: true },
      { name: "removeBlankLines", label: "Remove blank lines", type: "boolean", default: true },
      { name: "stripHtml", label: "Strip HTML tags", type: "boolean", default: false },
    ],
  },
  ...LOCAL_TOOLS,
  {
    id: "unit-converter",
    name: "Unit Converter",
    category: "utilities",
    description: "Convert length, mass, temperature, and data sizes instantly.",
    runtime: "client",
    input: { kind: "none", minFiles: 0, maxFiles: 0, accept: [], extensions: [] },
    options: [],
  },
  {
    id: "percentage-calculator",
    name: "Percentage Calculator",
    category: "utilities",
    description: "Percent-of, change, increase, and decrease calculations.",
    runtime: "client",
    input: { kind: "none", minFiles: 0, maxFiles: 0, accept: [], extensions: [] },
    options: [],
  },
];

export const TOOL_SUMMARIES = Object.fromEntries(
  FALLBACK_TOOLS.map((tool) => [tool.id, tool.description]),
);

/**
 * The API catalog does not know about frontend-only tools, so merge the local
 * definitions after every successful fetch. Local tools win on duplicate ids.
 */
export function mergeCatalogOperations(operations) {
  const remote = Array.isArray(operations) ? operations : [];
  const localIds = new Set(LOCAL_TOOLS.map((tool) => tool.id));
  return [...remote.filter((tool) => !localIds.has(tool.id)), ...LOCAL_TOOLS];
}

export function isLocalTool(tool) {
  return tool?.runtime === "local" || Boolean(tool?.local);
}

export function runtimeBadge(tool) {
  if (isLocalTool(tool)) return { status: "local", label: "● LOCAL" };
  if (tool?.runtime === "client") return { status: "client", label: "INSTANT" };
  return { status: "cloud", label: "CLOUD" };
}

export function toolById(tools, id) {
  return tools.find((tool) => tool.id === id) || FALLBACK_TOOLS.find((tool) => tool.id === id) || null;
}

export function defaultOptions(tool) {
  const values = {};
  for (const option of tool.options || []) {
    if (option.default !== undefined) {
      values[option.name] = option.default;
      continue;
    }
    if (option.type === "integer") {
      values[option.name] = option.min ?? 1;
    } else if (option.type === "boolean") {
      values[option.name] = false;
    } else if (option.type === "pageRange" || option.type === "pageRangeList") {
      values[option.name] = option.type === "pageRange" ? "all" : "";
    } else {
      values[option.name] = option.choices?.[0] ?? "";
    }
  }
  return values;
}

export function optionVisible(option, values) {
  if (!option.requiredWhen) return true;
  return values[option.requiredWhen.field] === option.requiredWhen.equals;
}

export function buildOptions(tool, values) {
  const result = {};
  for (const option of tool.options || []) {
    if (!optionVisible(option, values)) continue;
    const raw = values[option.name];
    if (option.type === "integer") {
      result[option.name] = Number(raw);
    } else if (option.type === "boolean") {
      result[option.name] = Boolean(raw);
    } else if (option.type === "pageRangeList") {
      result[option.name] = String(raw)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (option.type === "enum") {
      result[option.name] =
        option.choices?.find((choice) => String(choice) === String(raw)) ?? raw;
    } else {
      result[option.name] = raw;
    }
  }
  return result;
}

export function validateOptions(tool, values) {
  for (const option of tool.options || []) {
    if (!optionVisible(option, values)) continue;
    const raw = values[option.name];

    if (option.type === "integer") {
      const value = Number(raw);
      if (!Number.isInteger(value)) return `${option.label} must be a whole number.`;
      if (option.min !== undefined && value < option.min) return `${option.label} must be at least ${option.min}.`;
      if (option.max !== undefined && value > option.max) return `${option.label} must be at most ${option.max}.`;
      continue;
    }

    if (option.type === "pageRangeList") {
      const parts = String(raw).split(",").map((value) => value.trim()).filter(Boolean);
      if (parts.length === 0) return "Enter at least one page range.";
      if (!parts.every((part) => /^\d+(-\d+)?$/.test(part))) return "Use page ranges such as 1-3, 5, 8-10.";
      continue;
    }

    if (option.type === "pageRange") {
      const value = String(raw).trim();
      if (!value) return "Enter all or a page range such as 1-3,5.";
      if (value.toLowerCase() !== "all") {
        const parts = value.split(",").map((part) => part.trim());
        if (!parts.every((part) => /^\d+(-\d+)?$/.test(part))) return "Use all or a page range such as 1-3,5.";
      }
      continue;
    }

    if (option.type === "enum" && !option.choices.some((choice) => String(choice) === String(raw))) {
      return `Choose a valid ${option.label.toLowerCase()}.`;
    }
  }

  if (tool.id === "images-to-pdf" && values.pageSize === "fit" && Number(values.margin) !== 0) {
    return "Margin must be 0 when page size is fit.";
  }

  return null;
}

export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function timeRemaining(value) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return "expired";
  const totalMinutes = Math.max(1, Math.ceil(diff / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export function labelForValue(value) {
  const labels = {
    a4: "A4",
    letter: "Letter",
    fit: "Fit to image",
    png: "PNG",
    jpeg: "JPEG",
    webp: "WebP",
    low: "Low",
    medium: "Balanced",
    high: "High",
    ranges: "Page ranges",
    every: "Fixed page count",
    auto: "Auto",
    portrait: "Portrait",
    landscape: "Landscape",
    upper: "UPPER CASE",
    lower: "lower case",
    title: "Title Case",
    sentence: "Sentence case",
    pretty: "Pretty print",
    minify: "Minified",
    ",": "Comma",
    ";": "Semicolon",
    "\t": "Tab",
  };
  return labels[value] ?? String(value);
}

export function optionValueLabel(option, value) {
  if (option.type === "boolean") return value ? "On" : "Off";
  if (option.type === "enum") return labelForValue(value);
  if (option.type === "pageRangeList") return Array.isArray(value) ? value.join(", ") : String(value);
  if (option.type === "integer" && option.name === "dpi") return `${value} DPI`;
  if (option.type === "integer" && option.name === "margin") return `${value} pt`;
  if (option.type === "integer" && option.name === "maxWidth") return `${value} px`;
  return String(value);
}

export function summaryEntries(summary) {
  if (!summary || typeof summary !== "object") return [];
  const labels = {
    inputCount: "Input files",
    pageCount: "Pages",
    slides: "Slides",
    sourceFormat: "Input format",
    outputFormat: "Output format",
    messages: "Parser notes",
    partCount: "Parts",
    imageCount: "Images",
    pagesRotated: "Pages rotated",
    angle: "Angle",
    preset: "Preset",
    reductionPercent: "Size reduction",
    format: "Format",
    dpi: "Resolution",
    applied: "Reduction applied",
    message: "Note",
    rows: "Rows",
    columns: "Columns",
    totalRows: "Total rows",
    previewRows: "Preview rows",
    sampledPixels: "Sampled pixels",
    characters: "Characters",
    charactersNoSpaces: "No spaces",
    words: "Words",
    lines: "Lines",
    sentences: "Sentences",
    paragraphs: "Paragraphs",
    originalCharacters: "Original characters",
    cleanedCharacters: "Cleaned characters",
    removedCharacters: "Removed characters",
    quality: "Quality",
    maxWidth: "Max width",
    mode: "Mode",
    colors: "Colours",
  };
  const entries = [];
  for (const [key, value] of Object.entries(summary)) {
    if (value === null || value === undefined) continue;
    if (["originalSizeBytes", "outputSizeBytes", "artifactName", "headers"].includes(key)) continue;

    if (key === "colors" && Array.isArray(value)) {
      entries.push([labels[key], `${value.length}`]);
      continue;
    }
    if (typeof value === "object") continue;
    if (typeof value === "boolean") {
      entries.push([labels[key] || key, value ? "Yes" : "No"]);
      continue;
    }
    if (key === "reductionPercent") {
      entries.push([labels[key] || key, `${value}%`]);
      continue;
    }
    if (key === "angle") {
      entries.push([labels[key] || key, `${value}°`]);
      continue;
    }
    if (key === "maxWidth") {
      entries.push([labels[key] || key, `${value} px`]);
      continue;
    }
    entries.push([labels[key] || key, labelForValue(value)]);
  }
  return entries;
}
