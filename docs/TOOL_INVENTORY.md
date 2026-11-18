# UtilityHub — Tool Inventory

Date: 2026-11-18
Purpose: enumerate every existing tool, its reusable logic, and its GCP migration target.

## 1. Existing tools (pre-refactor)

| # | Tool ID | Category | Inputs | Options | Output | Reusable engine code | Known limits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `merge-pdf` | PDF | 2–20 PDFs | order | PDF | `operations/merge-pdf.js` | 500 pages/PDF, 2,000 merged pages, 150 MB/job |
| 2 | `split-pdf` | PDF | 1 PDF | ranges or every N pages | PDF or ZIP | `operations/split-pdf.js` | 20 parts max |
| 3 | `compress-pdf` | PDF | 1 PDF | `low`/`medium`/`high` | PDF | `operations/compress-pdf.js` | 180 s timeout; falls back to original if no reduction |
| 4 | `rotate-pdf` | PDF | 1 PDF | 90/180/270, page range | PDF | `operations/rotate-pdf.js` | 90 s timeout |
| 5 | `images-to-pdf` | Photo/PDF | 1–20 JPEG/PNG/WebP/TIFF | page size, orientation, margin | PDF | `operations/images-to-pdf.js` | 40 MP/image |
| 6 | `pdf-to-images` | PDF/Photo | 1 PDF | PNG/JPEG, 72–200 DPI, range | Image or ZIP | `operations/pdf-to-images.js` | 100 pages, 50 MP/page, 300 s |

All six are real implementations and are retained in the GCP worker.

## 2. Required additions (new brief)

### 2.1 Photo

| Tool ID | Name | Inputs | Options | Output | Implementation |
| --- | --- | --- | --- | --- | --- |
| `image-convert` | Image Converter | 1 JPEG/PNG/WebP | target `png`/`jpeg`/`webp`, quality | Image | Sharp transcode, EXIF-orientation normalised |
| `image-compress` | Image Compressor | 1 JPEG/PNG/WebP | quality 40–95, max width 640–4096 | Image | Sharp resize + re-encode; honest no-reduction report |
| `color-picker` | Color Picker | 1 JPEG/PNG/WebP | palette size 3–8 | JSON palette + swatches | Sharp downscale + deterministic quantisation |

### 2.2 Data

| Tool ID | Name | Inputs | Options | Output | Implementation |
| --- | --- | --- | --- | --- | --- |
| `csv-to-json` | CSV → JSON | 1 `.csv` | delimiter `,`/`;`/`\t` | JSON | PapaParse with header row, 20k row cap |
| `json-to-csv` | JSON → CSV | 1 `.json` | — | CSV | PapaParse unparse; array-of-objects required |
| `json-format` | JSON Formatter | 1 `.json` | pretty/minify | JSON | `JSON.parse` + `JSON.stringify` |
| `table-preview` | Table Preview | 1 `.csv` | delimiter | JSON preview + table UI | PapaParse, first 50 rows |

### 2.3 Text

| Tool ID | Name | Inputs | Options | Output | Implementation |
| --- | --- | --- | --- | --- | --- |
| `text-case` | Case Changer | 1 `.txt`/`.md` or pasted text | upper/lower/title/sentence | Text | Unicode-aware transform |
| `text-counter` | Word Counter | 1 text input | — | JSON counts | chars, words, lines, sentences, paragraphs |
| `text-cleaner` | Text Cleaner | 1 text input | trim lines, collapse spaces, remove blank lines, strip HTML | Text | Deterministic transforms |

### 2.4 Utilities (client-side, no job)

| Tool ID | Name | Runtime | Notes |
| --- | --- | --- | --- |
| `unit-converter` | Unit Converter | Browser | Length, mass, temperature, data size. Instant, no upload. |
| `percentage-calculator` | Percentage Calculator | Browser | Percent-of, change, increase/decrease. Instant, no upload. |

Client-side utilities are explicitly labelled **INSTANT** rather than **CLOUD** so the UI never implies a server job where none exists.

## 3. Reusable server-side logic

| Module | Reuse in GCP worker | Change required |
| --- | --- | --- |
| `utils/pages.js` | Page ranges, chunks | None |
| `utils/pdfinfo.js` | PDF inspection/verification | None |
| `utils/process.js` | Safe subprocess execution | None |
| `utils/filenames.js` | Display names, base names | None |
| `processing/pdf-helpers.js` | Load/save PDF | None |
| `processing/zip.js` | ZIP outputs | None |
| `processing/artifact.js` | Artifact verification | Accept file path from tmp |
| `processing/operations/*` | All six PDF operations | Input paths now come from GCS downloads |
| `processing/engine.js` | Ghostscript/Poppler wrapper | None |

Not reusable: Prisma schema, MySQL claim queries, local storage adapter, multer upload path, capability-token auth, WordPress identity.

## 4. Migration matrix

| Existing capability | GCP target | Status after refactor |
| --- | --- | --- |
| Multipart upload to API | Signed PUT to GCS | Replaced |
| Local disk storage | GCS with lifecycle delete | Replaced |
| MySQL job queue | Firestore + Cloud Run worker trigger | Replaced |
| Guest job tokens | Firebase UID ownership | Replaced |
| WordPress HMAC identity | Firebase Authentication | Retired |
| In-process rate limits | API limiters + per-user Firestore quota | Replaced |
| Manual cleanup worker | GCS lifecycle + metadata TTL job | Replaced |
| Six PDF tools | Six worker operations | Preserved |
| — | Nine new photo/data/text operations | Added |
| — | Two client utilities | Added |

## 5. Tool acceptance tests

Each server tool must complete: signed upload → job queued → worker processing → result in GCS → signed download. Tests use real files or generated fixtures. Client tools must compute the documented result in-browser.

| Tool | Test fixture | Verified assertion |
| --- | --- | --- |
| merge-pdf | 2 generated PDFs | page count equals sum, output parses |
| split-pdf | 3-page PDF | one ZIP/PDF with requested ranges |
| compress-pdf | generated PDF | valid PDF, page count preserved |
| rotate-pdf | generated PDF | rotation angles applied |
| images-to-pdf | generated PNG/JPEG | page count equals image count |
| pdf-to-images | 2-page PDF | PNG/JPEG or ZIP produced |
| image-convert | PNG | target format returned |
| image-compress | large JPEG | output decodes, size reported |
| color-picker | solid-colour PNG | dominant hex matches |
| csv-to-json | CSV | parsed rows match |
| json-to-csv | JSON array | header + rows match |
| json-format | minified JSON | pretty output parses |
| table-preview | CSV | headers/row count correct |
| text-case | text | expected casing |
| text-counter | text | counts correct |
| text-cleaner | messy text | expected cleaned output |
| unit-converter | browser | conversion values correct |
| percentage-calculator | browser | arithmetic correct |
