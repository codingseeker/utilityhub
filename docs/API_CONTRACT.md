# UtilityHub — API Contract

Base URL: `https://<cloud-run-api-host>/api/v1`
Version: 2.0 (GCP)
Content type: `application/json` except signed storage transfers.

## 1. Conventions

- Success envelope: `{ "data": <payload>, "requestId": "<uuid>" }`.
- Error envelope: `{ "error": { "code": "<CODE>", "message": "<safe message>", "details"?: [...] }, "requestId": "<uuid>" }`.
- Authentication: `Authorization: Bearer <Firebase ID token>` on every `/uploads`, `/jobs`, and `/me` route.
- Development only: `X-Dev-User: <id>` is accepted when `AUTH_MODE=dev`. It is rejected in production.
- Timestamps are ISO-8601 UTC strings.
- No storage keys, GCS paths, filesystem paths, or raw provider errors are returned.
- Rate limits return `429` with `Retry-After`.

## 2. Public endpoints

### `GET /health/live`

Liveness. No auth.

```json
{ "data": { "status": "ok", "service": "utilityhub-api", "version": "2.0.0" } }
```

### `GET /health/ready`

Checks Firestore and the storage bucket with a bounded probe.

```json
{ "data": { "status": "ready", "checks": { "store": "ok", "storage": "ok" } } }
```

Returns `503` with `status: "degraded"` when a dependency fails.

### `GET /operations`

Returns the tool catalog. No auth. Client-only tools are marked `runtime: "client"`.

```json
{
  "data": {
    "operations": [
      {
        "id": "merge-pdf",
        "name": "Merge PDF",
        "category": "pdf",
        "description": "Combine PDFs in the order you choose.",
        "runtime": "cloud",
        "input": {
          "kind": "pdf",
          "minFiles": 2,
          "maxFiles": 20,
          "maxFileSizeBytes": 26214400,
          "maxTotalBytes": 104857600,
          "accept": ["application/pdf"],
          "extensions": [".pdf"]
        },
        "options": [],
        "limits": { "maxTimeoutMs": 120000, "maxOutputPages": 2000 }
      }
    ],
    "categories": [
      { "id": "pdf", "name": "PDF" },
      { "id": "photo", "name": "Photo" },
      { "id": "data", "name": "Data" },
      { "id": "text", "name": "Text" },
      { "id": "utilities", "name": "Utilities" }
    ],
    "limits": {
      "maxFileSizeBytes": 26214400,
      "maxFilesPerJob": 20,
      "maxJobInputBytes": 104857600,
      "uploadUrlTtlSeconds": 900,
      "downloadUrlTtlSeconds": 300,
      "resultRetentionHours": 24
    }
  }
}
```

## 3. Session bootstrap

### `POST /auth/session` (auth)

Upserts the caller's profile and returns the same payload as `GET /me`. The
frontend calls this after a Firebase sign-in. Body may be empty `{}`.

Errors: `401 UNAUTHORIZED`.

## 4. Upload flow

### `POST /uploads/init` (auth)

Creates upload records and returns one signed PUT URL per file.

Request:

```json
{
  "files": [
    { "name": "report.pdf", "sizeBytes": 482133, "mimeType": "application/pdf" }
  ]
}
```

Rules: 1–20 files, each ≤ 25 MB, total ≤ 100 MB, allowed extension/MIME pairs only. Declared size must be a positive integer. Quota is checked here and again at job creation.

Response `201`:

```json
{
  "data": {
    "uploads": [
      {
        "uploadId": "upl_9f2...",
        "name": "report.pdf",
        "key": "uploads/<uid>/<uploadId>/report.pdf",
        "method": "PUT",
        "url": "https://storage.googleapis.com/utilityhub-uploads/...&X-Goog-Signature=...",
        "headers": { "Content-Type": "application/pdf" },
        "expiresAt": "2026-11-18T12:15:00.000Z"
      }
    ]
  }
}
```

Upload the bytes directly to `url` with the returned method and headers. Do not send the Firebase token to GCS.

Errors: `401 UNAUTHORIZED`, `413 REQUEST_TOO_LARGE`, `415 UNSUPPORTED_FILE_TYPE`, `422 INVALID_UPLOAD`, `429 QUOTA_EXCEEDED`.

### `DELETE /uploads/:uploadId` (auth)

Discards an unused upload and deletes the object. `204` on success. `409 UPLOAD_IN_USE` if a job already referenced it.

## 5. Jobs

### `POST /jobs` (auth)

Request:

```json
{
  "operation": "split-pdf",
  "uploads": ["upl_9f2..."],
  "options": { "mode": "ranges", "ranges": ["1-3", "5"] }
}
```

Server work:

1. Verify each upload belongs to the caller and is not consumed.
2. Verify the object exists, matches declared size/type, and the first bytes match the signature.
3. Validate count, size, extension/MIME and options against the operation schema.
4. Check quota (jobs/day, bytes/day, concurrent active jobs).
5. Create a `queued` job in Firestore and trigger the worker.

Response `202`:

```json
{
  "data": {
    "id": "job_01J...",
    "operation": "split-pdf",
    "status": "queued",
    "createdAt": "2026-11-18T12:00:00.000Z",
    "expiresAt": "2026-11-19T12:00:00.000Z",
    "pollAfterMs": 1000
  }
}
```

Errors: `401`, `404 UPLOAD_NOT_FOUND`, `409 UPLOAD_CONSUMED`, `413`, `422 INVALID_OPTIONS|INVALID_INPUT|UNSUPPORTED_FILE_TYPE`, `429 QUOTA_EXCEEDED|RATE_LIMITED`.

### `GET /jobs/:id` (auth)

Only the owner can read. Effective status is computed at read time: a terminal job past `expiresAt` is reported as `expired`.

```json
{
  "data": {
    "id": "job_01J...",
    "operation": "split-pdf",
    "status": "done",
    "attempts": 1,
    "createdAt": "...",
    "queuedAt": "...",
    "startedAt": "...",
    "completedAt": "...",
    "expiresAt": "...",
    "result": {
      "fileName": "split.zip",
      "mimeType": "application/zip",
      "sizeBytes": 128000,
      "pageCount": 4,
      "summary": { "partCount": 2, "pageCount": 4 }
    },
    "error": null,
    "pollAfterMs": null,
    "downloadAvailable": true
  }
}
```

Failure example:

```json
{
  "data": {
    "status": "failed",
    "error": { "code": "PROCESSING_FAILED", "message": "The document could not be processed." }
  }
}
```

Errors: `401`, `404 JOB_NOT_FOUND` (also used for another user's job to prevent enumeration).

### `GET /jobs/:id/download` (auth)

Returns a 5-minute signed GET URL; it does not proxy bytes.

```json
{
  "data": {
    "url": "https://storage.googleapis.com/...&X-Goog-Signature=...",
    "fileName": "split.zip",
    "mimeType": "application/zip",
    "sizeBytes": 128000,
    "expiresAt": "2026-11-18T12:05:00.000Z"
  }
}
```

Errors: `404`, `409 JOB_NOT_READY`, `410 JOB_EXPIRED`, `503 STORAGE_UNAVAILABLE`.

### `DELETE /jobs/:id` (auth)

Deletes the job document, input objects, and result object. Allowed for terminal jobs. `204`. Errors: `404`, `409 JOB_ACTIVE`.

### `GET /me/jobs?limit=25` (auth)

Returns the caller's jobs, newest first, summarised. `limit` 1–100, default 25.

```json
{
  "data": {
    "jobs": [
      {
        "id": "job_01J...",
        "operation": "merge-pdf",
        "name": "Merge PDF",
        "status": "done",
        "createdAt": "...",
        "expiresAt": "...",
        "result": { "fileName": "merged.pdf", "sizeBytes": 99000 }
      }
    ]
  }
}
```

### `DELETE /me/jobs` (auth)

Clears terminal history (done/failed/expired): deletes job documents and stored objects. Returns `{ "data": { "deleted": 4 } }`. Active jobs are untouched.

### `GET /me` (auth)

```json
{
  "data": {
    "uid": "firebase-uid",
    "email": "user@example.com",
    "displayName": "User",
    "quota": { "jobsToday": 3, "jobsPerDay": 50, "bytesToday": 1048576, "bytesPerDay": 524288000 }
  }
}
```

## 6. Worker endpoints (not public)

The worker is a separate Cloud Run service. It is not reachable by browsers.

### `POST /internal/run`

Headers: `Authorization: Bearer <Google OIDC token>` with audience = worker URL. When `WORKER_SHARED_SECRET` is configured, `X-Worker-Secret` is also required (including production); in dev-only mode the shared secret is the only credential. Body `{ "jobId": "job_01J..." }` (optional; when absent, drains queued jobs for a bounded time).

Response `{ "data": { "processed": 2, "results": ["completed", "failed"] } }`.

### `GET /internal/health`

Returns worker liveness and dependency checks.

## 7. Status codes

| Code | Meaning |
| --- | --- |
| 200 / 201 / 202 / 204 | Success |
| 401 | Missing/invalid Firebase token |
| 403 | Authenticated but not permitted (worker OIDC mismatch) |
| 404 | Not found or not owned |
| 409 | Job active / upload consumed / not ready |
| 410 | Result expired |
| 413 | Payload or file too large |
| 415 | Unsupported media type |
| 422 | Valid but unacceptable input or options |
| 429 | Rate limit or quota |
| 500 | Unexpected server error (safe message + request id) |
| 503 | Dependency unavailable |

## 8. Error codes

`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `JOB_NOT_FOUND`, `JOB_NOT_READY`, `JOB_ACTIVE`, `JOB_EXPIRED`, `UPLOAD_NOT_FOUND`, `UPLOAD_CONSUMED`, `UPLOAD_IN_USE`, `INVALID_UPLOAD`, `UNSUPPORTED_FILE_TYPE`, `MIME_MISMATCH`, `INVALID_FILE_SIGNATURE`, `EMPTY_FILE`, `FILE_TOO_LARGE`, `REQUEST_TOO_LARGE`, `INVALID_OPERATION`, `INVALID_INPUT`, `INVALID_OPTIONS`, `INVALID_PAGE_RANGE`, `PDF_CORRUPTED`, `PDF_PAGE_LIMIT`, `ENCRYPTED_PDF`, `QUOTA_EXCEEDED`, `RATE_LIMITED`, `STORAGE_UNAVAILABLE`, `PROCESSING_FAILED`, `PROCESSING_TIMEOUT`, `ENGINE_UNAVAILABLE`, `OUTPUT_INVALID`, `INTERNAL_ERROR`.

## 9. Security rules

- Every upload/job route calls `requireAuth` before any business logic.
- Ownership is enforced by `uid` equality on the document; another user's job returns `404`.
- Signed upload URLs are write-only, scoped to a generated key, and expire in 15 minutes.
- Signed download URLs are read-only and expire in 5 minutes.
- Object keys embed the UID but are not authorization: the API re-checks the Firestore document before signing.
- The API never accepts a storage key from the client; keys are generated server-side.
- JSON request bodies are limited to 256 KB. Signed storage transfers are
  capped separately at `MAX_FILE_SIZE_MB`.
