> **Superseded (2026-11-18).** This document describes the pre-GCP
> architecture (MySQL, Prisma, local disk, and/or WordPress identity). It is kept
> for traceability. See [docs/README.md](./README.md) for the current set.

# UtilityHub — Processing Pipeline

Version: 1.0
Date: 2026-11-17
Related: `docs/ARCHITECTURE.md`, `docs/API_SPECIFICATION.md`, `docs/SECURITY_DESIGN.md`

## 1. Pipeline stages

```text
UPLOAD -> VALIDATE -> STORE -> CREATE JOB -> QUEUE -> CLAIM -> PROCESS -> VALIDATE OUTPUT -> STORE OUTPUT -> COMPLETE -> DOWNLOAD -> EXPIRE -> CLEANUP
```

| Stage | Owner | Success output | Failure behavior |
| --- | --- | --- | --- |
| Upload | API | Streaming multipart parts on disk | Abort request, unlink all parts, structured 4xx |
| Validate | API | Detected type, pages, dimensions, hash | Unlink file, no metadata row, specific error |
| Store | API | Generated key, `0600` file, `File` row | Unlink, rollback uncommitted rows |
| Create job | API | `Job` + ordered `JobInput` rows, job token hash | No job row, 4xx with field details |
| Queue | Database | `QUEUED` row ordered by `queuedAt` | Retry insert on transient DB error |
| Claim | Worker | `PROCESSING`, lease, attempt increment | Idle poll or recovery |
| Process | Worker | Artifact candidate in work directory | Sanitized `FAILED` or retry |
| Validate output | Worker | Page count, MIME, nonzero size, readable | `OUTPUT_INVALID` failure |
| Store output | Worker | Output key and `File` row | Remove candidate, fail |
| Complete | Worker | `COMPLETED`, result JSON, expiry | Guarded update; rollback on lost lease |
| Download | API | Authorized stream | 404, 409, or 410 |
| Expire | Worker | `EXPIRED` status | Retry next sweep |
| Cleanup | Worker | Files unlinked, rows marked `DELETED` | Retry next sweep, log counts |

Every stage is idempotent where a retry is possible. No stage silently converts a failure into a success.

## 2. Upload and validation

### 2.1 Streaming intake

- Multer uses disk storage with a generated temporary name under the storage root.
- Each part passes through a size-limiting stream; exceeding 25 MB aborts that part.
- The request tracks cumulative bytes and rejects above 100 MB.
- File count above 20 aborts the request.
- Empty parts are rejected.
- The client-provided `filename`, extension, and MIME type are recorded only as untrusted hints; none are used for paths.

### 2.2 Signature detection

Read the first 4,100 bytes and detect by signature:

| Format | Signature | Allowed extension |
| --- | --- | --- |
| PDF | `%PDF-` within first 1,024 bytes | `.pdf` |
| JPEG | `FF D8 FF` | `.jpg`, `.jpeg` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` | `.png` |
| WebP | `RIFF....WEBP` | `.webp` |
| TIFF | `II 2A 00` or `MM 00 2A` | `.tif`, `.tiff` |

Reject when the extension disagrees with the signature, when the client MIME type is outside the operation allowlist, or when the signature is unknown. Declared MIME `application/octet-stream` is tolerated only if the signature is valid; the stored MIME type is always the detected one.

### 2.3 PDF inspection

`pdfinfo` runs with a 10-second timeout and a 1 MiB output cap. The API parses:

- `Pages:` for page count, required to be 1–500.
- `Encrypted:` for encryption, any value other than `no` is rejected.
- `Page size:` presence for structural sanity.

A non-zero exit, missing page count, or encryption yields `PDF_CORRUPTED` or `ENCRYPTED_PDF`. Password options (`-upw`, `-opw`) are never supplied.

### 2.4 Image inspection

Sharp reads metadata only:

- Format must be `jpeg`, `png`, `webp`, or `tiff`.
- Width and height must be positive and their product ≤ 40,000,000.
- Multi-page or animated images are rejected (`pages > 1`), including animated WebP and multi-page TIFF.
- TIFF with unsupported compression fails decode and is rejected.

### 2.5 Filename sanitization

The display name is derived as follows:

1. Take the basename only, removing any path components.
2. Remove control characters and Unicode bidirectional overrides.
3. Replace separators and reserved characters with spaces.
4. Collapse whitespace.
5. Trim leading dots, spaces, and trailing dots.
6. Truncate to 120 characters while preserving the extension.
7. Fall back to `document.pdf` or `image` when the result is empty.

Display names never influence storage keys, ZIP entry names, or shell arguments.

## 3. Job creation

The API validates, in order:

1. Operation exists and is enabled.
2. Body shape, input count, and option schema.
3. Every input file id resolves, its upload token hash matches, it is `STORED`, and it is unexpired.
4. All inputs share one owner type and owner reference.
5. Detected kinds and MIME types match the operation.
6. Total input bytes are within the operation and job limits.
7. Operation-specific page limits, part limits, and option constraints.

The transaction locks each input row, re-checks state and expiry, creates the job with `QUEUED`, inserts inputs with positions, and stores the job token hash. A failure rolls back everything. Inputs are not deleted or marked in use; their expiry continues to apply, but active-job protection prevents deletion before terminal state.

## 4. Claiming and execution

### 4.1 Worker loop

- On start, the worker recovers expired leases and cleans stale work directories.
- It claims up to `WORKER_CONCURRENCY` jobs (default 2).
- Idle polling is every 1 second when no job is claimable.
- A claim yields one job and its ordered inputs.
- Each job runs in an isolated `0750`-equivalent work directory owned by the worker user, with `0700` applied to the job root.
- Lease renewal runs every 15 seconds per active job.
- A job whose lease renewal fails is abandoned without further state writes.
- Graceful shutdown stops claiming, waits up to 30 seconds for active jobs, kills remaining children, and exits.

### 4.2 Engine launcher

All external processes use one wrapper with:

| Control | Value |
| --- | --- |
| Invocation | `spawn(binary, args, { shell: false, cwd: workDir, env: restrictedEnv })` |
| Environment | `PATH`, `LANG=C.UTF-8`, `TMPDIR=workDir`, `HOME=workDir` only |
| Standard streams | Pipes; stdout and stderr capped at 64 KiB each |
| Timeout | Per invocation, then `SIGTERM`, 2-second grace, `SIGKILL` |
| Concurrency | Bounded by worker concurrency and sequential engine calls per job |
| Working directory | Job-specific temporary directory |
| Input paths | Absolute paths inside the storage root, supplied as separate arguments |
| Output paths | Absolute paths inside the job work directory |

No command string is built from a filename, option, or user input. Arguments are fixed or validated enumerations and integers.

## 5. Operation pipelines

### 5.1 Merge PDF

1. Confirm 2–20 inputs and total pages ≤ 2,000.
2. Create a target PDF with pdf-lib.
3. For each input in order, load it, copy all pages with `copyPages`, append, then release the source document reference.
4. Save to `workDir/merged.pdf`.
5. Run `pdfinfo` on the output and require the page count to equal the sum of input pages.
6. Move the artifact to output storage and record it.

Failure mapping: unreadable input → `PROCESSING_FAILED` with a log detail of `PDF_LOAD_FAILED`; page limit → rejected at job creation; timeout → `PROCESSING_TIMEOUT`.

Memory is bounded by the target plus one loaded source at a time. Inputs remain unchanged.

### 5.2 Split PDF

1. Load the single PDF and read the page count.
2. Parse and validate options.
3. For `ranges` mode, preserve the user’s item order and create one part per item, allowing duplicates and overlaps.
4. For `every` mode, create chunks of `pagesPerFile`; the final chunk may be shorter.
5. Limit the result to 20 parts.
6. Copy pages into a new PDF per part, name them `part-01.pdf`, `part-02.pdf`, and so on.
7. Validate each part with pdf-lib page count and `pdfinfo` readability.
8. If exactly one part exists, move it as the artifact. Otherwise create `split.zip` with `archiver` using the fixed part names in order.
9. Store the artifact and summary.

ZIP entries are generated from controlled names, not user input. The ZIP is written to the work directory, validated as non-empty, and then moved atomically.

### 5.3 Compress PDF

1. Load and verify the input PDF and page count.
2. Select Ghostscript settings:

| Preset | Ghostscript setting | Intended tradeoff |
| --- | --- | --- |
| `low` | `/screen` | Smallest size, lowest image resolution |
| `medium` | `/ebook` | Balanced |
| `high` | `/printer` | Larger size, higher quality |

3. Run:

```text
gs
  -q
  -dNOPAUSE
  -dBATCH
  -dSAFER
  -sDEVICE=pdfwrite
  -dCompatibilityLevel=1.7
  -dPDFSETTINGS=/ebook
  -dAutoRotatePages=/None
  -sOutputFile=<workDir>/compressed.pdf
  <input.pdf>
```

4. Require exit code 0, a non-empty output, successful `pdfinfo`, and an unchanged page count.
5. Compare sizes:
   - Candidate smaller: artifact is the candidate, `applied: true`.
   - Candidate equal or larger: copy the original to `workDir/<basename>-compressed.pdf`, `applied: false`, and report the real sizes with a no-reduction message in the job summary.
6. Store the artifact and summary with both sizes and reduction.

Input files are never modified. Ghostscript runs with `-dSAFER` and a per-operation timeout.

### 5.4 Rotate PDF

1. Parse `pages`; `all` selects every page.
2. Load the PDF with pdf-lib.
3. For each selected page, read the current rotation, add the requested angle, normalize to 0–359, and set it with `setRotation(degrees(value))`.
4. Save the document.
5. Verify the output opens, the page count is unchanged, and each selected page’s rotation equals the expected normalized value.
6. Store the artifact and summary.

Unselected pages keep their original rotation. Existing rotated pages accumulate rather than reset.

### 5.5 Images to PDF

1. Confirm 1–20 images and option constraints.
2. For each image in order:
   - Decode with Sharp and read metadata.
   - Apply EXIF orientation with `rotate()`.
   - Flatten transparency onto white.
   - Resize to fit within 4,000 × 4,000 pixels without enlargement.
   - Encode as JPEG quality 90 into the work directory.
3. Create an A4, Letter, or fit-sized page per image.
   - `fit`: page width and height are `pixels × 72 / 96` points, with no margin.
   - `a4`: 595.28 × 841.89 points.
   - `letter`: 612 × 792 points.
   - `auto` orientation uses landscape when width > height; otherwise portrait.
   - Image is contained inside the page minus margin and centered.
4. Embed each JPEG sequentially and add one page per image.
5. Save, validate with `pdfinfo` that the page count equals the image count, and store.

Images are processed sequentially to bound memory. An invalid image fails the job before an artifact is stored.

### 5.6 PDF to Images

1. Confirm the PDF has at most 100 pages. Jobs above this limit are rejected at creation.
2. Parse `pages`; `all` selects every page.
3. For selected pages, compute expected pixels from page size in points and DPI. Reject any page above 50,000,000 pixels.
4. Render sequentially, one page per invocation, to avoid loading multiple page rasters:

```text
pdftoppm
  -q
  -r <dpi>
  -f <page>
  -l <page>
  -singlefile
  -png
  <input.pdf>
  <workDir>/page-01
```

For JPEG, replace `-png` with `-jpeg -jpegopt quality=85` and use a `.jpg` target.

5. Require a non-empty output per page and validate it with Sharp.
6. Rename to `page-01.png`, `page-02.png`, or the JPEG equivalent in selected order.
7. If one image results, move it as the artifact. Otherwise create `pages.zip` with the fixed names.
8. Store the artifact and summary.

Rendering one page at a time bounds memory regardless of document length. Overall and per-page timeouts apply. A zero-page render is a failure, never a success with an empty ZIP.

## 6. Output validation

Before an artifact is committed:

| Check | PDF | PNG/JPEG | ZIP |
| --- | --- | --- | --- |
| Exists and size > 0 | Required | Required | Required |
| Readable by expected parser | `pdfinfo` exit 0 | Sharp metadata | Central directory readable |
| Expected page count | Required | Not applicable | Not applicable |
| Expected MIME signature | `%PDF-` | PNG/JPEG signature | `PK\x03\x04` |
| Expected dimensions | Not applicable | Positive width and height | Not applicable |
| Entry count for archives | Not applicable | Not applicable | Equals produced files |

A failed output check produces `OUTPUT_INVALID`, removes the candidate, and fails the job.

## 7. Timeouts, retries, and concurrency

| Operation | Operation timeout | Typical engine cap |
| --- | --- | --- |
| Merge PDF | 120 s | pdf-lib work is in-process |
| Split PDF | 120 s | pdf-lib work is in-process |
| Compress PDF | 180 s | Ghostscript 180 s |
| Rotate PDF | 90 s | pdf-lib work is in-process |
| Images to PDF | 180 s | Sharp sequential, 30 s per image target |
| PDF to Images | 300 s | 60 s per page, 300 s total |

Rules:

- Operation timeout is enforced by the worker; external children are terminated.
- Job-level retries occur only through lease-expiry recovery. A lost lease may requeue once while attempts remain; `maxAttempts` is 2.
- Database deadlocks during a transition are retried up to three times before the operation is failed.
- A spawn failure with `EAGAIN` or `ETXTBSY` is retried once inside the launcher.
- Deterministic failures never retry: invalid input, unsupported file, encrypted PDF, invalid range, engine missing, output validation failure, and operation timeout.
- A retried attempt removes its work directory and any uncommitted output before starting.
- Worker concurrency never exceeds 2. Sharp is not parallelized across jobs beyond that bound.
- A storage free-space check below 2 GB prevents new processing and fails the job with `STORAGE_UNAVAILABLE`.

## 8. Completion and persistence

1. Write the artifact to a temporary name inside the job work directory.
2. Validate it.
3. Move it atomically into `outputs/<jobId>/<uuid>.<ext>`.
4. Insert the `File` row and update the job to `COMPLETED` in one transaction, guarded by `status = PROCESSING` and `leaseOwner`.
5. Store `result` with artifact name, MIME type, size, and operation summary, plus `expiresAt = completion + 60 minutes`.
6. If the transaction fails, remove the artifact and leave the job for recovery.
7. Remove the work directory in a `finally` block.

Status writing is guarded: a worker that lost its lease cannot mark a recovered job complete.

## 9. Failure handling

| Internal condition | Job error code | Retry | Public message |
| --- | --- | --- | --- |
| Input disappeared or expired after claim | `PROCESSING_FAILED` | No | The document could not be processed. |
| Invalid options missed at creation | `PROCESSING_FAILED` | No | The document could not be processed. |
| Ghostscript or Poppler exits non-zero | `PROCESSING_FAILED` | No | The document could not be processed. |
| Binary missing | `ENGINE_UNAVAILABLE` | No | A required processing engine is unavailable. |
| Child timeout or job timeout | `PROCESSING_TIMEOUT` | No | Processing took too long and was stopped. |
| Output missing, empty, or wrong page count | `OUTPUT_INVALID` | No | The generated file could not be verified. |
| Lease expired / worker killed | `WORKER_LOST` | Once via recovery | Processing was interrupted. Please try again. |
| Database deadlock before work | None; transition retried | Up to 3 | Not visible if retry succeeds. |
| Storage write failure | `PROCESSING_FAILED` or `STORAGE_UNAVAILABLE` | No | The document could not be processed. |
| Loss of lease during processing | No overwrite | No | Recovered job determines the outcome. |

The job stores a sanitized code and a message of at most 500 characters. Internal stderr, stack traces, and paths remain in logs and are capped and redacted.

## 10. Cleanup and reconciliation

- Every attempt removes its work directory in `finally`, including after timeouts and killed children.
- The expiry sweep marks terminal jobs `EXPIRED` at `expiresAt` and logs a count.
- The file sweep unlinks expired files that are not referenced by an active job, then marks rows `DELETED`.
- The metadata sweep purges jobs 24 hours after expiry, cascading inputs and detaching outputs.
- Deleted file rows are purged 24 hours after deletion.
- Orphan reconciliation compares `uploads/` and `outputs/` files older than 24 hours against the database and removes unreferenced entries.
- Stale `tmp/` directories older than 24 hours are removed.
- Cleanup batches are limited to 100 rows and are idempotent.
- A failed unlink keeps the row `STORED` for the next sweep and logs a warning without a path.

## 11. Download path

1. Authorize the job token hash and load job state.
2. Reject a non-terminal job with `409`, an expired job with `410`, and a failed job with `404`.
3. Resolve the single output `File` and verify `STORED`.
4. Open a read stream from storage.
5. Set the sanitized filename, stored MIME type, length, `private, no-store`, and `nosniff`.
6. Stream to the client and handle premature close without marking the job failed.

The API does not write files during download. A missing artifact while metadata says `STORED` returns `503`, logs the job id, and leaves reconciliation to mark the inconsistency.

## 12. Test fixture strategy

Fixtures are generated locally, never downloaded from third parties:

| Fixture | Generation |
| --- | --- |
| 1, 2, and 3-page PDFs | pdf-lib script with distinct page labels |
| 101-page and 500-page PDFs | pdf-lib loop |
| Large text PDF | Generated text pages, compressed as a baseline |
| Encrypted PDF | Ghostscript with owner and user passwords, verified by `pdfinfo` |
| Corrupt PDF | Truncate a valid PDF and strip the trailer |
| JPEG, PNG, WebP, TIFF | Sharp from a generated gradient and text overlay |
| Animated/multi-page image | Sharp multi-page output where supported, or a checked-in tiny fixture |
| Corrupt image | Truncate a valid JPEG |
| Adversarial filenames | Names containing `../`, nulls, Unicode overrides, and long extensions |
| Oversized file | Sparse or generated file above 25 MB |

Verification uses output parsing, not HTTP status alone: page counts from `pdfinfo`, page rotation via pdf-lib, image dimensions via Sharp, ZIP entries and names, and byte-level signatures. Each operation test also asserts that the input hash is unchanged after processing.

## 13. Operational limits summary

| Limit | Default | Environment variable |
| --- | --- | --- |
| File size | 25 MB | `MAX_FILE_SIZE_MB` |
| Files per upload | 20 | `MAX_FILES_PER_UPLOAD` |
| Upload request size | 100 MB | `MAX_UPLOAD_TOTAL_MB` |
| Job input size | 150 MB | `MAX_JOB_INPUT_MB` |
| PDF pages at upload | 500 | `MAX_PDF_PAGES` |
| Merge output pages | 2,000 | `MAX_MERGED_PAGES` |
| Split parts | 20 | `MAX_SPLIT_PARTS` |
| PDF to Images pages | 100 | `PDF_TO_IMAGES_MAX_PAGES` |
| Image megapixels | 40 | `MAX_IMAGE_MEGAPIXELS` |
| PDF to Images pixels per page | 50,000,000 | `PDF_TO_IMAGES_MAX_PIXELS` |
| Worker concurrency | 2 | `WORKER_CONCURRENCY` |
| Lease | 60 s | `JOB_LEASE_SECONDS` |
| Heartbeat | 15 s | `JOB_HEARTBEAT_SECONDS` |
| Input retention | 60 min | `INPUT_RETENTION_MINUTES` |
| Output retention | 60 min | `OUTPUT_RETENTION_MINUTES` |
| Metadata retention | 24 h | `JOB_METADATA_RETENTION_HOURS` |
| Cleanup interval | 5 min | `CLEANUP_INTERVAL_SECONDS` |
| Storage reserve | 2 GB | `STORAGE_MIN_FREE_MB` |
