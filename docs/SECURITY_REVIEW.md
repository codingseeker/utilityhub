> **Superseded (2026-11-18).** This document describes the pre-GCP
> architecture (MySQL, Prisma, local disk, and/or WordPress identity). It is kept
> for traceability. See [docs/README.md](./README.md) for the current set.

# UtilityHub — Security and Reliability Review

Version: 1.0
Date: 2026-11-17
Scope: Phase 10 hardening for the local guest-first MVP

## 1. Method

The review combined source inspection, automated regression tests, dependency audits, and live local verification. Every claim below points to code or an executed test. No security control is assumed because middleware exists.

Commands executed:

```bash
cd backend && npm audit
cd frontend && npm audit
cd backend && npm test
cd frontend && npm run build
docker compose build
docker compose up -d
```

Live checks used the API on `http://127.0.0.1:4000`, the frontend on `http://127.0.0.1:5173`, and headless Chrome driven through the DevTools protocol.

## 2. Result summary

| Item | Result |
| --- | --- |
| Open critical vulnerabilities | 0 |
| Open high vulnerabilities | 0 |
| Backend dependency advisories | 0 after overrides |
| Frontend dependency advisories | 0 |
| Backend automated tests | 76 passed, 0 failed |
| Path traversal findings | None found; containment tests added |
| Unauthorized download findings | None found; capability and identity tests pass |
| Shell injection findings | None found; `shell: false` and literal-argument test pass |
| Sensitive data in API logs | None found in redaction test or live Compose logs |
| Temporary files left after failed uploads | None in the tested paths |
| Worker crash recovery | Verified with a live SIGKILL and restart |

Phase 10 completion gate: no critical or high-severity issue remains open. Residual medium and low risks are listed in section 8.

## 3. Findings and changes

### 3.1 Upload endpoint review

- `POST /api/v1/uploads` is multipart-only, capped at 20 files, 25 MB per file, 100 MB per request, and bounded part/field counts by Multer.
- The stream counter aborts the request as soon as the total upload budget is exceeded.
- An upload rate limiter was defined but not attached; it is now applied to `POST /uploads` (30 requests per 10 minutes per IP).
- Invalid identity headers remove all temporary files before returning `401 INVALID_IDENTITY`.
- Failed validation, storage, or metadata writes remove moved files and temporary files in `createUploads`.

Evidence: `uploads.test.js` (10 tests), `security.test.js` malformed and storage-failure tests.

### 3.2 File validation

- Extension allow-list, magic-byte detection, declared MIME comparison, and detected MIME comparison are all enforced.
- PDFs are inspected with Poppler `pdfinfo`; encrypted and unreadable PDFs are rejected.
- Images are decoded with Sharp metadata checks; format, dimensions, animation, and pixel budget are enforced.
- Page and pixel budgets are checked before a job is queued.

Evidence: `uploads.test.js`, `operations.test.js`, `security.test.js` truncated PNG/JPEG and corrupt PDF tests, 501-page upload test.

### 3.3 Path handling

- Storage keys are server-generated UUID paths. User file names never become paths.
- `storage.pathForKey` rejects absolute paths, null bytes, empty values, and any resolved path outside the storage root.
- `removeWorkDir` and `removeTempFile` refuse paths outside the temporary root.
- Cleanup skips symbolic links while reconciling orphan files.
- Work directories are created with `0700`; stored files are moved and chmodded to `0600`.
- An empty per-job work root is now removed together with the work directory.

Evidence: `security.test.js` traversal and permission tests; `uploads.test.js` `../../Report.pdf` test.

### 3.4 Download authorization and job ownership

- Downloads require the 256-bit capability token in the `Authorization: Bearer` header.
- Token comparison hashes with SHA-256 and uses `timingSafeEqual`.
- WordPress-owned jobs additionally require a valid signed identity token with the matching subject.
- Missing, wrong, or mismatched credentials return the same `404 UNAUTHORIZED` body.
- Deleted or expired jobs return `410 JOB_EXPIRED`; active jobs return `409 JOB_NOT_READY`.
- Missing artifacts return `503 STORAGE_UNAVAILABLE` without exposing the path.
- Download names are ASCII-sanitized and stripped of quotes and CR/LF before header output.

Evidence: `downloads.test.js` (9 tests), `identity.test.js` (5 tests).

### 3.5 Worker concurrency and recovery

- Claims use MySQL `FOR UPDATE SKIP LOCKED`; only one worker can claim a row.
- Workers renew a 60-second lease every 15 seconds.
- Abandoned leases are requeued below the two-attempt ceiling and failed with `WORKER_LOST` at the ceiling.
- A stale worker cannot complete a job after losing its lease.
- Shutdown aborts active engines and leaves the job for lease recovery.

Live verification: a 100-page PDF-to-images job was claimed, the worker was killed with `SIGKILL` during processing, and a replacement worker requeued the expired lease, logged `recovered expired job leases`, completed the job on attempt 2, and produced a 665,021-byte ZIP. The replacement worker then shut down cleanly on `SIGTERM`.

Evidence: `jobs.test.js` concurrency, stale-worker, and retry tests; `worker.test.js`; `security.test.js` abort/recovery test.

### 3.6 Temporary directory permissions

- Storage root, uploads, outputs, temp root, and temp upload directories are re-chmodded to `0700` at startup and before uploads.
- Work directories are `0700`.
- Stored inputs and outputs are `0600`.

Evidence: `security.test.js` permission test asserts all five directories and a stored file.

### 3.7 External process invocation

- Engines are invoked with `spawn(command, args)` and `shell: false`.
- Commands are fixed strings; user values enter only as validated argv entries.
- Ghostscript runs with `-dSAFER`; `pdfinfo` and `pdftoppm` receive paths generated by the server.
- Process groups are killed on timeout or abort, with a 90–300 second per-operation cap.
- Environment is reduced to `PATH`, locale, timezone, `HOME`, and `TMPDIR`.
- stdout and stderr capture is byte-capped.

Evidence: `security.test.js` literal-argument injection test and timeout-kill test; `operations.test.js` engine coverage.

### 3.8 Limits and timeouts

Enforced values:

| Limit | Value |
| --- | --- |
| Global API rate | 300 per minute per IP |
| Upload rate | 30 per 10 minutes per IP |
| Job creation rate | 60 per 10 minutes per IP |
| Download rate | 120 per 10 minutes per IP |
| JSON body | 64 KiB |
| Upload request | 100 MB, 20 files, 25 MB each |
| Job input | 150 MB |
| PDF pages | 500 upload, 2,000 merged, 100 rendered |
| Image input | 40 MP |
| Rendered page | 50 MP |
| Worker concurrency | 2 |
| Engine timeout | 90–300 seconds by operation |

Evidence: `security.test.js` oversized JSON and upload rate-limit tests; `operations.test.js` page/pixel limit tests; successful 19 MB upload test.

### 3.9 Cleanup and retention

- Inputs expire 60 minutes after upload, outputs 60 minutes after a terminal job, metadata 24 hours after expiry.
- Cleanup runs every 5 minutes and on worker startup with reconciliation.
- Active-job inputs are protected from deletion.
- Stale work directories and temporary uploads are removed after their grace periods.
- Deleting a job immediately blocks status and download, then files are removed by the next sweep.

Evidence: `cleanup.test.js` (5 tests), `downloads.test.js` deletion test.

### 3.10 API error handling

- Client responses contain a stable code, safe message, optional field details, and request id.
- Zod errors are converted to `422 INVALID_OPTIONS`; parse and size errors map to `400`/`413`.
- Unknown errors become `500 INTERNAL_ERROR` without stack traces, SQL, file paths, or engine output.
- All error responses are `no-store`.

Evidence: `security.test.js` generic-error and simulated database-failure tests.

### 3.11 Security headers and CORS

API headers now include:

- explicit CSP `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `Cross-Origin-Resource-Policy: same-site`;
- `Permissions-Policy` disabling camera, microphone, and geolocation;
- HSTS only when `NODE_ENV=production`;
- `Cache-Control: no-store` and no `X-Powered-By`.

CORS reflects only exact origins in `CORS_ORIGINS`, does not allow credentials, and emits no CORS headers for unlisted origins.

Frontend:

- CSP meta tag restricts scripts to self, allows only the inline styles React uses, restricts images to self/data/blob, and restricts connections to self plus the development WebSocket.
- Vite dev and preview servers add `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, and a permissions policy.

Evidence: `security.test.js` header and CORS tests; live header inspection of both ports; headless Chrome frontend run with CSP enabled.

### 3.12 Logging

- Pino custom serializers log only request id, method, path without query, and status.
- Redaction covers authorization, cookies, `X-UtilityHub-Identity`, job tokens, upload tokens, generic tokens, and nested variants.
- Original filenames, storage keys, document content, and SQL values are not logged.
- Worker errors log ids and error codes; engine stderr stays server-side.

Evidence: `security.test.js` redaction test; live scan of Compose logs for `bearer`, `authorization`, `jobtoken`, `uploadtoken`, `x-utilityhub`, `password`, and `secret` returned no matches.

## 4. Dependency audit

Initial audit before Phase 10: 6 advisories (3 moderate, 3 high), all transitive:

| Package | Severity | Path | Resolution |
| --- | --- | --- | --- |
| `deepmerge-ts` | High | Prisma CLI config | Override to `8.0.2` |
| `minimatch` | Moderate | `archiver` → `readdir-glob` | Override to `11.0.9` |
| `readdir-glob` | Moderate | `archiver` | Resolved by minimatch override |
| `@prisma/config` | High | Prisma CLI | Resolved by deepmerge-ts override |
| `prisma` | High | Dev tooling | Resolved by deepmerge-ts override |
| `archiver` | Moderate | ZIP creation | Resolved by minimatch override |

After `npm install` with the overrides:

```text
backend: 0 vulnerabilities
frontend: 0 vulnerabilities
```

Prisma `migrate status`, `migrate deploy`, `generate`, and the full backend suite pass with the override, and ZIP outputs from split and PDF-to-images remain valid.

## 5. Malformed and hostile input results

| Input | Result |
| --- | --- |
| `../../Report.pdf` filename | Stored under a generated name; display name `Report.pdf` |
| Extension/signature mismatch | `422 MIME_MISMATCH` |
| Truncated PNG | `422 INVALID_FILE_SIGNATURE` |
| Truncated JPEG | `422 INVALID_FILE_SIGNATURE` |
| Corrupt PDF | `422 PDF_CORRUPTED` |
| 25 MB + 1 byte file | `413 FILE_TOO_LARGE` |
| 21 files | `400 TOO_MANY_FILES` |
| 501-page PDF | `422 PDF_PAGE_LIMIT` |
| 19 MB valid PDF | Accepted and stored |
| Shell metacharacters in arguments | Treated literally; no file created |
| 70 KiB JSON body | `413 REQUEST_TOO_LARGE` |
| Malformed JSON | `400 INVALID_JSON` |
| 31st upload in the rate window | `429 RATE_LIMITED` with `Retry-After` |

## 6. Filesystem and database failure results

| Failure | Behavior |
| --- | --- |
| Output file removed after completion | `503 STORAGE_UNAVAILABLE`, no path leak |
| Upload directory made read-only | `500 INTERNAL_ERROR`, no path leak, temp file removed |
| Prisma read fails once | `500 INTERNAL_ERROR`, no connection detail, next request succeeds |
| Worker killed during processing | Lease expires, job requeues, attempt 2 completes |
| Worker graceful shutdown | Active work aborts; lease recovery handles the job |

The database interruption test replaces one Prisma delegate call. The shared local MySQL container was not stopped during the suite. Recovery after a real process crash was exercised live, and expired-lease recovery uses the same database path that runs after a database restart.

## 7. Clean database migration

A temporary `utilityhub_migration_check` database was created, `prisma migrate deploy` applied `20261117112004_init`, and the resulting tables `File`, `Job`, `JobInput`, and `_prisma_migrations` were confirmed. The temporary database was then dropped.

## 8. Residual risks and limitations

| Risk | Severity | Why it remains |
| --- | --- | --- |
| Native decoder vulnerability in Ghostscript, Poppler, or Sharp | High if exploited | Engines are fixed versions run non-root with timeouts, pixel limits, no network, and no shell; local MVP accepts upstream decoder risk |
| Malicious document consumes CPU within the timeout | Medium | Timeouts and concurrency 2 bound damage but do not prevent slow work |
| In-memory rate limits | Low | Reset on API restart and are per process; documented for single-process MVP |
| Guest token theft through client XSS | Medium | CSP, React escaping, no third-party scripts, `sessionStorage`; XSS would still expose a live token |
| No malware scanning | Medium | Files are never executed as programs; downloads are attachments |
| PDF metadata may contain PII | Low | Metadata is preserved in outputs, not logged, and files are short-lived |
| Single-node filesystem | Medium | Local MVP only; no replication or object storage |
| No hard container memory or CPU limits | Low | Application limits and timeouts are enforced; Compose is a local profile |
| WordPress not verified against a live install | Informational | Plugin and signed-token contract are tested with controlled fixtures only |
| Rate limiting behind an untrusted proxy | Low | `X-Forwarded-For` is ignored unless `TRUST_PROXY` is explicitly enabled |

## 9. Verification checklist status

All 22 checks in `docs/SECURITY_DESIGN.md` section 14 were executed. Items not naturally covered by automated tests were executed live: worker `SIGKILL` recovery, Compose log inspection, API/frontend header inspection, and full-stack processing through the browser.

No open critical or high-severity issue remains.
