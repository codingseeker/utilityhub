#!/usr/bin/env node
/**
 * Local Office verification.
 *
 * Run with: npm run verify:local-office
 *
 * It builds 5 MB DOCX and PPTX inputs, exercises every local operation, opens
 * the generated artifacts again, and fails if any fetch happens. The Office
 * libraries use Node's File/Blob globals here; the browser uses the same code.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import {
  FileServiceRouter,
} from "../src/services/FileServiceRouter.js";
import { LocalFileAdapter } from "../src/services/LocalFileAdapter.js";
import {
  OFFICE_TO_PDF_MESSAGE,
} from "../src/services/fileTypes.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const FIVE_MB = 5 * 1024 * 1024;

let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("Network access is forbidden in the local Office test.");
};

function makeFile(bytes, name, type) {
  return new File([bytes], name, { type });
}

async function inflateOfficePackage(blob, paddingPath, label) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  zip.file(paddingPath, randomBytes(FIVE_MB));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  assert.ok(
    bytes.byteLength >= FIVE_MB,
    `${label} should be at least 5 MB, got ${bytes.byteLength} bytes`,
  );
  return makeFile(bytes, label === "DOCX" ? "large.docx" : "large.pptx", label === "DOCX" ? DOCX_MIME : PPTX_MIME);
}

async function main() {
  // 1. TXT -> DOCX, then inflate to a 5 MB Word file.
  const baseDocx = await LocalFileAdapter.process({
    operationId: "txt-to-docx",
    files: [makeFile("Quarterly report\nRevenue is up\nLocal only", "report.txt", "text/plain")],
  });
  assert.equal(baseDocx.blob.type, DOCX_MIME);
  const docxZip = await JSZip.loadAsync(await baseDocx.blob.arrayBuffer());
  assert.ok(docxZip.file("word/document.xml"), "generated DOCX must contain word/document.xml");

  const largeDocx = await inflateOfficePackage(baseDocx.blob, "word/media/padding.bin", "DOCX");
  console.log(`[ok] generated a ${(largeDocx.size / 1024 / 1024).toFixed(2)} MB DOCX`);

  const docxRoute = FileServiceRouter.route({
    operationId: "docx-to-txt",
    files: [largeDocx],
  });
  assert.equal(docxRoute.runtime, "local");
  assert.equal(docxRoute.reason, "office-file");

  const docxText = await LocalFileAdapter.process({
    operationId: "docx-to-txt",
    files: [largeDocx],
  });
  const extractedDocx = await docxText.blob.text();
  assert.match(extractedDocx, /Quarterly report/);
  assert.match(extractedDocx, /Local only/);
  assert.equal(docxText.blob.type, "text/plain;charset=utf-8");
  console.log(`[ok] DOCX -> TXT extracted ${docxText.summary.words} words from 5 MB input`);

  // 2. TXT -> PPTX, then inflate to a 5 MB presentation.
  const basePptx = await LocalFileAdapter.process({
    operationId: "txt-to-pptx",
    files: [makeFile("Opening slide\nSecond slide\nThird slide", "deck.txt", "text/plain")],
  });
  assert.equal(basePptx.blob.type, PPTX_MIME);
  const pptxZip = await JSZip.loadAsync(await basePptx.blob.arrayBuffer());
  assert.ok(pptxZip.file("ppt/presentation.xml"), "generated PPTX must contain ppt/presentation.xml");
  assert.ok(pptxZip.file("ppt/slides/slide1.xml"), "generated PPTX must contain slide1.xml");

  const largePptx = await inflateOfficePackage(basePptx.blob, "ppt/media/padding.bin", "PPTX");
  console.log(`[ok] generated a ${(largePptx.size / 1024 / 1024).toFixed(2)} MB PPTX`);

  const pptxRoute = FileServiceRouter.route({
    operationId: "pptx-to-txt",
    files: [largePptx],
  });
  assert.equal(pptxRoute.runtime, "local");
  assert.equal(pptxRoute.reason, "office-file");

  const pptxText = await LocalFileAdapter.process({
    operationId: "pptx-to-txt",
    files: [largePptx],
  });
  const extractedPptx = await pptxText.blob.text();
  assert.match(extractedPptx, /Opening slide/);
  assert.match(extractedPptx, /Third slide/);
  assert.equal(pptxText.summary.slides, 3);
  console.log(`[ok] PPTX -> TXT extracted ${pptxText.summary.slides} slides from 5 MB input`);

  // 3. Re-read the generated artifacts and prove they are not corrupt.
  const reopenedDocx = await LocalFileAdapter.process({
    operationId: "docx-to-txt",
    files: [makeFile(await baseDocx.blob.arrayBuffer(), baseDocx.fileName, DOCX_MIME)],
  });
  assert.match(await reopenedDocx.blob.text(), /Quarterly report/);

  const reopenedPptx = await LocalFileAdapter.process({
    operationId: "pptx-to-txt",
    files: [makeFile(await basePptx.blob.arrayBuffer(), basePptx.fileName, PPTX_MIME)],
  });
  assert.match(await reopenedPptx.blob.text(), /Opening slide/);
  console.log("[ok] generated DOCX and PPTX reopen without corruption");

  // 4. Office files are always routed local, and Office -> PDF is blocked.
  const pdfRoute = FileServiceRouter.route({
    operationId: "merge-pdf",
    files: [largeDocx],
  });
  assert.equal(pdfRoute.runtime, "local", "an Office file must never route to cloud");

  await assert.rejects(
    () => LocalFileAdapter.process({ operationId: "merge-pdf", files: [largeDocx] }),
    (error) => error.message === OFFICE_TO_PDF_MESSAGE && error.code === "OFFICE_PDF_UNSUPPORTED",
  );
  await assert.rejects(
    () => LocalFileAdapter.process({ operationId: "docx-to-pdf", files: [largeDocx] }),
    (error) => error.message === OFFICE_TO_PDF_MESSAGE,
  );
  assert.throws(
    () => FileServiceRouter.assertCloudSafe([largeDocx]),
    (error) => error.code === "LOCAL_ONLY_FILE" && /never uploaded/.test(error.message),
  );
  console.log("[ok] Office -> PDF is blocked and the cloud guard rejects Office files");

  // 5. No fetch or API client was touched at any point.
  assert.equal(networkCalls, 0, "local Office processing must not call fetch");
  console.log("[ok] zero network calls during all local Office operations");

  console.log("\nLocal Office verification passed.");
}

main().catch((error) => {
  console.error("\nLocal Office verification failed:");
  console.error(error);
  process.exitCode = 1;
});
