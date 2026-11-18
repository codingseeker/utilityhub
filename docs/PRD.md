> **Superseded (2026-11-18).** This document describes the pre-GCP
> architecture (MySQL, Prisma, local disk, and/or WordPress identity). It is kept
> for traceability. See [docs/README.md](./README.md) for the current set.

# UtilityHub — Product Requirements Document

Version: 1.0
Date: 2026-11-17
Status: Ready for owner review; architecture derived from this version
Source of truth: this document for product behavior; `docs/ARCHITECTURE.md` for implementation structure.

## 1. Product overview

UtilityHub is a local, web-based document-processing platform. A user uploads one or more files, selects an operation, configures it, submits a job, watches processing status, and downloads the result. Processing runs asynchronously in a separate worker so the API stays responsive.

The MVP is PDF-first and contains exactly six tools:

1. Merge PDF
2. Split PDF
3. Compress PDF
4. Rotate PDF
5. Images to PDF
6. PDF to Images

The MVP is guest-first. A user does not need an account to process documents. Files are temporary and are deleted automatically under a documented retention policy.

## 2. Problem statement

Everyday document tasks require either desktop software, multiple unrelated web tools, or accounts on services that retain files indefinitely. UtilityHub provides a single, focused workflow for common PDF operations with clear validation, visible processing state, real outputs, and predictable deletion.

Success means a first-time guest can complete upload → configure → process → download without instructions, while the system prevents invalid files, unauthorized downloads, duplicate processing, and indefinite retention.

## 3. Target users

| User | Primary need | Constraints |
| --- | --- | --- |
| Office worker | Combine reports, extract pages, shrink attachments | Occasional use, no installation, mixed file sizes |
| Student | Merge assignments, convert images to a single PDF | Small files, mobile and desktop |
| Small-business operator | Rotate and compress invoices or scans | Privacy-sensitive content, no account wanted |
| Developer or operator | Run and verify the platform locally | Needs reproducible setup and clear logs |

Primary devices: desktop browsers at 1280 px and wider; secondary: mobile browsers at 360 px and wider. Supported browsers: current Chrome, Firefox, Edge, and Safari.

## 4. Core user journeys

### 4.1 Guest single-file journey

1. Open the homepage and select a tool.
2. Add one valid file by drag-and-drop or file picker.
3. Review the detected file name, size, and page count.
4. Set options for the operation.
5. Submit the job.
6. Observe `Queued` and `Processing` states.
7. On completion, download the artifact or start another operation.
8. The input and output disappear after the retention period.

### 4.2 Guest multi-file journey

1. Select Merge PDF or Images to PDF.
2. Add up to 20 files.
3. Reorder files; the displayed order is the processing order.
4. Remove unwanted files.
5. Submit and download the single generated artifact.

### 4.3 Failure journey

1. A user uploads an invalid, oversized, encrypted, or corrupted file.
2. The upload or job creation is rejected with a specific, human-readable error.
3. No job is created for upload failures; a failed job is recorded for processing failures.
4. The user can retry with a corrected file without reloading the page.
5. Partial uploads are removed automatically.

### 4.4 Expiry journey

1. A user leaves a completed job open beyond the output retention period.
2. Polling returns an expired state.
3. The download control is replaced with an expiry message.
4. The artifact is no longer downloadable and is removed from storage.

### 4.5 Future authenticated journey

Identity may later be supplied by WordPress. The guest journey remains fully functional when WordPress is absent. Authenticated jobs are associated with an external identity; no second password system is built in the MVP.

## 5. MVP feature specifications

Shared limits apply to all tools unless an operation states otherwise:

| Limit | Value | Configurable |
| --- | --- | --- |
| Maximum size per file | 25 MB | Yes |
| Maximum files per upload request | 20 | Yes |
| Maximum total upload request size | 100 MB | Yes |
| Maximum total input size per job | 150 MB | Yes |
| Maximum PDF pages accepted at upload | 500 | Yes |
| Input retention | 60 minutes after upload | Yes |
| Output and failed-job retention | 60 minutes after terminal state | Yes |
| Job metadata retention after expiry | 24 hours | Yes |
| Cleanup interval | 5 minutes | Yes |
| Worker concurrency | 2 jobs | Yes |
| PDF to Images page limit | 100 pages per job | Yes |
| Split parts | 20 parts per job | Yes |

Accepted input formats are PDF, JPEG, PNG, WebP, and TIFF. Formats are determined from file signatures, not file extensions or client MIME types. SVG, GIF, HEIC, encrypted PDFs, and password-protected documents are rejected in the MVP.

### 5.1 Merge PDF (`merge-pdf`)

| Attribute | Specification |
| --- | --- |
| Purpose | Combine multiple PDFs into one PDF in user-selected order |
| Input | 2–20 PDF files |
| Options | None; input order is the page order |
| Processing | Validate every PDF, copy all pages sequentially into a new PDF, preserve page dimensions and content |
| Output | One PDF named `merged.pdf` |
| Validation | 2–20 inputs; all must be readable, unencrypted PDFs; total pages after merge ≤ 2,000; total input ≤ 150 MB |
| Failure scenarios | Fewer than 2 files, more than 20, encrypted input, corrupted input, page-limit exceeded, timeout |
| Result metadata | Input count, output page count, output size |

Acceptance behavior: merging PDFs with 1, 2, and 3 pages in that order produces a 6-page PDF whose page order matches the inputs.

### 5.2 Split PDF (`split-pdf`)

| Attribute | Specification |
| --- | --- |
| Purpose | Extract page ranges into one or more PDFs |
| Input | Exactly 1 PDF |
| Options | `mode: "ranges"` with `ranges: string[]` such as `["1-3","5","8-10"]`, or `mode: "every"` with `pagesPerFile: 1–100` |
| Processing | Parse 1-based ranges, validate against page count, produce one PDF per range or per chunk in user order |
| Output | A single PDF when one part results; otherwise a ZIP containing `part-01.pdf`, `part-02.pdf`, … |
| Validation | Page numbers within 1..pageCount; start ≤ end; at least one range; at most 20 parts; `pagesPerFile` present only in `every` mode |
| Failure scenarios | Invalid syntax, out-of-range page, empty selection, too many parts, encrypted or corrupted input |
| Result metadata | Part count, total pages emitted, artifact name |

Acceptance behavior: splitting pages 1–3 and 5 of a 5-page PDF produces two valid PDFs in a ZIP; an out-of-range request is rejected before a job is queued.

### 5.3 Compress PDF (`compress-pdf`)

| Attribute | Specification |
| --- | --- |
| Purpose | Reduce PDF size while keeping the document readable |
| Input | Exactly 1 PDF |
| Options | `preset: "low" \| "medium" \| "high"`; default `medium`; low = strongest size reduction, high = best quality |
| Processing | Ghostscript PDF writer with preset-specific settings; input file is never modified |
| Output | One PDF named `<basename>-compressed.pdf` |
| Validation | Readable, unencrypted PDF; input size within limits |
| Failure scenarios | Ghostscript failure, timeout, unreadable input, output missing or zero bytes |
| Result metadata | Preset, original size, output size, reduction bytes and percent, `applied` boolean |

If compression does not reduce size, the service returns the original bytes as the output, sets `applied: false`, and reports `No size reduction was achieved` with the actual sizes. It must not claim a reduction that did not occur. A success response with a valid PDF is always preferable to a fabricated or empty result.

Acceptance behavior: a text-heavy sample PDF is compressed with `medium`; output opens, page count is unchanged, and reported sizes match the filesystem.

### 5.4 Rotate PDF (`rotate-pdf`)

| Attribute | Specification |
| --- | --- |
| Purpose | Rotate all or selected pages by a right-angle amount |
| Input | Exactly 1 PDF |
| Options | `angle: 90 \| 180 \| 270`; `pages: "all"` or a range string such as `"1-3,5"`; default `all` |
| Processing | Add the angle to each selected page's existing rotation, normalized to 0–359 degrees; other pages are unchanged |
| Output | One PDF named `<basename>-rotated.pdf` |
| Validation | Allowed angles only; ranges valid and non-empty; page count within limits |
| Failure scenarios | Invalid angle, invalid range, out-of-range page, encrypted or corrupted input, timeout |
| Result metadata | Angle, number of pages rotated, output page count |

Acceptance behavior: rotating pages 2–3 by 90 degrees leaves page 1 unchanged, and the page rotation values are persisted in the output PDF.

### 5.5 Images to PDF (`images-to-pdf`)

| Attribute | Specification |
| --- | --- |
| Purpose | Create a PDF in which each selected image is one page |
| Input | 1–20 images: JPEG, PNG, WebP, or TIFF |
| Options | `pageSize: "fit" \| "a4" \| "letter"` (default `fit`); `orientation: "auto" \| "portrait" \| "landscape"` (default `auto`); `margin: 0–50` points (default `0`) |
| Processing | Decode with Sharp, apply EXIF orientation, flatten transparency onto white, normalize to JPEG at quality 90, constrain the longest side to 4,000 px without enlargement, embed sequentially |
| Output | One PDF named `images.pdf` |
| Validation | 1–20 images; signature and decodability check; at most 40 megapixels per image; margin integer within range; `margin` must be 0 for `fit` |
| Failure scenarios | Unsupported or corrupt image, animated or vector input, image limit exceeded, decode failure, timeout |
| Result metadata | Image count, output page count, output size |

Page sizing rules:

- `fit`: each page equals the normalized image size converted at 72 points per 96 pixels, so the image fills the page without margins.
- `a4` and `letter`: fixed page size; image is scaled to fit inside the page minus margins and centered; orientation `auto` follows the image aspect ratio, otherwise the requested orientation is enforced.

Acceptance behavior: three images of different formats produce a 3-page PDF in the selected order, and a corrupt image is rejected before queueing.

### 5.6 PDF to Images (`pdf-to-images`)

| Attribute | Specification |
| --- | --- |
| Purpose | Render PDF pages as PNG or JPEG images |
| Input | Exactly 1 PDF |
| Options | `format: "png" \| "jpeg"` (default `png`); `dpi: 72–200` (default `150`); `pages: "all"` or a range string (default `all`) |
| Processing | Validate page selection, render with Poppler `pdftoppm` using the resolution limit, name outputs `page-01.png` … in page order |
| Output | A single image when one page is selected; otherwise a ZIP named `pages.zip` |
| Validation | Page count ≤ 100 for this operation; requested pages within range; `dpi` integer in range; rasterized pixel budget per page ≤ 50 megapixels |
| Failure scenarios | Too many pages, invalid range, unsupported/encrypted PDF, renderer failure, timeout, zero rendered pages |
| Result metadata | Format, DPI, page count rendered, artifact name |

Acceptance behavior: a 3-page PDF renders to three valid images inside a ZIP; a 101-page PDF is rejected before queueing; a 200 DPI render of an A4 page is within the configured pixel budget.

### 5.7 Operation catalog endpoint

The frontend must obtain tool names, input rules, options, defaults, and limits from the backend rather than inventing capabilities. The catalog must list only implemented operations. If an operation is disabled by configuration, it must not appear as usable.

## 6. Guest-user behavior

- No registration, email, or account is required.
- Each upload returns a per-file upload capability token, valid until that upload expires; each job returns a job capability token.
- The client stores tokens in memory or `sessionStorage`; tokens are sent in request bodies or the `Authorization: Bearer` header, never in URLs.
- A guest can create, view, download, and delete their completed or failed jobs while tokens and retention are valid.
- Possession of a job token grants access. Tokens are 256-bit random values and only hashes are stored.
- Guest limits are enforced per IP through rate limits and per job through size/page limits.
- Guest documents receive the same retention and deletion as authenticated documents.
- Losing the job token means losing access; there is no recovery for guests. This must be stated in the UI.
- No public listing of jobs or files exists.

## 7. Optional accounts and WordPress integration

Accounts are out of MVP scope. The architecture reserves an `ownerType`/`ownerRef` association for a future external identity.

When WordPress integration is implemented:

- WordPress remains the identity provider and account store.
- The Node.js backend verifies a signed, short-lived identity token; it does not read WordPress tables or manage WordPress sessions.
- Identity failure must not degrade guest processing.
- Authenticated jobs are visible only to the matching external identity, in addition to the job token.
- No second local password system is introduced.

## 8. File retention and deletion

| Data | Retention | Trigger |
| --- | --- | --- |
| Uploaded input | 60 minutes after upload | Expiry, or earlier job completion does not extend it |
| Completed output | 60 minutes after completion | Expiry |
| Failed job files | 60 minutes after failure | Expiry |
| Temporary work directories | Deleted at the end of every attempt, success or failure; orphan sweep after 24 hours | Attempt completion or sweep |
| Expired job metadata | 24 hours after expiry | Cleanup purge |
| Active job inputs | Never deleted while the job is queued or processing | Guarded by job state |

Deletion behavior:

- Files are removed from the filesystem, then their database rows are marked `DELETED`; job rows remain until metadata retention expires.
- Downloads after expiry return `410 JOB_EXPIRED`.
- Cleanup runs every 5 minutes and at worker startup.
- Orphaned files older than 24 hours and unreferenced output directories are removed by reconciliation.
- Cleanup failures are logged and retried; they do not crash the worker.

## 9. Error messages and job-status behavior

User-facing errors are specific and actionable. They never include filesystem paths, SQL, stack traces, tokens, or engine command lines.

Representative messages:

| Code | User-facing message | HTTP |
| --- | --- | --- |
| `NO_FILE` | Add at least one file. | 400 |
| `TOO_MANY_FILES` | You can add at most 20 files per upload. | 400 |
| `FILE_TOO_LARGE` | This file is larger than 25 MB. | 413 |
| `UNSUPPORTED_FILE_TYPE` | This file type is not supported. Use PDF, JPG, PNG, WebP, or TIFF. | 415 |
| `INVALID_FILE_SIGNATURE` | The file content does not match its type. | 422 |
| `ENCRYPTED_PDF` | Password-protected PDFs are not supported. | 422 |
| `PDF_CORRUPTED` | This PDF cannot be read. | 422 |
| `INVALID_PAGE_RANGE` | Enter page numbers within 1 to N. | 422 |
| `INVALID_OPTIONS` | Check the selected options and try again. | 422 |
| `JOB_NOT_READY` | The result is still being prepared. | 409 |
| `JOB_EXPIRED` | This result has expired. Upload the file again to continue. | 410 |
| `UNAUTHORIZED` | This job cannot be accessed. | 404 |
| `RATE_LIMITED` | Too many requests. Try again shortly. | 429 |
| `PROCESSING_FAILED` | The document could not be processed. | 200 with `FAILED` status |
| `STORAGE_UNAVAILABLE` | Processing is temporarily unavailable. Try again later. | 503 for API requests; can also terminate a job as `FAILED` |

Job statuses:

| Status | Meaning | Allowed transitions |
| --- | --- | --- |
| `QUEUED` | Persisted and waiting for a worker | `PROCESSING` |
| `PROCESSING` | Claimed by exactly one worker | `COMPLETED`, `FAILED`, `QUEUED` after lease expiry |
| `COMPLETED` | Output stored and downloadable | `EXPIRED` |
| `FAILED` | Terminal processing or validation failure | `EXPIRED` |
| `EXPIRED` | Retention elapsed; files removed | Terminal |

The status API reports `error.code` and `error.message` for failures. Internal error details go only to server logs. Polling must not return different authorization results for job existence and token mismatch; both return 404.

## 10. Functional requirements

| ID | Requirement |
| --- | --- |
| FR-01 | The homepage lists exactly the six implemented tools with a short description. |
| FR-02 | Each tool page accepts files by picker and drag-and-drop. |
| FR-03 | The client displays detected type, sanitized name, size, and page count where available. |
| FR-04 | Merge PDF and Images to PDF support removing and reordering files; processing reflects displayed order. |
| FR-05 | The client renders operation-specific options from the catalog and validates them before submission. |
| FR-06 | Uploads show per-request progress; uploads are streamed to disk by the backend. |
| FR-07 | The client creates a job only after uploads succeed and displays the job token’s owner session. |
| FR-08 | The client polls job status at 1-second intervals until terminal state or page unload. |
| FR-09 | The client displays queued, processing, completed, failed, and expired states distinctly. |
| FR-10 | A completed job exposes a download that streams the real artifact. |
| FR-11 | Errors are shown in the tool page with a retry path and without technical details. |
| FR-12 | The backend exposes a catalog of supported operations and their option schemas. |
| FR-13 | The backend rejects invalid extensions, MIME types, signatures, sizes, counts, and page limits. |
| FR-14 | The backend records job status, timestamps, attempts, sanitized errors, and output metadata. |
| FR-15 | Exactly one worker processes a job at a time, and abandoned jobs are recovered. |
| FR-16 | Downloads require a valid job token and are denied after expiry. |
| FR-17 | Inputs, outputs, and work directories are deleted under the retention policy. |
| FR-18 | The API remains responsive while processing runs; no heavy work executes in the API process. |
| FR-19 | The frontend and backend work on mobile and desktop layouts. |
| FR-20 | The system rejects password-protected PDFs and does not attempt circumvention. |
| FR-21 | The system never exposes filesystem paths or storage keys in responses. |
| FR-22 | The workflow supports guest use end to end without WordPress. |

## 11. Non-functional requirements

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-01 | API p95 latency ≤ 300 ms for catalog, status, and error responses under 10 concurrent clients, excluding upload and download bytes | Load script with 10 clients |
| NFR-02 | A queued job is claimed within 5 seconds under normal operation | Timestamp comparison in integration test |
| NFR-03 | Worker concurrency never exceeds 2 jobs by default | Concurrent job test with 5 jobs |
| NFR-04 | Each operation respects its timeout: merge/split 120 s, compress/images-to-pdf 180 s, rotate 90 s, pdf-to-images 300 s | Forced timeout test |
| NFR-05 | A worker killed during processing leaves no job stuck in `PROCESSING` beyond lease plus recovery interval | Kill and restart test |
| NFR-06 | A process restart does not lose queued jobs | Restart test |
| NFR-07 | Cleanup removes expired files within 10 minutes of expiry | Timestamped cleanup test |
| NFR-08 | Logs never contain document bytes, extracted text, file contents, job tokens, or upload tokens | Log inspection test |
| NFR-09 | The UI is usable from 360 px to 1920 px width | Manual and automated viewport checks |
| NFR-10 | The system runs on the audited host with ≤ 4 GB memory for MySQL, API, and worker combined at idle | `docker stats` observation |
| NFR-11 | Disk usage is bounded by retention plus a 2 GB free-space reserve; processing refuses to start below the reserve | Storage guard test |
| NFR-12 | All timestamps are stored and displayed in UTC and rendered in local time by the browser | Database and UI inspection |
| NFR-13 | No shell is used for external commands; argument arrays only | Code review and adversarial filename test |
| NFR-14 | Duplicate submissions do not create duplicate output artifacts for the same job | Concurrent claim and retry test |

## 12. Security and privacy requirements

| ID | Requirement |
| --- | --- |
| SR-01 | Never trust client filenames, extensions, or MIME types; detect type from bytes. |
| SR-02 | Store files under generated names outside any public directory. |
| SR-03 | Prevent path traversal through canonical path containment checks. |
| SR-04 | Issue 256-bit capability tokens; store only SHA-256 hashes. |
| SR-05 | Authorize every job status, download, and delete request. |
| SR-06 | Use `0600` files and `0700` directories; set process `umask(0o077)`. |
| SR-07 | Enforce request, file, count, page, pixel, and timeout limits. |
| SR-08 | Rate-limit uploads, job creation, downloads, and global traffic. |
| SR-09 | Return sanitized errors and generic 404 responses for unauthorized job identifiers. |
| SR-10 | Do not log document content or secrets; redact authorization headers. |
| SR-11 | Reject encrypted PDFs rather than attempting password bypass. |
| SR-12 | Do not send files to any external service. |
| SR-13 | Do not retain documents beyond the retention policy. |
| SR-14 | Validate CORS against an explicit origin allowlist and set security headers. |
| SR-15 | Handle malformed, truncated, and adversarial files without crashing the API or worker. |

## 13. Constraints

- Local-only development and operation; no deployment, cloud infrastructure, or external processing.
- No microservices, Kafka, RabbitMQ, Redis, or Kubernetes.
- Node.js 22, Express, Prisma, MySQL 8.4, React, Vite.
- Separate API and worker processes sharing one database and storage volume.
- Local filesystem storage; database stores metadata only.
- Six tools only; no additional document tools in the MVP.
- WordPress integration deferred; guest processing is mandatory.
- Host resources: 12 CPU, 15 GiB RAM, 60 GB free disk.
- Code must be readable and maintainable; explanatory comments are omitted unless behavior is non-obvious, and the project owner has requested no comments in frontend or backend code.

## 14. Out of scope for the MVP

- Word, Excel, PowerPoint conversion in either direction.
- OCR, text extraction, image extraction, watermarking, page numbering, redaction, protection, organization, or page removal tools.
- Image compression, resizing, or conversion as standalone tools.
- User registration, local accounts, passwords, email verification, or profiles.
- Payment, quotas, subscriptions, or billing.
- WordPress plugin or live identity integration.
- Sharing links, collaboration, job history, or a dashboard.
- Email delivery or notifications.
- Cloud storage, S3, CDN, or external processors.
- PDF password recovery or decryption.
- Mobile native apps.
- Internationalization beyond English.
- Accessibility certification beyond semantic HTML and keyboard-operable controls.

## 15. Measurable MVP acceptance criteria

The MVP is accepted only when all of the following are verified with real files:

1. A guest can complete upload → create job → status → download for all six tools through the frontend.
2. Merge produces a valid PDF with the expected page count and order for a 3-file ordered input.
3. Split produces correct parts for `ranges` and `every` modes and rejects an out-of-range selection before queueing.
4. Compress produces a valid PDF, preserves page count, and reports actual input/output sizes; no-reduction cases are labeled honestly.
5. Rotate changes only the selected pages and rejects unlisted angles.
6. Images to PDF produces one page per image in the selected order from mixed JPEG/PNG/WebP/TIFF inputs.
7. PDF to Images produces the selected pages in the chosen format and DPI; the 100-page and pixel limits are enforced.
8. Invalid extension, MIME type, signature, oversized file, too many files, encrypted PDF, and corrupt PDF are each rejected with the documented error.
9. A second client without the job token receives 404 for status and download.
10. A completed job cannot be downloaded after expiry and its files are gone from storage after cleanup.
11. Two workers cannot claim the same job; a worker killed mid-job is recovered and the job reaches a terminal state.
12. API health endpoints report database and storage readiness; the frontend and worker start from documented commands.
13. Logs contain request IDs and job IDs but no tokens, filenames as content, or document content.
14. Mobile (360 px) and desktop (1440 px) layouts support the full workflow.
15. The test report lists actual passing and failing tests and known limitations; no critical workflow is claimed as verified without execution.

## 16. Future roadmap

| Horizon | Capability |
| --- | --- |
| Next | Office conversion, PDF to Office, JPG/PDF conversion, Remove/Extract/Organize pages, page numbers, watermarks |
| Later | OCR, text and image extraction, protection, standalone image tools |
| Identity | WordPress single sign-on, authenticated job ownership, optional retention extension |
| Infrastructure | S3-compatible storage adapter, optional Redis-backed rate limiting if the API scales horizontally |
| Product | Share links, batch processing, usage quotas, audit history |

Future tools must fit the operation registry and storage abstraction. They must not require redesigning the job engine or upload pipeline.
