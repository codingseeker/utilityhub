# UtilityHub — Existing Project Audit

Audit date: 2026-11-18
Scope: `/home/blank04/projects/utilityhub` (pre-refactor state)
Auditor: implementation agent

## 1. Executive summary

The repository contains a complete, working **local-first** UtilityHub MVP built in an earlier phase. It has a React/Vite frontend, an Express API, a Node.js worker, MySQL 8.4 with Prisma, local-disk storage, six real PDF/image processing operations, a Vitest integration suite (76 tests reported passing), Docker Compose, and extensive documentation.

The product is functional but its architecture directly contradicts the new GCP cloud-first brief:

- Files are stored on a local filesystem volume, not Google Cloud Storage.
- Jobs are stored in MySQL and claimed with `FOR UPDATE SKIP LOCKED`, not Firestore.
- Authentication is optional WordPress HMAC identity with guest capability tokens; there is no Firebase Authentication.
- The only upload path is multipart to the API container; there is no signed-URL direct upload.
- Only PDF tools exist. The new brief requires photo, data, text, and utility tools.
- The UI is a soft, rounded, blue-accented dashboard. The new brief requires a Neo-Brutalist system.
- There is no GCP deployment, infrastructure, IAM, lifecycle, or budget material.
- The workspace is not a Git repository, so there is no rollback point.

## 2. Repository inventory (pre-refactor)

| Path | Purpose | Disposition |
| --- | --- | --- |
| `README.md` | Full local setup, API, limits, troubleshooting | Rewritten for GCP |
| `todo.md` | Previous local-MVP execution prompt | Left untouched as history |
| `docs/` | PRD, architecture, DB, API, processing, security, tech decisions, test report | Superseded by GCP docs; old files kept but marked superseded |
| `backend/prisma/` | MySQL schema + migration | Removed from runtime; retained history until cleanup |
| `backend/src/config/env.js` | Env parsing (MySQL, storage root, retention) | Replaced |
| `backend/src/database/prisma.js` | Prisma client | Removed |
| `backend/src/models/jobs`, `uploads`, `files` | Job creation, token auth, claiming, storage | Logic re-used conceptually; code replaced |
| `backend/src/modules/processing/` | Runner + six real operations | **Re-used** (real engine code) |
| `backend/src/utils/` | pages, pdfinfo, process spawn, filenames, zip, tokens | **Re-used / adapted** |
| `backend/src/worker.js`, `workers/cleanup.js` | MySQL queue worker + cleanup | Replaced by Cloud Run worker |
| `backend/tests/` | 9 files / 76 Vitest tests against MySQL | Replaced by GCP pipeline tests |
| `frontend/src/App.jsx`, `pages/`, `components/` | Two-page local UI | Refactored to cloud UI |
| `frontend/src/api.js` | Multipart upload client | Replaced by signed-URL client |
| `frontend/src/tools.js` | 6-tool catalog + helpers | Expanded catalog |
| `frontend/src/styles.css` | Soft blue/rounded design system | Replaced by Neo-Brutalist tokens |
| `docker-compose.yml`, `docker/` | MySQL + API + worker + Vite | Retained only as optional legacy local reference; not the cloud path |
| `wordpress/` | Optional WordPress HMAC identity plugin | Retired from the cloud path |
| `.env`, `.env.example` | MySQL/WordPress local secrets | Replaced by GCP env templates |

## 3. Existing tool implementation map

| Tool | Files | Engine | Reusable server-side? |
| --- | --- | --- | --- |
| Merge PDF | `processing/operations/merge-pdf.js` | pdf-lib 1.17.1 | Yes, as-is with path changes |
| Split PDF | `split-pdf.js` | pdf-lib + archiver | Yes |
| Compress PDF | `compress-pdf.js` | Ghostscript `pdfwrite` | Yes; requires `gs` in worker image |
| Rotate PDF | `rotate-pdf.js` | pdf-lib | Yes |
| Images to PDF | `images-to-pdf.js` | Sharp + pdf-lib | Yes |
| PDF to Images | `pdf-to-images.js` | Poppler `pdftoppm` + Sharp + archiver | Yes; requires `pdftoppm` in worker image |

Supporting logic that is genuinely reusable:

- `utils/pages.js` — strict page-range parsing and chunking.
- `utils/pdfinfo.js` — `pdfinfo` inspection, encryption/corruption detection, page-count verification.
- `utils/process.js` — `shell: false` argument-array process execution with timeout/output caps.
- `utils/filenames.js` — display-name sanitisation and extension mapping.
- `processing/artifact.js` — output validation (MIME, page count, ZIP entries).
- `processing/zip.js` — safe ZIP creation.
- `processing/engine.js` — engine failure normalisation.

No code is reused that depends on MySQL, Prisma, local disk paths, or Express request objects.

## 4. Existing API surface

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/operations` | None | Public catalog |
| POST | `/api/v1/uploads` | Optional identity | Multipart; streams to local disk |
| DELETE | `/api/v1/uploads/:fileId` | Upload token | |
| POST | `/api/v1/jobs` | Upload token per input | |
| GET | `/api/v1/jobs/:id` | Job token | |
| GET | `/api/v1/jobs/:id/download` | Job token | Streams from disk |
| DELETE | `/api/v1/jobs/:id` | Job token | |
| GET | `/api/v1/health/live`, `/ready` | None | |

All of this is replaced by the GCP API contract in `docs/API_CONTRACT.md`.

## 5. Data model (pre-refactor)

MySQL tables: `File`, `Job`, `JobInput`. Jobs use string status `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `EXPIRED`; 256-bit capability tokens stored as SHA-256 hashes; lease fields; expiry timestamps.

The new model uses Firestore collections `users`, `uploads`, `jobs`, and `usage`, with Firebase UID ownership and no bearer job tokens. Firestore security rules deny all client writes.

## 6. Design system (pre-refactor)

- Light-only, blue `#2457e6` accent, 18px radii, soft shadows, blurred sticky header.
- Fonts: system/Inter stack.
- Components: `Header`, `FileDropzone`, `FileList`, `JobPanel`, `ToolIcon`, `HomePage`, `ToolPage`.
- States: upload progress, queued, processing, success, failure, expiry. No auth state, no job history, no theme switching, no categories/search.

The component boundaries are sound and are preserved conceptually. The visual layer and state model are replaced.

## 7. Configuration and secrets

Current `.env` files contain local MySQL credentials and an optional WordPress HMAC secret. They are development values. No cloud credentials exist. The new deployment uses Secret Manager and runtime service accounts; no secret is committed.

## 8. Environment observations

| Item | Result |
| --- | --- |
| Node.js | v22.23.2 (satisfies `>=22.12 <23`) |
| npm | 10.9.8 |
| Ghostscript | `/usr/bin/gs` |
| Poppler `pdfinfo` / `pdftoppm` | `/usr/bin/pdfinfo`, `/usr/bin/pdftoppm` |
| Docker | Not required for GCP deployment path |
| Disk | ~57 GB free |
| Memory | ~15.6 GB total, ~12 GB available |
| Git | **Not a repository** |
| GCP credentials | Not present in workspace |
| Firebase project | Not configured |
| Existing `node_modules` | Present in `backend/`, `frontend/` |

## 9. Risks and blockers

| Risk | Impact | Mitigation |
| --- | --- | --- |
| No Git repository | No rollback point for a large refactor | Create a `.gitignore`; recommend `git init`; do not commit secrets |
| No GCP project/credentials in this environment | Cannot provision or deploy real infrastructure from here | Build and test against local adapters that exercise the same signed-URL/job contract; produce exact `gcloud` runbooks; do not claim a live deployment |
| Firebase Auth cannot be exercised without a project | Frontend auth cannot be browser-verified against real Google sign-in | Implement real Firebase SDK code; support an explicit development auth mode for local verification; document that live sign-in is unverified |
| Firestore/GCS emulators not installed | Cloud adapters cannot be integration-tested locally | In-memory job store and local HMAC-signed object store for tests; production adapters use official SDKs |
| Ghostscript/Poppler only in worker image | API image must stay small | Separate `Dockerfile.worker` with native engines |
| Existing tests assume MySQL | Old suite will fail after refactor | Replace suite with GCP-pipeline tests; report actual results |
| Text/CSV/JSON uploads widen the attack surface | Parser abuse, huge payloads | Size caps, UTF-8 validation, PapaParse limits, no code execution, bounded row counts |
| Local adapters could be mistaken for cloud | Misleading architecture | Hard startup failure if `NODE_ENV=production` uses `local`/`memory`/`dev` |
| Cloud Run request timeouts | Long PDF jobs could exceed HTTP limits | Worker processes one job per request and reports progress; Cloud Run Jobs mode for large jobs; document limits |
| Signed URL scope | Cross-user access | Keys are `uploads/{uid}/{uploadId}` and `results/{uid}/{jobId}`; API re-checks ownership before issuing any URL |

## 10. Starting point for the refactor

1. Preserve the six PDF processors and support utilities (`pages`, `pdfinfo`, `process`, `zip`, `artifact`).
2. Replace persistence with Firestore (production) and an in-memory adapter (tests only).
3. Replace storage with GCS signed URLs (production) and a locally simulated signed-URL object store (tests/dev only).
4. Add Firebase Authentication with mandatory sign-in for cloud jobs.
5. Add photo, data, and text operations plus client-side utilities.
6. Rebuild the frontend around the cloud job flow and the Neo-Brutalist design system.
7. Add infrastructure, deployment, security, and test documentation.
8. Never expose `local`/`memory`/`dev` modes in production.

## 11. Phase 0 acceptance criteria

| Criterion | Status |
| --- | --- |
| Existing work understood | Met — inventory and tool map recorded |
| Required tools and versions documented | Met — see §8 |
| No existing files overwritten during audit | Met — audit only |
| Missing dependencies identified | Met — GCP credentials, Firebase project, emulators absent |
| Clear implementation starting point | Met — see §10 |
