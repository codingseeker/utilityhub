import { degrees, PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { Image } from "imagescript";
import mammoth from "mammoth";
import { Buffer } from "node:buffer";
import { Document, Packer, Paragraph, TextRun } from "docx";
import PptxGenJS from "pptxgenjs";

export type InputFile = { name: string; type: string; bytes: Uint8Array };
export type ProcessedArtifact = {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  summary?: Record<string, unknown>;
  previewRows?: string[][];
};

type PptxPresentation = {
  layout: string;
  author: string;
  addSlide(): {
    addText(text: string, options: Record<string, unknown>): void;
  };
  write(
    options: { outputType: string; compression: boolean },
  ): Promise<Uint8Array>;
};

function output(
  bytes: Uint8Array,
  fileName: string,
  contentType: string,
  summary: Record<string, unknown> = {},
): ProcessedArtifact {
  return { bytes, fileName, contentType, summary };
}

function textArtifact(
  text: string,
  fileName: string,
  contentType = "text/plain; charset=utf-8",
) {
  return output(new TextEncoder().encode(text), fileName, contentType);
}

function parseCsv(source: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  return rows;
}

function csvEscape(value: unknown, delimiter: string): string {
  const text = typeof value === "string"
    ? value
    : JSON.stringify(value ?? "") ?? "";
  return text.includes('"') || text.includes("\n") || text.includes("\r") ||
      text.includes(delimiter)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function csvToObjects(rows: string[][]): Record<string, string>[] {
  if (!rows.length) return [];
  const headers = rows[0].map((header, index) =>
    header || `column_${index + 1}`
  );
  return rows.slice(1).map((row) =>
    Object.fromEntries(
      headers.map((header, index) => [header, row[index] ?? ""]),
    )
  );
}

function parseRanges(value: unknown, pageCount: number): number[] {
  if (
    value === undefined || value === null || value === "" || value === "all"
  ) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }
  const parts = Array.isArray(value) ? value : String(value).split(",");
  const selected = new Set<number>();
  for (const item of parts) {
    const part = String(item).trim();
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new Error(`Invalid page range: ${part}`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(
        `Page range ${part} is outside this ${pageCount}-page document.`,
      );
    }
    for (let page = start; page <= end; page++) selected.add(page - 1);
  }
  return [...selected].sort((a, b) => a - b);
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function ext(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

async function processPdf(
  operation: string,
  files: InputFile[],
  params: Record<string, unknown>,
): Promise<ProcessedArtifact> {
  if (operation === "pdf_to_images") {
    throw new Error("PDF to Image is not supported in the cloud demo.");
  }

  if (operation === "merge_pdf") {
    const merged = await PDFDocument.create();
    for (const file of files) {
      const source = await PDFDocument.load(file.bytes, {
        ignoreEncryption: false,
      });
      const pages = await merged.copyPages(source, source.getPageIndices());
      for (const page of pages) merged.addPage(page);
    }
    const bytes = await merged.save();
    return output(bytes, "merged.pdf", "application/pdf", {
      inputCount: files.length,
      pageCount: merged.getPageCount(),
    });
  }

  const source = await PDFDocument.load(files[0].bytes, {
    ignoreEncryption: false,
  });
  if (operation === "rotate_pdf") {
    const angle = Number(params.angle ?? 90);
    if (![90, 180, 270].includes(angle)) {
      throw new Error("Rotation angle must be 90, 180, or 270 degrees.");
    }
    const pages = parseRanges(params.pages, source.getPageCount());
    for (const index of pages) {
      const page = source.getPage(index);
      page.setRotation(degrees((page.getRotation().angle + angle) % 360));
    }
    return output(await source.save(), "rotated.pdf", "application/pdf", {
      pagesRotated: pages.length,
      angle,
    });
  }

  if (operation === "compress_pdf") {
    source.setTitle("");
    source.setAuthor("");
    source.setSubject("");
    source.setKeywords([]);
    source.setCreator("");
    source.setProducer("");
    return output(
      await source.save({ useObjectStreams: true }),
      "compressed.pdf",
      "application/pdf",
      {
        preset: String(params.preset ?? "medium"),
        message:
          "PDF metadata was removed and object streams were enabled. Existing embedded images are not recompressed.",
      },
    );
  }

  if (operation === "split_pdf") {
    if (params.mode === "every") {
      const perFile = Math.max(1, Math.floor(Number(params.pagesPerFile ?? 1)));
      const zip = new JSZip();
      const count = source.getPageCount();
      for (let start = 0, part = 1; start < count; start += perFile, part++) {
        const indices = Array.from(
          { length: Math.min(perFile, count - start) },
          (_, offset) => start + offset,
        );
        const piece = await PDFDocument.create();
        for (const page of await piece.copyPages(source, indices)) {
          piece.addPage(page);
        }
        zip.file(
          `part-${String(part).padStart(3, "0")}.pdf`,
          await piece.save(),
        );
      }
      return output(
        await zip.generateAsync({ type: "uint8array" }),
        "split-pdf.zip",
        "application/zip",
        {
          partCount: Math.ceil(count / perFile),
          pageCount: count,
        },
      );
    }
    const indices = parseRanges(params.ranges, source.getPageCount());
    const piece = await PDFDocument.create();
    for (const page of await piece.copyPages(source, indices)) {
      piece.addPage(page);
    }
    return output(await piece.save(), "split-pages.pdf", "application/pdf", {
      pageCount: indices.length,
    });
  }

  throw new Error(`Unsupported PDF operation: ${operation}`);
}

async function imageToPng(file: InputFile): Promise<Image> {
  return await Image.decode(file.bytes);
}

function hex(color: number): string {
  return `#${((color >>> 24) & 255).toString(16).padStart(2, "0")}${
    ((color >>> 16) & 255).toString(16).padStart(2, "0")
  }${((color >>> 8) & 255).toString(16).padStart(2, "0")}`.toUpperCase();
}

async function processPhoto(
  operation: string,
  files: InputFile[],
  params: Record<string, unknown>,
): Promise<ProcessedArtifact> {
  if (operation === "images_to_pdf") {
    const pdf = await PDFDocument.create();
    const pageSize = String(params.pageSize ?? "fit");
    const margin = Math.max(0, Number(params.margin ?? 0));
    for (const file of files) {
      const image = await imageToPng(file);
      const isJpeg = ext(file.name) === "jpg" || ext(file.name) === "jpeg";
      const imageBytes = isJpeg ? file.bytes : await image.encodePNG();
      const embedded = isJpeg
        ? await pdf.embedJpg(imageBytes)
        : await pdf.embedPng(imageBytes);
      const fitWidth = image.width * 0.75 + margin * 2;
      const fitHeight = image.height * 0.75 + margin * 2;
      let width = fitWidth;
      let height = fitHeight;
      if (pageSize !== "fit") {
        const paper = pageSize === "a4" ? [595.28, 841.89] : [612, 792];
        let [pageWidth, pageHeight] = paper;
        const orientation = String(params.orientation ?? "auto");
        const landscape = orientation === "landscape" ||
          (orientation === "auto" && image.width > image.height);
        if (landscape) [pageWidth, pageHeight] = [pageHeight, pageWidth];
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;
        const scale = Math.min(
          availableWidth / embedded.width,
          availableHeight / embedded.height,
        );
        width = embedded.width * scale;
        height = embedded.height * scale;
        const page = pdf.addPage([pageWidth, pageHeight]);
        page.drawImage(embedded, {
          x: (pageWidth - width) / 2,
          y: (pageHeight - height) / 2,
          width,
          height,
        });
        continue;
      }
      const page = pdf.addPage([width, height]);
      page.drawImage(embedded, {
        x: margin,
        y: margin,
        width: width - margin * 2,
        height: height - margin * 2,
      });
    }
    return output(await pdf.save(), "images.pdf", "application/pdf", {
      imageCount: files.length,
      pageCount: files.length,
    });
  }

  const image = await imageToPng(files[0]);
  if (operation === "color_picker") {
    const size = Math.max(3, Math.min(8, Number(params.paletteSize ?? 6)));
    const buckets = new Map<string, number>();
    const step = Math.max(
      1,
      Math.floor(Math.sqrt((image.width * image.height) / 30000)),
    );
    let sampledPixels = 0;
    for (let y = 0; y < image.height; y += step) {
      for (let x = 0; x < image.width; x += step) {
        const color = image.getPixelAt(x, y);
        const alpha = color & 255;
        if (alpha < 32) continue;
        const r = ((color >>> 24) & 255) >> 3;
        const g = ((color >>> 16) & 255) >> 3;
        const b = ((color >>> 8) & 255) >> 3;
        const key = `${r},${g},${b}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
        sampledPixels++;
      }
    }
    const colors = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(
      0,
      size,
    )
      .map(([key]) => {
        const [r, g, b] = key.split(",").map(Number);
        return `#${
          [r * 8 + 4, g * 8 + 4, b * 8 + 4].map((value) =>
            value.toString(16).padStart(2, "0")
          ).join("")
        }`.toUpperCase();
      });
    return output(
      new TextEncoder().encode(
        JSON.stringify({ colors, sampledPixels }, null, 2),
      ),
      "color-palette.json",
      "application/json",
      {
        colors: colors.join(", "),
        sampledPixels,
      },
    );
  }

  if (
    operation === "image_compress" && Number(params.maxWidth) > 0 &&
    image.width > Number(params.maxWidth)
  ) {
    image.resize({
      width: Math.min(4096, Math.max(320, Number(params.maxWidth))),
    });
  }
  const quality = Math.max(40, Math.min(100, Number(params.quality ?? 85)));
  const targetFormat = operation === "image_compress"
    ? "webp"
    : String(params.format ?? "png");
  if (!["png", "jpeg", "webp"].includes(targetFormat)) {
    throw new Error("Output format must be PNG, JPEG, or WebP.");
  }
  const bytes = targetFormat === "png"
    ? await image.encodePNG()
    : targetFormat === "jpeg"
    ? await image.encodeJPEG(quality)
    : await image.encodeWebP({ quality });
  const inputName = files[0].name.replace(/\.[^.]+$/, "");
  const extName = targetFormat === "jpeg" ? "jpg" : targetFormat;
  return output(
    bytes,
    `${inputName}.${extName}`,
    `image/${targetFormat === "jpeg" ? "jpeg" : targetFormat}`,
    {
      format: targetFormat,
      quality,
      ...(operation === "image_compress"
        ? {
          maxWidth: Math.min(
            4096,
            Math.max(320, Number(params.maxWidth ?? image.width)),
          ),
        }
        : {}),
    },
  );
}

function processData(
  operation: string,
  file: InputFile,
  params: Record<string, unknown>,
): ProcessedArtifact {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  if (operation === "csv_to_json" || operation === "table_preview") {
    const delimiter = String(
      params.delimiter ?? (ext(file.name) === "tsv" ? "\t" : ","),
    );
    if (![",", ";", "\t"].includes(delimiter)) {
      throw new Error("Delimiter must be a comma, semicolon, or tab.");
    }
    const rows = parseCsv(text.replace(/^\uFEFF/, ""), delimiter);
    if (!rows.length) throw new Error("The CSV file is empty.");
    const objects = csvToObjects(rows);
    const requestedRows = Number(params.maxRows ?? 20);
    const previewLimit = Number.isFinite(requestedRows)
      ? Math.min(50, Math.max(5, Math.floor(requestedRows)))
      : 20;
    const previewRows = rows.slice(
      0,
      operation === "table_preview" ? previewLimit + 1 : 11,
    );
    if (operation === "table_preview") {
      return {
        ...textArtifact(
          JSON.stringify(
            objects.slice(0, previewLimit),
            null,
            2,
          ),
          "table-preview.json",
          "application/json",
        ),
        previewRows,
        summary: {
          rows: objects.length,
          columns: rows[0].length,
          previewRows: Math.min(objects.length, previewLimit),
        },
      };
    }
    return output(
      new TextEncoder().encode(JSON.stringify(objects, null, 2)),
      file.name.replace(/\.[^.]+$/, ".json"),
      "application/json",
      {
        rows: objects.length,
        columns: rows[0].length,
      },
    );
  }

  if (operation === "json_to_csv") {
    const data = JSON.parse(text);
    if (
      !Array.isArray(data) ||
      data.some((item) =>
        !item || typeof item !== "object" || Array.isArray(item)
      )
    ) {
      throw new Error("JSON to CSV expects an array of objects.");
    }
    const columns = [...new Set(data.flatMap((item) => Object.keys(item)))];
    const lines = [columns.map((column) => csvEscape(column, ",")).join(",")];
    for (const row of data) {
      lines.push(
        columns.map((column) => csvEscape(row[column], ",")).join(","),
      );
    }
    return output(
      new TextEncoder().encode(lines.join("\r\n")),
      file.name.replace(/\.[^.]+$/, ".csv"),
      "text/csv; charset=utf-8",
      {
        rows: data.length,
        columns: columns.length,
      },
    );
  }

  if (operation === "json_formatter") {
    const data = JSON.parse(text);
    const formatted = params.mode === "minify"
      ? JSON.stringify(data)
      : JSON.stringify(data, null, 2);
    return output(
      new TextEncoder().encode(formatted),
      file.name,
      "application/json",
      { mode: String(params.mode ?? "pretty") },
    );
  }

  throw new Error(`Unsupported data operation: ${operation}`);
}

function caseText(text: string, mode: string): string {
  if (mode === "upper") return text.toLocaleUpperCase();
  if (mode === "lower") return text.toLocaleLowerCase();
  if (mode === "sentence") {
    return text.toLocaleLowerCase().replace(
      /(^\s*[a-z]|[.!?]\s+[a-z])/gu,
      (match) => match.toLocaleUpperCase(),
    );
  }
  if (mode === "title") {
    return text.toLocaleLowerCase().replace(
      /(^|[\s([{])([\p{L}\p{N}])/gu,
      (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase()}`,
    );
  }
  throw new Error("Choose upper, lower, title, or sentence case.");
}

async function processTextOffice(
  operation: string,
  files: InputFile[],
  params: Record<string, unknown>,
): Promise<ProcessedArtifact> {
  const file = files[0];
  if (operation === "docx_to_text") {
    const converted = await mammoth.extractRawText({
      buffer: Buffer.from(file.bytes),
    });
    return textArtifact(
      converted.value,
      file.name.replace(/\.docx$/i, ".txt"),
      "text/plain; charset=utf-8",
    );
  }
  if (operation === "pptx_to_text") {
    const zip = await JSZip.loadAsync(file.bytes);
    const slidePaths = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name)
    )
      .sort((a, b) =>
        Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1])
      );
    const slideText: string[] = [];
    for (const [index, path] of slidePaths.entries()) {
      const xml = await zip.file(path)!.async("text");
      const lines = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) =>
        decodeXml(match[1])
      );
      slideText.push(`Slide ${index + 1}\n${lines.join("\n")}`);
    }
    return textArtifact(
      slideText.join("\n\n"),
      file.name.replace(/\.pptx$/i, ".txt"),
    );
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  if (operation === "case_changer") {
    return textArtifact(
      caseText(text, String(params.mode ?? "upper")),
      file.name,
    );
  }
  if (operation === "word_counter") {
    const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
    const lines = text.length ? text.split(/\r\n|\n|\r/).length : 0;
    const sentences =
      (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).filter((part) =>
        part.trim()
      ).length;
    return output(
      new TextEncoder().encode(JSON.stringify(
        {
          characters: text.length,
          charactersNoSpaces: text.replace(/\s/gu, "").length,
          words: words.length,
          lines,
          sentences,
        },
        null,
        2,
      )),
      "text-count.json",
      "application/json",
      {
        characters: text.length,
        charactersNoSpaces: text.replace(/\s/gu, "").length,
        words: words.length,
        lines,
        sentences,
      },
    );
  }
  if (operation === "text_cleaner") {
    let result = text;
    if (params.stripHtml) result = result.replace(/<[^>]*>/g, " ");
    let lines = result.split(/\r\n|\n|\r/);
    if (params.trimLines) lines = lines.map((line) => line.trim());
    if (params.collapseSpaces) {
      lines = lines.map((line) => line.replace(/[\t ]{2,}/g, " "));
    }
    if (params.removeBlankLines) {
      lines = lines.filter((line) => line.length > 0);
    }
    result = lines.join("\n");
    return output(
      new TextEncoder().encode(result),
      file.name,
      "text/plain; charset=utf-8",
      {
        originalCharacters: text.length,
        cleanedCharacters: result.length,
        removedCharacters: text.length - result.length,
      },
    );
  }
  if (operation === "text_to_docx") {
    const paragraphs = text.split(/\r\n|\n|\r/).map((line) =>
      new Paragraph({ children: [new TextRun(line)] })
    );
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const bytes = await Packer.toBuffer(doc);
    return output(
      new Uint8Array(bytes),
      file.name.replace(/\.(txt|md)$/i, ".docx"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  }
  if (operation === "text_to_pptx") {
    const PptxConstructor = PptxGenJS as unknown as new () => PptxPresentation;
    const pptx = new PptxConstructor();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "UtilityHub";
    for (const paragraph of text.split(/\r\n|\n|\r/)) {
      const slide = pptx.addSlide();
      slide.addText(paragraph || " ", {
        x: 0.5,
        y: 0.75,
        w: 12.3,
        h: 5.8,
        fontSize: 24,
        breakLine: false,
        valign: "middle",
      });
    }
    const data = await pptx.write({
      outputType: "uint8array",
      compression: true,
    });
    return output(
      new Uint8Array(data as Uint8Array),
      file.name.replace(/\.(txt|md)$/i, ".pptx"),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  }
  throw new Error(`Unsupported text or Office operation: ${operation}`);
}

export function normalizeOperation(input: string): string {
  const normalized = input.trim().toLowerCase().replaceAll("-", "_");
  const aliases: Record<string, string> = {
    "merge_pdf": "merge_pdf",
    "split_pdf": "split_pdf",
    "compress_pdf": "compress_pdf",
    "rotate_pdf": "rotate_pdf",
    "images_to_pdf": "images_to_pdf",
    "pdf_to_images": "pdf_to_images",
    "pdf_to_image": "pdf_to_images",
    "image_convert": "image_convert",
    "convert_image": "image_convert",
    "image_compress": "image_compress",
    "compress_image": "image_compress",
    "color_picker": "color_picker",
    "csv_to_json": "csv_to_json",
    "json_to_csv": "json_to_csv",
    "json_format": "json_formatter",
    "json_formatter": "json_formatter",
    "table_preview": "table_preview",
    "text_case": "case_changer",
    "case_changer": "case_changer",
    "text_counter": "word_counter",
    "word_counter": "word_counter",
    "text_cleaner": "text_cleaner",
    "docx_to_txt": "docx_to_text",
    "docx_to_text": "docx_to_text",
    "txt_to_docx": "text_to_docx",
    "text_to_docx": "text_to_docx",
    "pptx_to_txt": "pptx_to_text",
    "pptx_to_text": "pptx_to_text",
    "txt_to_pptx": "text_to_pptx",
    "text_to_pptx": "text_to_pptx",
  };
  const operation = aliases[normalized];
  if (!operation) throw new Error(`Unsupported operation: ${input}`);
  return operation;
}

export async function processOperation(
  operationName: string,
  files: InputFile[],
  params: Record<string, unknown>,
): Promise<ProcessedArtifact> {
  const operation = normalizeOperation(operationName);
  if (!files.length) throw new Error("At least one file is required.");
  if (
    ["merge_pdf", "split_pdf", "compress_pdf", "rotate_pdf", "pdf_to_images"]
      .includes(operation)
  ) {
    return await processPdf(operation, files, params);
  }
  if (
    ["images_to_pdf", "image_convert", "image_compress", "color_picker"]
      .includes(operation)
  ) {
    return await processPhoto(operation, files, params);
  }
  if (
    ["csv_to_json", "json_to_csv", "json_formatter", "table_preview"].includes(
      operation,
    )
  ) {
    return processData(operation, files[0], params);
  }
  return await processTextOffice(operation, files, params);
}
