import { PDFDocument } from "pdf-lib";
import { Image } from "imagescript";
import { processOperation } from "./processor.ts";

async function onePagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 300]);
  return await pdf.save();
}

Deno.test("PDF merge, split, rotate, and metadata-only compression", async () => {
  const first = await onePagePdf();
  const second = await onePagePdf();

  const merged = await processOperation("merge_pdf", [
    { name: "one.pdf", type: "application/pdf", bytes: first },
    { name: "two.pdf", type: "application/pdf", bytes: second },
  ], {});
  const mergedDoc = await PDFDocument.load(merged.bytes);
  if (mergedDoc.getPageCount() !== 2) {
    throw new Error("Merge did not retain both pages.");
  }

  const split = await processOperation("split_pdf", [
    { name: "merged.pdf", type: "application/pdf", bytes: merged.bytes },
  ], { mode: "ranges", ranges: ["2"] });
  if ((await PDFDocument.load(split.bytes)).getPageCount() !== 1) {
    throw new Error("Split did not extract the selected page.");
  }

  const rotated = await processOperation("rotate_pdf", [
    { name: "one.pdf", type: "application/pdf", bytes: first },
  ], { angle: 90, pages: "all" });
  if (
    (await PDFDocument.load(rotated.bytes)).getPage(0).getRotation().angle !==
      90
  ) {
    throw new Error("Rotate did not update the page rotation.");
  }

  const compressed = await processOperation("compress_pdf", [
    { name: "one.pdf", type: "application/pdf", bytes: first },
  ], { preset: "high" });
  if (!String(compressed.summary?.message).includes("not recompressed")) {
    throw new Error("PDF compression limitation was not reported.");
  }

  try {
    await processOperation("pdf_to_images", [
      { name: "one.pdf", type: "application/pdf", bytes: first },
    ], {});
    throw new Error(
      "PDF to image should have reported its cloud demo limitation.",
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("not supported in the cloud demo")
    ) throw error;
  }
});

Deno.test("image conversion, compression, dominant palette, and images-to-PDF", async () => {
  const image = new Image(4, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) image.setPixelAt(x, y, 0xff0000ff);
  }
  const png = await image.encodePNG();
  const file = { name: "red.png", type: "image/png", bytes: png };

  const jpeg = await processOperation("image_convert", [file], {
    format: "jpeg",
    quality: 88,
  });
  if (jpeg.contentType !== "image/jpeg") {
    throw new Error("Image conversion returned the wrong format.");
  }

  const compressed = await processOperation("image_compress", [file], {
    quality: 70,
    maxWidth: 320,
  });
  if (compressed.contentType !== "image/webp") {
    throw new Error("Image compression did not produce WebP.");
  }

  const palette = await processOperation("color_picker", [file], {
    paletteSize: 3,
  });
  if (!String(palette.summary?.colors).includes("#")) {
    throw new Error("No dominant colors were returned.");
  }

  const pdf = await processOperation("images_to_pdf", [file], {
    pageSize: "fit",
    margin: 0,
  });
  if ((await PDFDocument.load(pdf.bytes)).getPageCount() !== 1) {
    throw new Error("Image was not embedded into the PDF.");
  }
});

Deno.test("CSV, JSON, table preview, and text tools return useful results", async () => {
  const csv = {
    name: "rows.csv",
    type: "text/csv",
    bytes: new TextEncoder().encode('name,value\n"A, B",2\nC,3'),
  };
  const json = await processOperation("csv_to_json", [csv], { delimiter: "," });
  if (!new TextDecoder().decode(json.bytes).includes('"A, B"')) {
    throw new Error("Quoted CSV field was not parsed.");
  }

  const preview = await processOperation("table_preview", [csv], {
    delimiter: ",",
    maxRows: 5,
  });
  if (preview.previewRows?.length !== 3) {
    throw new Error("Table preview omitted rows.");
  }

  const formatted = await processOperation("json_formatter", [
    {
      name: "data.json",
      type: "application/json",
      bytes: new TextEncoder().encode('{"a":1}'),
    },
  ], { mode: "pretty" });
  if (!new TextDecoder().decode(formatted.bytes).includes("\n")) {
    throw new Error("JSON was not pretty-printed.");
  }

  const csvOut = await processOperation("json_to_csv", [
    {
      name: "items.json",
      type: "application/json",
      bytes: new TextEncoder().encode('[{"name":"A, B","count":2}]'),
    },
  ], {});
  if (!new TextDecoder().decode(csvOut.bytes).includes('"A, B"')) {
    throw new Error("JSON values were not escaped in CSV.");
  }

  const counted = await processOperation("word_counter", [
    {
      name: "words.txt",
      type: "text/plain",
      bytes: new TextEncoder().encode("One two.\nThree!"),
    },
  ], {});
  if (counted.summary?.words !== 3 || counted.summary?.lines !== 2) {
    throw new Error("Text counts are incorrect.");
  }

  const sourceText = {
    name: "copy.txt",
    type: "text/plain",
    bytes: new TextEncoder().encode("  hello   world  \n\n"),
  };
  const titleCase = await processOperation("case_changer", [sourceText], {
    mode: "title",
  });
  if (new TextDecoder().decode(titleCase.bytes) !== "  Hello   World  \n\n") {
    throw new Error("Title case conversion failed.");
  }
  const cleaned = await processOperation("text_cleaner", [sourceText], {
    trimLines: true,
    collapseSpaces: true,
    removeBlankLines: true,
  });
  if (new TextDecoder().decode(cleaned.bytes) !== "hello world") {
    throw new Error("Text cleanup failed.");
  }
});

Deno.test("DOCX and PPTX text operations round-trip", async () => {
  const source = {
    name: "notes.txt",
    type: "text/plain",
    bytes: new TextEncoder().encode("Hello UtilityHub\nSecond line"),
  };
  const docx = await processOperation("text_to_docx", [source], {});
  const text = await processOperation("docx_to_text", [
    {
      name: "notes.docx",
      type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: docx.bytes,
    },
  ], {});
  if (!new TextDecoder().decode(text.bytes).includes("Hello UtilityHub")) {
    throw new Error("DOCX text was not recovered.");
  }

  const pptx = await processOperation("text_to_pptx", [source], {});
  const slideText = await processOperation("pptx_to_text", [
    {
      name: "notes.pptx",
      type:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: pptx.bytes,
    },
  ], {});
  if (!new TextDecoder().decode(slideText.bytes).includes("Hello UtilityHub")) {
    throw new Error("PPTX text was not recovered.");
  }
});
