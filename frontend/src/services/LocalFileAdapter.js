import {
  OFFICE_TO_PDF_MESSAGE,
  fileExtension,
  isOfficeFile,
  officeKind,
} from "./fileTypes.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TEXT_MIME = "text/plain;charset=utf-8";

export class LocalProcessingError extends Error {
  constructor(message, { code = "LOCAL_PROCESSING_FAILED", details } = {}) {
    super(message);
    this.name = "LocalProcessingError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Every operation in this map is executed with browser APIs only. The heavy
 * libraries are imported lazily so the main bundle stays small and a cloud
 * tool never downloads Office parsers it does not need.
 */
export const LOCAL_OPERATIONS = Object.freeze({
  "docx-to-txt": {
    id: "docx-to-txt",
    inputExtensions: [".docx"],
    output: "txt",
    label: "Extracting text from DOCX",
  },
  "txt-to-docx": {
    id: "txt-to-docx",
    inputExtensions: [".txt", ".md"],
    output: "docx",
    label: "Building a DOCX",
  },
  "pptx-to-txt": {
    id: "pptx-to-txt",
    inputExtensions: [".pptx"],
    output: "txt",
    label: "Extracting text from PPTX",
  },
  "txt-to-pptx": {
    id: "txt-to-pptx",
    inputExtensions: [".txt", ".md"],
    output: "pptx",
    label: "Building a PPTX",
  },
});

export const LOCAL_OPERATION_IDS = Object.freeze(Object.keys(LOCAL_OPERATIONS));

function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n");
}

function baseName(name) {
  return String(name || "document").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-");
}

function outputFileName(operationId, inputName) {
  const operation = LOCAL_OPERATIONS[operationId];
  const stem = baseName(inputName);
  if (!operation) return stem;
  return `${stem}-${operation.output === "txt" ? "extracted" : "utilityhub"}.${operation.output}`;
}

function textStats(text) {
  const normalized = normalizeNewlines(text);
  const words = normalized.trim() ? normalized.trim().split(/\s+/).length : 0;
  const lines = normalized.length === 0 ? 0 : normalized.split("\n").length;
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  return {
    characters: normalized.length,
    words,
    lines,
    paragraphs,
  };
}

function ensureBlob(value, mimeType) {
  if (value instanceof Blob) {
    if (value.type === mimeType) return value;
    return new Blob([value], { type: mimeType });
  }
  return new Blob([value], { type: mimeType });
}

async function readText(file) {
  if (typeof file.text === "function") return file.text();
  const buffer = await file.arrayBuffer();
  return new TextDecoder("utf-8").decode(buffer);
}

async function readArrayBuffer(file) {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Response(file).arrayBuffer();
}

function artifact({ blob, fileName, mimeType, summary }) {
  const safeBlob = ensureBlob(blob, mimeType);
  return {
    blob: safeBlob,
    fileName,
    mimeType,
    sizeBytes: safeBlob.size,
    summary: {
      ...summary,
      outputSizeBytes: safeBlob.size,
    },
    runtime: "local",
  };
}

function validate(operationId, files) {
  if (operationId === "docx-to-pdf" || operationId === "pptx-to-pdf") {
    throw new LocalProcessingError(OFFICE_TO_PDF_MESSAGE, {
      code: "OFFICE_PDF_UNSUPPORTED",
    });
  }

  const operation = LOCAL_OPERATIONS[operationId];
  if (!operation) {
    if (files.some(isOfficeFile)) {
      throw new LocalProcessingError(OFFICE_TO_PDF_MESSAGE, {
        code: "OFFICE_PDF_UNSUPPORTED",
      });
    }
    throw new LocalProcessingError("This operation does not have a local processor.", {
      code: "UNSUPPORTED_LOCAL_OPERATION",
    });
  }

  if (!Array.isArray(files) || files.length !== 1) {
    throw new LocalProcessingError("This local tool accepts exactly one file.", {
      code: "INVALID_FILE_COUNT",
    });
  }

  const file = files[0];
  if (!file || file.size === 0) {
    throw new LocalProcessingError("The selected file is empty.", {
      code: "EMPTY_FILE",
    });
  }

  const extension = fileExtension(file.name);
  if (!operation.inputExtensions.includes(extension)) {
    throw new LocalProcessingError(
      `${file.name} is not a supported input for this tool. Use ${operation.inputExtensions.join(" or ")}.`,
      { code: "UNSUPPORTED_FILE_TYPE" },
    );
  }

  return { operation, file, extension };
}

async function docxToTxt(file, operation) {
  const mammoth = (await import("mammoth")).default;
  const arrayBuffer = await readArrayBuffer(file);
  // Mammoth's browser build reads `arrayBuffer`; its Node build reads `buffer`.
  // The adapter is browser-first, but this keeps the verification script honest.
  const input =
    typeof window === "undefined" && typeof Buffer !== "undefined"
      ? { buffer: Buffer.from(arrayBuffer) }
      : { arrayBuffer };
  const result = await mammoth.extractRawText(input);
  const text = normalizeNewlines(result.value).trim();

  if (!text) {
    throw new LocalProcessingError(
      "No extractable text was found in this Word document. It may contain only images or embedded objects.",
      { code: "EMPTY_DOCUMENT" },
    );
  }

  const stats = textStats(text);
  return artifact({
    blob: new Blob([text], { type: TEXT_MIME }),
    fileName: outputFileName(operation.id, file.name),
    mimeType: TEXT_MIME,
    summary: {
      sourceFormat: "DOCX",
      outputFormat: "TXT",
      ...stats,
      messages: result.messages?.length || 0,
    },
  });
}

async function txtToDocx(file, operation) {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const text = normalizeNewlines(await readText(file));
  const lines = text.split("\n");
  const paragraphs = lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, font: "Calibri", size: 24 })],
        spacing: { after: 120 },
      }),
  );

  const document = new Document({
    creator: "UtilityHub",
    title: baseName(file.name),
    description: "Created locally in the browser by UtilityHub.",
    sections: [
      {
        properties: {},
        children:
          paragraphs.length > 0
            ? paragraphs
            : [new Paragraph({ children: [new TextRun("")] })],
      },
    ],
  });

  let output;
  try {
    output = await Packer.toBlob(document);
  } catch {
    output = await Packer.toBuffer(document);
  }

  const stats = textStats(text);
  return artifact({
    blob: output,
    fileName: outputFileName(operation.id, file.name),
    mimeType: DOCX_MIME,
    summary: {
      sourceFormat: "TXT",
      outputFormat: "DOCX",
      ...stats,
    },
  });
}

function collectTextRuns(value, output) {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextRuns(item, output);
    return;
  }
  if (typeof value === "object") {
    if (typeof value["#text"] === "string" || typeof value["#text"] === "number") {
      const text = String(value["#text"]).trim();
      if (text) output.push(text);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "#text" || key === ":@" || key === "?xml") continue;
      collectTextRuns(child, output);
    }
  }
}

function collectSlideText(node, output) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectSlideText(child, output);
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "#text" || key === ":@" || key === "?xml") continue;
    if (key === "a:t" || key.endsWith(":t")) {
      collectTextRuns(value, output);
      continue;
    }
    collectSlideText(value, output);
  }
}

function slideNumber(path) {
  const match = /slide(\d+)\.xml$/i.exec(path);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function pptxToTxt(file, operation) {
  const JSZip = (await import("jszip")).default;
  const { XMLParser } = await import("fast-xml-parser");
  const zip = await JSZip.loadAsync(await readArrayBuffer(file));
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => slideNumber(left) - slideNumber(right));

  if (slidePaths.length === 0) {
    throw new LocalProcessingError(
      "This presentation does not contain any readable slides.",
      { code: "EMPTY_PRESENTATION" },
    );
  }

  const parser = new XMLParser({
    ignoreAttributes: true,
    preserveOrder: true,
    trimValues: false,
    parseTagValue: false,
  });

  const slides = [];
  for (const path of slidePaths) {
    const xml = await zip.file(path).async("text");
    const parsed = parser.parse(xml);
    const runs = [];
    collectSlideText(parsed, runs);
    slides.push(runs.join(" ").replace(/\s+/g, " ").trim());
  }

  const text = slides.filter(Boolean).join("\n\n").trim();
  if (!text) {
    throw new LocalProcessingError(
      "No extractable text was found in this presentation. The slides may contain only images.",
      { code: "EMPTY_DOCUMENT" },
    );
  }

  const stats = textStats(text);
  return artifact({
    blob: new Blob([text], { type: TEXT_MIME }),
    fileName: outputFileName(operation.id, file.name),
    mimeType: TEXT_MIME,
    summary: {
      sourceFormat: "PPTX",
      outputFormat: "TXT",
      slides: slides.length,
      ...stats,
    },
  });
}

async function txtToPptx(file, operation) {
  const pptxgenModule = await import("pptxgenjs");
  const PptxGenJS = pptxgenModule.default || pptxgenModule;
  const text = normalizeNewlines(await readText(file));
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new LocalProcessingError(
      "The text file has no lines. Add at least one non-empty line to create a slide.",
      { code: "EMPTY_DOCUMENT" },
    );
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "UtilityHub";
  pptx.company = "UtilityHub";
  pptx.subject = "Generated locally in the browser";
  pptx.title = baseName(file.name);

  lines.forEach((line, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: "0F0F0F" };
    slide.addText(line, {
      x: 0.7,
      y: 0.7,
      w: 11.9,
      h: 5.9,
      fontFace: "Arial",
      fontSize: line.length > 180 ? 16 : line.length > 90 ? 22 : 30,
      color: "FAFAFA",
      bold: index === 0,
      valign: "mid",
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
  });

  let output;
  try {
    output = await pptx.write({ outputType: "blob", compression: true });
  } catch {
    output = await pptx.write({ outputType: "arraybuffer", compression: true });
  }

  const stats = textStats(text);
  return artifact({
    blob: output,
    fileName: outputFileName(operation.id, file.name),
    mimeType: PPTX_MIME,
    summary: {
      sourceFormat: "TXT",
      outputFormat: "PPTX",
      slides: lines.length,
      ...stats,
    },
  });
}

const PROCESSORS = {
  "docx-to-txt": docxToTxt,
  "txt-to-docx": txtToDocx,
  "pptx-to-txt": pptxToTxt,
  "txt-to-pptx": txtToPptx,
};

/**
 * LocalFileAdapter is the only place Office bytes are read. It uses File,
 * Blob, JSZip, and browser-capable libraries; it never imports the API client.
 */
export const LocalFileAdapter = {
  id: "local",
  runtime: "local",
  operations: LOCAL_OPERATION_IDS,

  supports(operationId, files = []) {
    if (LOCAL_OPERATIONS[operationId]) return true;
    return files.some(isOfficeFile);
  },

  async process({ operationId, files = [], onStage } = {}) {
    const { operation, file } = validate(operationId, files);
    const processor = PROCESSORS[operation.id];
    if (!processor) {
      throw new LocalProcessingError("This local operation is not implemented.", {
        code: "UNSUPPORTED_LOCAL_OPERATION",
      });
    }

    onStage?.(operation.label);
    const result = await processor(file, operation);
    onStage?.("Preparing download");
    return result;
  },
};

export { OFFICE_TO_PDF_MESSAGE, isOfficeFile, officeKind };
