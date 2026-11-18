import { afterEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  createCloudJob,
  createHarness,
  downloadBytes,
  file,
  makeJpeg,
  makePdf,
  makePng,
  processNext,
} from "./helpers.js";

let harness;

afterEach(async () => {
  if (harness) await harness.close();
  harness = null;
});

async function run(operation, files, options = {}) {
  const { job } = await createCloudJob(harness, "alice", { operation, files, options });
  const [result] = await processNext(harness);
  expect(result.status, `${operation} should complete`).toBe("done");
  const status = await harness.api
    .get(`/api/v1/jobs/${job.id}`)
    .set("X-Dev-User", "alice")
    .expect(200);
  expect(status.body.data.status).toBe("done");
  const downloaded = await downloadBytes(harness, "alice", job.id);
  return { job: status.body.data, ...downloaded };
}

describe("pdf operations", () => {
  it("merges PDFs", async () => {
    harness = await createHarness();
    const { job, bytes } = await run("merge-pdf", [
      file("one.pdf", await makePdf(1, "First"), "application/pdf"),
      file("two.pdf", await makePdf(2, "Second"), "application/pdf"),
    ]);
    expect(job.result.pageCount).toBe(3);
    const merged = await PDFDocument.load(bytes);
    expect(merged.getPageCount()).toBe(3);
  });

  it("splits a PDF into a zip", async () => {
    harness = await createHarness();
    const { job, info, bytes } = await run(
      "split-pdf",
      [file("source.pdf", await makePdf(3), "application/pdf")],
      { mode: "ranges", ranges: ["1", "2-3"] },
    );
    expect(job.result.summary.partCount).toBe(2);
    expect(info.mimeType).toBe("application/zip");
    expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("compresses a PDF", async () => {
    harness = await createHarness();
    const { job, bytes } = await run("compress-pdf", [
      file("source.pdf", await makePdf(1), "application/pdf"),
    ]);
    expect(job.result.summary.preset).toBe("medium");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("rotates selected PDF pages", async () => {
    harness = await createHarness();
    const { job, bytes } = await run(
      "rotate-pdf",
      [file("source.pdf", await makePdf(2), "application/pdf")],
      { angle: 90, pages: "1" },
    );
    expect(job.result.summary.pagesRotated).toBe(1);
    const output = await PDFDocument.load(bytes);
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(output.getPage(1).getRotation().angle).toBe(0);
  });

  it("builds a PDF from images", async () => {
    harness = await createHarness();
    const { job, bytes } = await run("images-to-pdf", [
      file("one.png", await makePng(), "image/png"),
      file("two.jpg", await makeJpeg(), "image/jpeg"),
    ]);
    expect(job.result.pageCount).toBe(2);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("renders PDF pages to images", async () => {
    harness = await createHarness();
    const { job, info, bytes } = await run(
      "pdf-to-images",
      [file("source.pdf", await makePdf(2), "application/pdf")],
      { format: "png", dpi: 72, pages: "all" },
    );
    expect(job.result.summary.pageCount).toBe(2);
    expect(info.mimeType).toBe("application/zip");
    expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
  });
});

describe("photo operations", () => {
  it("converts an image", async () => {
    harness = await createHarness();
    const { info, bytes } = await run(
      "image-convert",
      [file("photo.png", await makePng(), "image/png")],
      { format: "jpeg", quality: 85 },
    );
    expect(info.mimeType).toBe("image/jpeg");
    expect((await sharp(bytes).metadata()).format).toBe("jpeg");
  });

  it("compresses an image", async () => {
    harness = await createHarness();
    const { job, info, bytes } = await run(
      "image-compress",
      [file("photo.jpg", await makeJpeg(800, 600), "image/jpeg")],
      { quality: 50, maxWidth: 320 },
    );
    expect(info.mimeType).toBe("image/jpeg");
    const metadata = await sharp(bytes).metadata();
    expect(metadata.width).toBeLessThanOrEqual(320);
    expect(job.result.summary.quality).toBe(50);
  });

  it("extracts a colour palette", async () => {
    harness = await createHarness();
    const { job, bytes } = await run(
      "color-picker",
      [file("swatch.png", await makePng(96, 96), "image/png")],
      { paletteSize: 3 },
    );
    const palette = JSON.parse(bytes.toString("utf8"));
    expect(palette.colors[0].hex).toBe("#FFD54F");
    expect(job.result.summary.colors[0].hex).toBe("#FFD54F");
  });
});

describe("data operations", () => {
  it("converts CSV to JSON", async () => {
    harness = await createHarness();
    const csv = Buffer.from("name,city\nAda,London\nGrace,New York\n");
    const { info, bytes } = await run("csv-to-json", [file("people.csv", csv, "text/csv")]);
    expect(info.mimeType).toBe("application/json");
    expect(JSON.parse(bytes.toString("utf8"))).toEqual([
      { name: "Ada", city: "London" },
      { name: "Grace", city: "New York" },
    ]);
  });

  it("converts JSON to CSV", async () => {
    harness = await createHarness();
    const json = Buffer.from(JSON.stringify([{ name: "Ada", age: 36 }, { name: "Grace", age: 40 }]));
    const { info, bytes } = await run("json-to-csv", [file("people.json", json, "application/json")]);
    expect(info.mimeType).toBe("text/csv");
    const text = bytes.toString("utf8");
    expect(text).toContain('"name"');
    expect(text).toContain('"Ada"');
  });

  it("formats JSON", async () => {
    harness = await createHarness();
    const json = Buffer.from('{"a":1,"b":[2,3]}');
    const { bytes } = await run(
      "json-format",
      [file("data.json", json, "application/json")],
      { mode: "pretty" },
    );
    expect(bytes.toString("utf8")).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it("previews a CSV table", async () => {
    harness = await createHarness();
    const csv = Buffer.from(
      "name,city\nAda,London\nGrace,New York\nAlan,Manchester\nEdsger,Rotterdam\nBarbara,Philadelphia\n",
    );
    const { job, bytes } = await run(
      "table-preview",
      [file("people.csv", csv, "text/csv")],
      { delimiter: ",", maxRows: 5 },
    );
    const preview = JSON.parse(bytes.toString("utf8"));
    expect(preview.totalRows).toBe(5);
    expect(preview.rows).toHaveLength(5);
    expect(job.result.summary.totalRows).toBe(5);
  });
});

describe("text operations", () => {
  it("cleans text", async () => {
    harness = await createHarness();
    const input = Buffer.from("  Hello   world  \n\n\n <b>Second</b>   line \n");
    const { bytes } = await run(
      "text-cleaner",
      [file("messy.txt", input, "text/plain")],
      { trimLines: true, collapseSpaces: true, removeBlankLines: true, stripHtml: true },
    );
    expect(bytes.toString("utf8")).toBe("Hello world\nSecond line");
  });

  it("counts text", async () => {
    harness = await createHarness();
    const { job } = await run("text-counter", [
      file("notes.txt", Buffer.from("One two three.\nFour five."), "text/plain"),
    ]);
    expect(job.result.summary.words).toBe(5);
    expect(job.result.summary.sentences).toBe(2);
  });
});
