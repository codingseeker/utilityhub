import { compressPdf } from "./compress-pdf.js";
import { imagesToPdf } from "./images-to-pdf.js";
import { mergePdf } from "./merge-pdf.js";
import { pdfToImages } from "./pdf-to-images.js";
import { rotatePdf } from "./rotate-pdf.js";
import { splitPdf } from "./split-pdf.js";
import { imageConvert } from "./image-convert.js";
import { imageCompress } from "./image-compress.js";
import { colorPicker } from "./color-picker.js";
import { csvToJson, tablePreview } from "./csv.js";
import { jsonFormat, jsonToCsv } from "./json.js";
import { textCase, textCleaner, textCounter } from "./text.js";

export const processors = Object.freeze({
  "merge-pdf": mergePdf,
  "split-pdf": splitPdf,
  "compress-pdf": compressPdf,
  "rotate-pdf": rotatePdf,
  "images-to-pdf": imagesToPdf,
  "pdf-to-images": pdfToImages,
  "image-convert": imageConvert,
  "image-compress": imageCompress,
  "color-picker": colorPicker,
  "csv-to-json": csvToJson,
  "json-to-csv": jsonToCsv,
  "json-format": jsonFormat,
  "table-preview": tablePreview,
  "text-case": textCase,
  "text-counter": textCounter,
  "text-cleaner": textCleaner,
});

export function getProcessor(operation) {
  return processors[operation] || null;
}
