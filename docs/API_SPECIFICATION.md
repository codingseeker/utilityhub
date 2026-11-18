> **Superseded (2026-11-18).** This document describes the pre-GCP
> architecture (MySQL, Prisma, local disk, and/or WordPress identity). It is kept
> for traceability. See [docs/README.md](./README.md) for the current set.

# UtilityHub — API Specification

Version: 1.0
Date: 2026-11-17
Base URL: `http://localhost:4000/api/v1`
Protocol: HTTP/1.1, JSON except upload and download bodies
Source of truth for behavior: `docs/PRD.md`; schema: `docs/DATABASE_DESIGN.md`

## 1. Conventions

- All request and response bodies are UTF-8.
- JSON endpoints require `Content-Type: application/json` and reject malformed JSON with `400 INVALID_JSON`.
- Uploads use `multipart/form-data`.
- Downloads return the raw artifact stream.
- Timestamps are ISO 8601 UTC strings with milliseconds, for example `2026-11-17T10:15:30.123Z`.
- Byte sizes are integers. Page numbers are 1-based.
- Every response includes `X-Request-Id`. A client-supplied `X-Request-Id` is accepted if it matches `[A-Za-z0-9._-]{8,64}`; otherwise the server generates a UUID.
- Unknown request fields are rejected where an explicit schema exists, to prevent silent misconfiguration.
- Success responses use `{ "data": ... }`. Errors use the envelope below and no `data`.
- No response contains a storage key, filesystem path, engine command, stack trace, or raw token.

### 1.1 Success envelope

```json
{
  "data": {
    "example": true
  }
}
```

### 1.2 Error envelope

```json
{
  "error": {
    "code": "INVALID_OPTIONS",
    "message": "Check the selected options and try again.",
    "details": [
      {
        "field": "options.angle",
        "message": "Must be 90, 180, or 270."
      }
    ],
    "requestId": "9f2d6c1a-4a5e-4f0f-9d5e-6a7b8c9d0e1f"
  }
}
```

`details` is optional. Messages are safe for direct display. Internal details are logged only.

### 1.3 Authentication

| Credential | Delivered | Used by |
| --- | --- | --- |
| Upload token | Response of `POST /uploads` | `POST /jobs`, `DELETE /uploads/:fileId` |
| Job token | Response of `POST /jobs` | `GET /jobs/:jobId`, `GET /jobs/:jobId/download`, `DELETE /jobs/:jobId` |

Both tokens are 32 random bytes encoded as base64url (43 characters). Only SHA-256 hashes are stored server-side. Tokens are never accepted in query strings and never logged.

Job endpoints require `Authorization: Bearer <jobToken>`. Missing, malformed, unknown, or mismatched credentials return the same `404 UNAUTHORIZED` response to prevent job enumeration.

### 1.4 Rate limits

Limits are per client IP and per API process. Responses include `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`; a `429` includes `Retry-After` in seconds.

| Scope | Limit |
| --- | --- |
| All `/api/v1` requests | 300 per minute |
| `POST /uploads` | 30 per 10 minutes |
| `POST /jobs` | 60 per 10 minutes |
| `GET /jobs/:id/download` | 120 per 10 minutes |

Rate-limit state is in memory and resets on API restart. This is acceptable for a single-process local MVP and is documented as a scaling limitation.

### 1.5 Common headers

| Header | Direction | Purpose |
| --- | --- | --- |
| `X-Request-Id` | Response and optional request | Correlation |
| `Authorization` | Request | Bearer capability token |
| `Cache-Control: no-store` | Response | Prevent caching of metadata and artifacts |
| `X-Content-Type-Options: nosniff` | Response | Prevent MIME sniffing |
| `Referrer-Policy: no-referrer` | Response | Avoid token or URL leakage |
| `RateLimit-*` | Response | Rate-limit state |

CORS allows only origins in `CORS_ORIGINS` (default `http://localhost:5173`) and does not enable credentials.

## 2. Operations catalog

### 2.1 Get supported operations

`GET /operations`

Authentication: none.

Response `200`:

```json
{
  "data": {
    "operations": [
      {
        "id": "merge-pdf",
        "name": "Merge PDF",
        "description": "Combine PDFs in the order you choose.",
        "input": {
          "kind": "pdf",
          "minFiles": 2,
          "maxFiles": 20,
          "maxFileSizeBytes": 26214400,
          "maxTotalBytes": 157286400,
          "accept": ["application/pdf"]
        },
        "options": [],
        "limits": {
          "maxTimeoutMs": 120000,
          "maxOutputPages": 2000
        }
      },
      {
        "id": "split-pdf",
        "name": "Split PDF",
        "description": "Extract page ranges into one or more PDFs.",
        "input": {
          "kind": "pdf",
          "minFiles": 1,
          "maxFiles": 1,
          "maxFileSizeBytes": 26214400,
          "maxTotalBytes": 26214400,
          "accept": ["application/pdf"]
        },
        "options": [
          {
            "name": "mode",
            "label": "Split method",
            "type": "enum",
            "required": true,
            "default": "ranges",
            "choices": ["ranges", "every"]
          },
          {
            "name": "ranges",
            "label": "Page ranges",
            "type": "pageRangeList",
            "requiredWhen": { "field": "mode", "equals": "ranges" },
            "maxItems": 20,
            "help": "Example: 1-3, 5, 8-10"
          },
          {
            "name": "pagesPerFile",
            "label": "Pages per file",
            "type": "integer",
            "requiredWhen": { "field": "mode", "equals": "every" },
            "min": 1,
            "max": 100,
            "default": 1
          }
        ],
        "limits": {
          "maxTimeoutMs": 120000,
          "maxParts": 20
        }
      },
      {
        "id": "compress-pdf",
        "name": "Compress PDF",
        "description": "Reduce PDF size with a quality preset.",
        "input": {
          "kind": "pdf",
          "minFiles": 1,
          "maxFiles": 1,
          "maxFileSizeBytes": 26214400,
          "maxTotalBytes": 26214400,
          "accept": ["application/pdf"]
        },
        "options": [
          {
            "name": "preset",
            "label": "Compression",
            "type": "enum",
            "required": false,
            "default": "medium",
            "choices": ["low", "medium", "high"]
          }
        ],
        "limits": {
          "maxTimeoutMs": 180000
        }
      },
      {
        "id": "rotate-pdf",
        "name": "Rotate PDF",
        "description": "Rotate all or selected pages.",
        "input": {
          "kind": "pdf",
          "minFiles": 1,
          "maxFiles": 1,
          "maxFileSizeBytes": 26214400,
          "maxTotalBytes": 26214400,
          "accept": ["application/pdf"]
        },
        "options": [
          {
            "name": "angle",
            "label": "Angle",
            "type": "enum",
            "required": true,
            "choices": [90, 180, 270]
          },
          {
            "name": "pages",
            "label": "Pages",
            "type": "pageRange",
            "required": false,
            "default": "all",
            "help": "Use all or a range such as 1-3,5"
          }
        ],
        "limits": {
          "maxTimeoutMs": 90000
        }
      },
      {
        "id": "images-to-pdf",
        "name": "Images to PDF",
        "description": "Turn images into a single PDF.",
        "input": {
          "kind": "image",
          "minFiles": 1,
          "maxFiles": 20,
          "maxFileSizeBytes": 26214400,
          "maxTotalBytes": 157286400,
          "accept": ["image/jpeg", "image/png", "image/webp", "image/tiff"]
        },
        "options": [
          {
            "name": "pageSize",
            "label": "Page size",
            "type": "enum",
            "required": false,
            "default": "fit",
            "choices": ["fit", "a4", "letter"]
          },
          {
            "name": "orientation",
            "label": "Orientation",
            "type": "enum",
            "required": false,
            "default": "auto",
            "choices": ["auto", "portrait", "landscape"]
          },
          {
            "name": "margin",
            "label": "Margin (points)",
            "type": "integer",
            "required": false,
            "default": 0,
            "min": 0,
            "max": 50
          }
        ],
        "limits": {
          "maxTimeoutMs": 180000,
          "maxPixelsPerImage": 40000000
        }
      },
      {
        "id": "pdf-to-images",
        "name": "PDF to Images",
        "description": "Render PDF pages as PNG or JPEG images.",
        "input": {
          "kind": "pdf",
          "minFiles": 1,
          "maxFiles": 1,
          "maxFileSizeBytes": 26214400,
          "maxTotalBytes": 26214400,
          "accept": ["application/pdf"]
        },
        "options": [
          {
            "name": "format",
            "label": "Image format",
            "type": "enum",
            "required": false,
            "default": "png",
            "choices": ["png", "jpeg"]
          },
          {
            "name": "dpi",
            "label": "Resolution (DPI)",
            "type": "integer",
            "required": false,
            "default": 150,
            "min": 72,
            "max": 200
          },
          {
            "name": "pages",
            "label": "Pages",
            "type": "pageRange",
            "required": false,
            "default": "all",
            "help": "Use all or a range such as 1-3,5"
          }
        ],
        "limits": {
          "maxTimeoutMs": 300000,
          "maxPagesPerJob": 100,
          "maxPixelsPerPage": 50000000
        }
      }
    ]
  }
}
```

Only implemented operations are returned. Limits reflect server configuration and may be lower than the defaults shown.

## 3. Uploads

### 3.1 Upload files

`POST /uploads`

Authentication: none.

Request: `multipart/form-data` with one or more parts named `files`. A single request may contain up to 20 files and 100 MB total. Each part is validated independently.

| Constraint | Value |
| --- | --- |
| Field name | `files` |
| Max files per request | 20 |
| Max size per file | 25 MB |
| Max request size | 100 MB |
| Accepted PDF | Valid, unencrypted, ≤ 500 pages |
| Accepted images | JPEG, PNG, WebP, TIFF; ≤ 40 megapixels |
| Empty files | Rejected |

Validation order per file: size, extension versus detected signature, signature, decode, encryption, page or pixel limits, sanitization.

Response `201`:

```json
{
  "data": {
    "files": [
      {
        "id": "clx1a2b3c4d5e6f7g8h9i0j1k",
        "originalName": "quarterly report.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 482133,
        "pageCount": 12,
        "kind": "pdf",
        "uploadToken": "vJ8t...43chars",
        "expiresAt": "2026-11-17T11:15:30.123Z"
      },
      {
        "id": "clx1a2b3c4d5e6f7g8h9i0j1l",
        "originalName": "scan-01.jpg",
        "mimeType": "image/jpeg",
        "sizeBytes": 902144,
        "pageCount": null,
        "kind": "image",
        "uploadToken": "Qm3z...43chars",
        "expiresAt": "2026-11-17T11:15:30.123Z"
      }
    ]
  }
}
```

`uploadToken` is returned only in this response. `originalName` is sanitized for display: path components removed, control characters stripped, length limited. The stored name is always generated.

Errors: `NO_FILE`, `TOO_MANY_FILES`, `FILE_TOO_LARGE`, `REQUEST_TOO_LARGE`, `EMPTY_FILE`, `UNSUPPORTED_FILE_TYPE`, `MIME_MISMATCH`, `INVALID_FILE_SIGNATURE`, `PDF_CORRUPTED`, `ENCRYPTED_PDF`, `PDF_PAGE_LIMIT`, `IMAGE_PIXEL_LIMIT`, `RATE_LIMITED`, `STORAGE_UNAVAILABLE`, `INTERNAL_ERROR`.

On any failure, all files from that request are removed and no metadata rows are committed.

### 3.2 Delete an unused upload

`DELETE /uploads/:fileId`

Headers: `Authorization: Bearer <uploadToken>`

Behavior:

- Deletes a stored input that is not referenced by any job.
- Returns `204` with no body on success, including when the file is already gone.
- Unknown file or wrong token returns `404 UNAUTHORIZED`.
- A file referenced by a job returns `409 FILE_IN_USE`.
- An expired file returns `410 FILE_EXPIRED`.

## 4. Jobs

### 4.1 Create a job

`POST /jobs`

Authentication: upload tokens in the body.

Request:

```json
{
  "operation": "merge-pdf",
  "inputs": [
    { "fileId": "clx1...", "uploadToken": "vJ8t..." },
    { "fileId": "clx2...", "uploadToken": "Qm3z..." }
  ],
  "options": {}
}
```

Rules:

- `inputs` preserve order and define processing order where relevant.
- The same `fileId` may appear at most once per job.
- All inputs must belong to the same owner and be unexpired.
- `operation` must be registered and enabled.
- Input count, kind, total size, and options must satisfy the operation descriptor.
- Options are validated against the operation schema; defaults are applied and persisted.
- Unknown options are rejected.
- Job creation is not idempotent: repeating the request creates a new job. Clients must disable duplicate submits while a request is in flight.

Response `202`:

```json
{
  "data": {
    "id": "clx9z8y7x6w5v4u3t2s1r0q",
    "operation": "merge-pdf",
    "status": "QUEUED",
    "jobToken": "kR4d...43chars",
    "createdAt": "2026-11-17T10:15:30.123Z",
    "queuedAt": "2026-11-17T10:15:30.123Z",
    "expiresAt": null,
    "pollAfterMs": 1000,
    "statusUrl": "/api/v1/jobs/clx9z8y7x6w5v4u3t2s1r0q",
    "downloadUrl": null
  }
}
```

`jobToken` is returned only here. The client must store it for status, download, and delete requests.

Errors: `INVALID_OPERATION`, `INVALID_INPUT_COUNT`, `INVALID_INPUT_KIND`, `INVALID_UPLOAD_TOKEN`, `FILE_EXPIRED`, `INVALID_OPTIONS`, `INVALID_PAGE_RANGE`, `REQUEST_TOO_LARGE`, `RATE_LIMITED`, `STORAGE_UNAVAILABLE`, `INTERNAL_ERROR`.

Validation failures create no job. Once a job exists, all failures are represented by job status.

### 4.2 Get job status

`GET /jobs/:jobId`

Headers: `Authorization: Bearer <jobToken>`

Responses `200`:

Queued or processing:

```json
{
  "data": {
    "id": "clx9z8y7x6w5v4u3t2s1r0q",
    "operation": "merge-pdf",
    "status": "PROCESSING",
    "createdAt": "2026-11-17T10:15:30.123Z",
    "queuedAt": "2026-11-17T10:15:30.123Z",
    "startedAt": "2026-11-17T10:15:31.456Z",
    "completedAt": null,
    "expiresAt": null,
    "attempts": 1,
    "result": null,
    "error": null,
    "pollAfterMs": 1000,
    "downloadUrl": null
  }
}
```

Completed:

```json
{
  "data": {
    "id": "clx9z8y7x6w5v4u3t2s1r0q",
    "operation": "merge-pdf",
    "status": "COMPLETED",
    "createdAt": "2026-11-17T10:15:30.123Z",
    "queuedAt": "2026-11-17T10:15:30.123Z",
    "startedAt": "2026-11-17T10:15:31.456Z",
    "completedAt": "2026-11-17T10:15:35.789Z",
    "expiresAt": "2026-11-17T11:15:35.789Z",
    "attempts": 1,
    "result": {
      "artifact": {
        "fileName": "merged.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 982133
      },
      "summary": {
        "inputCount": 2,
        "outputPageCount": 18
      }
    },
    "error": null,
    "pollAfterMs": null,
    "downloadUrl": "/api/v1/jobs/clx9z8y7x6w5v4u3t2s1r0q/download"
  }
}
```

Failed:

```json
{
  "data": {
    "id": "clx9z8y7x6w5v4u3t2s1r0q",
    "operation": "compress-pdf",
    "status": "FAILED",
    "createdAt": "2026-11-17T10:15:30.123Z",
    "queuedAt": "2026-11-17T10:15:30.123Z",
    "startedAt": "2026-11-17T10:15:31.456Z",
    "completedAt": "2026-11-17T10:15:33.789Z",
    "expiresAt": "2026-11-17T11:15:33.789Z",
    "attempts": 2,
    "result": null,
    "error": {
      "code": "PROCESSING_FAILED",
      "message": "The document could not be processed."
    },
    "pollAfterMs": null,
    "downloadUrl": null
  }
}
```

Expired:

```json
{
  "data": {
    "id": "clx9z8y7x6w5v4u3t2s1r0q",
    "operation": "rotate-pdf",
    "status": "EXPIRED",
    "expiresAt": "2026-11-17T11:15:33.789Z",
    "attempts": 1,
    "result": null,
    "error": {
      "code": "JOB_EXPIRED",
      "message": "This result has expired. Upload the file again to continue."
    },
    "pollAfterMs": null,
    "downloadUrl": null
  }
}
```

Status responses never include input file names, storage keys, or engine output. `attempts` is the number of claims, not retries. If a terminal job's `expiresAt` is in the past, the API reports `EXPIRED` even before the cleanup sweep updates the row; download authorization applies the same check.

Errors: `404 UNAUTHORIZED`, `429 RATE_LIMITED`, `503 SERVICE_UNAVAILABLE`, `500 INTERNAL_ERROR`.

### 4.3 Download the artifact

`GET /jobs/:jobId/download`

Headers: `Authorization: Bearer <jobToken>`

Success `200` streams the artifact with:

| Header | Value |
| --- | --- |
| `Content-Type` | Stored MIME type, either `application/pdf`, `image/png`, `image/jpeg`, or `application/zip` |
| `Content-Disposition` | `attachment; filename="<sanitized-artifact-name>"` |
| `Content-Length` | Artifact size |
| `Cache-Control` | `private, no-store` |
| `X-Content-Type-Options` | `nosniff` |

Artifact naming:

| Operation | Single output | Multiple outputs |
| --- | --- | --- |
| Merge | `merged.pdf` | Not applicable |
| Split | `part-01.pdf` | `split.zip` containing `part-01.pdf` … |
| Compress | `<basename>-compressed.pdf` | Not applicable |
| Rotate | `<basename>-rotated.pdf` | Not applicable |
| Images to PDF | `images.pdf` | Not applicable |
| PDF to Images | `page-01.png` or `page-01.jpg` | `pages.zip` containing `page-01.png` … |

`<basename>` is the sanitized input display name without its extension, limited to 80 characters.

Errors:

| Status | Code | Condition |
| --- | --- | --- |
| `404` | `UNAUTHORIZED` | Unknown job or wrong token |
| `409` | `JOB_NOT_READY` | Job is `QUEUED` or `PROCESSING` |
| `410` | `JOB_EXPIRED` | Job or artifact retention elapsed |
| `404` | `NOT_FOUND` | Job is `FAILED` and has no artifact |
| `503` | `STORAGE_UNAVAILABLE` | Artifact metadata exists but storage cannot be read |

Downloads are streamed. The API opens the file only after authorization and does not buffer it fully.

### 4.4 Delete a job

`DELETE /jobs/:jobId`

Headers: `Authorization: Bearer <jobToken>`

Behavior:

- Allowed only for `COMPLETED` or `FAILED` jobs.
- Sets `deletedAt` and `expiresAt` to now. The cleanup worker removes the artifact and marks the job `EXPIRED` within one cleanup cycle.
- Subsequent status and download requests return `410 JOB_EXPIRED`.
- Returns `204` with no body.
- Active jobs return `409 JOB_ACTIVE`.
- Unknown job or wrong token returns `404 UNAUTHORIZED`.

## 5. Health

### 5.1 Liveness

`GET /health/live`

Authentication: none. Always `200` while the process is running.

```json
{
  "data": {
    "status": "ok",
    "uptimeSeconds": 1234
  }
}
```

### 5.2 Readiness

`GET /health/ready`

Checks the database with `SELECT 1` and verifies the storage root exists, is writable, and has at least the configured reserve.

```json
{
  "data": {
    "status": "ok",
    "checks": {
      "database": { "status": "ok", "latencyMs": 3 },
      "storage": { "status": "ok", "freeBytes": 53687091200 }
    }
  }
}
```

Returns `503` with `status: "degraded"` when any check fails. The body contains no credentials or paths.

## 6. Option schemas

### 6.1 Page range grammar

- 1-based inclusive page numbers.
- A single page: `7`.
- A range: `3-9`, where start ≤ end.
- A comma-separated list: `1-3,5,8-10`.
- Whitespace around items is ignored.
- Empty items, zero, negative numbers, reversed ranges, decimals, and non-numeric characters are rejected.
- Duplicate or overlapping items are allowed and processed in the given order.
- The string `all` is accepted only where the schema states it.
- A list may contain at most 20 items for split and 200 items for page selection.

### 6.2 Merge PDF

```json
{ "operation": "merge-pdf", "options": {} }
```

No options. Input order is preserved. Maximum 2,000 output pages.

### 6.3 Split PDF

```json
{
  "operation": "split-pdf",
  "options": {
    "mode": "ranges",
    "ranges": ["1-3", "5"]
  }
}
```

```json
{
  "operation": "split-pdf",
  "options": {
    "mode": "every",
    "pagesPerFile": 5
  }
}
```

Rules:

- `mode` is required and is `ranges` or `every`.
- In `ranges` mode, `ranges` is required and `pagesPerFile` must be absent.
- In `every` mode, `pagesPerFile` is required and `ranges` must be absent.
- Each range becomes one output part. `every` mode produces `ceil(pageCount / pagesPerFile)` parts.
- At least one part and at most 20 parts.
- Every page reference must be between 1 and the PDF page count.

Summary: `{ "partCount": 2, "totalPages": 4 }`.

### 6.4 Compress PDF

```json
{
  "operation": "compress-pdf",
  "options": { "preset": "medium" }
}
```

Presets map to Ghostscript settings: `low` = `/screen`, `medium` = `/ebook`, `high` = `/printer`. Default is `medium`.

Summary:

```json
{
  "preset": "medium",
  "originalSizeBytes": 1024000,
  "outputSizeBytes": 512000,
  "reductionBytes": 512000,
  "reductionPercent": 50.0,
  "applied": true
}
```

When the compressed candidate is not smaller, the original bytes become the artifact and `applied` is `false` with the real sizes.

### 6.5 Rotate PDF

```json
{
  "operation": "rotate-pdf",
  "options": { "angle": 90, "pages": "1-3,5" }
}
```

`angle` is required and is `90`, `180`, or `270`. `pages` defaults to `all`. Summary: `{ "angle": 90, "pagesRotated": 4 }`.

### 6.6 Images to PDF

```json
{
  "operation": "images-to-pdf",
  "options": {
    "pageSize": "a4",
    "orientation": "auto",
    "margin": 24
  }
}
```

Defaults: `pageSize: "fit"`, `orientation: "auto"`, `margin: 0`. `margin` is an integer from 0 to 50 points and must be 0 when `pageSize` is `fit`.

Summary: `{ "imageCount": 3, "outputPageCount": 3 }`.

### 6.7 PDF to Images

```json
{
  "operation": "pdf-to-images",
  "options": {
    "format": "png",
    "dpi": 150,
    "pages": "1-3"
  }
}
```

Defaults: `format: "png"`, `dpi: 150`, `pages: "all"`. `dpi` is an integer from 72 to 200. At most 100 pages may be rendered per job. Summary: `{ "format": "png", "dpi": 150, "imageCount": 3 }`.

## 7. Error catalog

| Code | HTTP | User-safe message |
| --- | --- | --- |
| `INVALID_JSON` | 400 | The request body is not valid JSON. |
| `NO_FILE` | 400 | Add at least one file. |
| `TOO_MANY_FILES` | 400 | You can add at most 20 files per upload. |
| `EMPTY_FILE` | 422 | One of the files is empty. |
| `FILE_TOO_LARGE` | 413 | This file is larger than 25 MB. |
| `REQUEST_TOO_LARGE` | 413 | The upload is larger than 100 MB. |
| `UNSUPPORTED_FILE_TYPE` | 415 | This file type is not supported. Use PDF, JPG, PNG, WebP, or TIFF. |
| `MIME_MISMATCH` | 422 | The file type does not match its content. |
| `INVALID_FILE_SIGNATURE` | 422 | The file content does not match its type. |
| `PDF_CORRUPTED` | 422 | This PDF cannot be read. |
| `ENCRYPTED_PDF` | 422 | Password-protected PDFs are not supported. |
| `PDF_PAGE_LIMIT` | 422 | This PDF has more than 500 pages. |
| `IMAGE_PIXEL_LIMIT` | 422 | This image is too large to process. |
| `INVALID_OPERATION` | 422 | This operation is not available. |
| `INVALID_INPUT_COUNT` | 422 | Add the required number of files for this tool. |
| `INVALID_INPUT_KIND` | 422 | One or more files are not valid for this tool. |
| `INVALID_UPLOAD_TOKEN` | 422 | One or more uploaded files could not be verified. |
| `FILE_EXPIRED` | 410 | This upload has expired. Add the file again. |
| `FILE_IN_USE` | 409 | This file is already used by a job. |
| `INVALID_OPTIONS` | 422 | Check the selected options and try again. |
| `INVALID_PAGE_RANGE` | 422 | Enter page numbers within 1 to N. |
| `UNAUTHORIZED` | 404 | This job cannot be accessed. |
| `NOT_FOUND` | 404 | This result is not available. |
| `JOB_NOT_READY` | 409 | The result is still being prepared. |
| `JOB_EXPIRED` | 410 | This result has expired. Upload the file again to continue. |
| `JOB_ACTIVE` | 409 | This job is still running. |
| `RATE_LIMITED` | 429 | Too many requests. Try again shortly. |
| `STORAGE_UNAVAILABLE` | 503 | Processing is temporarily unavailable. Try again later. |
| `SERVICE_UNAVAILABLE` | 503 | The service is temporarily unavailable. |
| `INTERNAL_ERROR` | 500 | Something went wrong. Try again. |

Job failure codes returned inside a `FAILED` status:

| Code | Message |
| --- | --- |
| `PROCESSING_FAILED` | The document could not be processed. |
| `PROCESSING_TIMEOUT` | Processing took too long and was stopped. |
| `ENGINE_UNAVAILABLE` | A required processing engine is unavailable. |
| `WORKER_LOST` | Processing was interrupted. Please try again. |
| `OUTPUT_INVALID` | The generated file could not be verified. |
| `STORAGE_UNAVAILABLE` | Processing is temporarily unavailable. Try again later. |

`PROCESSING_FAILED` is the public fallback when a more specific safe code is not available. Details remain in server logs keyed by job id.

## 8. Endpoint status summary

| Endpoint | Success | Common failures |
| --- | --- | --- |
| `GET /operations` | 200 | 503 |
| `POST /uploads` | 201 | 400, 413, 415, 422, 429, 503 |
| `DELETE /uploads/:id` | 204 | 404, 409, 410, 429, 503 |
| `POST /jobs` | 202 | 400, 410, 413, 422, 429, 503 |
| `GET /jobs/:id` | 200 | 404, 429, 503 |
| `GET /jobs/:id/download` | 200 | 404, 409, 410, 429, 503 |
| `DELETE /jobs/:id` | 204 | 404, 409, 410, 429, 503 |
| `GET /health/live` | 200 | — |
| `GET /health/ready` | 200 | 503 |

## 9. Example session

```bash
curl -sS -X POST http://localhost:4000/api/v1/uploads \
  -F "files=@sample-a.pdf" \
  -F "files=@sample-b.pdf"
```

```bash
curl -sS -X POST http://localhost:4000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "merge-pdf",
    "inputs": [
      {"fileId": "clx1...", "uploadToken": "vJ8t..."},
      {"fileId": "clx2...", "uploadToken": "Qm3z..."}
    ],
    "options": {}
  }'
```

```bash
curl -sS http://localhost:4000/api/v1/jobs/clx9... \
  -H "Authorization: Bearer kR4d..."
```

```bash
curl -sS -OJ http://localhost:4000/api/v1/jobs/clx9.../download \
  -H "Authorization: Bearer kR4d..."
```

The frontend downloads via `fetch` with the bearer header and an object URL so the token never appears in a URL or browser history.

## 10. Compatibility and versioning

- The API is versioned by the `/api/v1` prefix.
- Additive response fields are allowed within `v1`; clients must ignore unknown fields they do not use.
- Removing or renaming fields, changing status semantics, or changing limits downward for existing jobs requires a new major version.
- Error codes are stable identifiers; messages may be clarified without a version change.
- The frontend discovers operations and limits at runtime and must not hardcode stale limits beyond a safe fallback for startup failures.
