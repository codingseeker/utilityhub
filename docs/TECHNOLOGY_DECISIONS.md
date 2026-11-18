> **Superseded (2026-11-18).** This document describes the pre-GCP
> architecture (MySQL, Prisma, local disk, and/or WordPress identity). It is kept
> for traceability. See [docs/README.md](./README.md) for the current set.

# UtilityHub — Technology Decisions

Version: 1.0
Date: 2026-11-17
Format: decision records with context, alternatives, consequences, and verification

## 1. Decision summary

| Area | Decision | Version policy |
| --- | --- | --- |
| Runtime | Node.js 22 LTS | `>=22.12 <23` for the MVP |
| Backend framework | Express 5 | Pin `5.3.0` in the lockfile |
| Language | JavaScript, ESM | No TypeScript for application code |
| ORM and migrations | Prisma 6.19.3 | Pin CLI and client exactly |
| Database | MySQL 8.4, InnoDB, utf8mb4, UTC | Container `mysql:8.4` |
| Queue | MySQL table with `FOR UPDATE SKIP LOCKED` | No broker |
| Worker | Separate Node.js process, concurrency 2 | Same codebase |
| PDF manipulation | pdf-lib 1.17.1 | Pin |
| PDF compression | Ghostscript 10.05.1 | Host package; container package |
| PDF rendering | Poppler 25.07.0 `pdftoppm` | Host and worker image |
| Images | Sharp 0.35.5 | Pin |
| Archives | Archiver 8.0.0 | Pin |
| Validation | Zod 4.6.7 | Pin |
| Logging | Pino 10.4.0 with pino-http 11.0.0 | Pin |
| Frontend | React 19.3.1, Vite 8.3.8, React Router 7.18.5, plain CSS | Pin |
| Tests | Vitest 5.1.0, Supertest 7.3.2 | Pin |
| Containers | Docker Engine 29.9.2, Compose v5.6.0 | Local environment |
| WordPress | Optional identity provider | Plugin in `wordpress/utilityhub-identity`; signed-token contract tested with controlled fixtures |

Exact versions are locked during Phase 3. If the registry no longer serves a listed version, the replacement must be recorded here before implementation.

## 2. ADR-001: Modular monolith with separate API and worker

Context: The MVP has one domain, a small team, and a 15 GiB host. Heavy document work must not block HTTP traffic. The execution prompt forbids microservices.

Decision: One backend codebase with clear modules and two entrypoints, `server.js` and `worker.js`, sharing Prisma models, job services, and processing code. Two processes, one database, one storage volume.

Alternatives considered:

- Single process with in-process background work: rejected because a renderer crash or CPU spike would degrade the API.
- Microservices: rejected as unnecessary network and operational complexity.
- Serverless functions: rejected; local-only requirement and long-running native processes.

Consequences: Simple deployment and transactions. The API and worker must be deployed together when shared code changes. Storage must be shared. Concurrency is per worker process, not globally distributed.

Verification: API responds to status requests while two jobs run; killing the worker does not stop the API.

## 3. ADR-002: MySQL 8.4 as the only datastore

Context: The product needs durable jobs, file metadata, timestamps, ownership, and queue semantics. The prompt requires MySQL 8 plus Prisma.

Decision: MySQL 8.4 in Docker, InnoDB, `utf8mb4_0900_ai_ci`, UTC timestamps, Prisma schema and migrations. No Redis, document database, or search engine.

Alternatives considered:

- PostgreSQL: available on the host but contradicts the required stack and does not add needed capability.
- SQLite: simpler local file, but weak concurrent write behavior and not the required stack.
- Redis for queues: adds infrastructure without solving a demonstrated problem.

Consequences: `SELECT ... FOR UPDATE SKIP LOCKED` provides safe claims. Schema changes require migrations. The database volume and credentials must be managed. MySQL is isolated from any WordPress database.

Verification: `prisma migrate deploy` succeeds on a clean database; concurrent claim tests show one winner per job.

## 4. ADR-003: Database-backed job queue

Context: Jobs must survive API and worker restarts. The scale is modest. The prompt forbids Kafka, RabbitMQ, Redis, and microservices.

Decision: A `Job` table is the queue. Workers claim with a transaction, row lock, `SKIP LOCKED`, and a lease. Recovery runs on startup and every 60 seconds. Retries are capped at two attempts.

Alternatives considered:

- In-memory queue: explicitly rejected; loses jobs on restart.
- Redis or broker: operational overhead, additional failure modes, no need at this scale.
- MySQL `GET_LOCK`: session-scoped and harder to recover; row locks are simpler.

Consequences: Idle polling costs a small query per second. Very high throughput would need a different backend, but the API contract and job modules can remain. Claim safety depends on correct transaction code and tests.

Verification: Duplicate claim test with two workers; kill and restart test; lease expiry recovery test.

## 5. ADR-004: Files on local disk, metadata in MySQL

Context: Documents can reach tens of megabytes. MySQL row and backup costs make binary storage inappropriate. The prompt requires local filesystem storage.

Decision: Store files under a private storage root with generated keys. Store only metadata, hashes, and ownership references in MySQL. Abstract storage behind an interface.

Alternatives considered:

- BLOBs in MySQL: rejected for backup size, memory pressure, and streaming complexity.
- S3 or cloud object storage: forbidden by local-only constraints.
- Base64 in JSON: rejected; inflates size and memory.

Consequences: The storage volume must be shared between API and worker containers. Cleanup and orphan reconciliation are required. A future object store needs an adapter, not workflow changes.

Verification: Uploaded and generated files appear under generated keys; database contains no binary columns; download streams without full buffering.

## 6. ADR-005: Prisma 6.19.3 instead of Prisma 7/8

Context: The registry currently offers Prisma 7.10.1 as the latest stable client and 8.0.0-rc as `latest`. Prisma 7+ changes client generation, configuration, and driver adapters. The project requires plain JavaScript and a small local MVP.

Decision: Pin Prisma CLI and client to `6.19.3`, use the classic `mysql` provider, generate the client into `node_modules`, and run `prisma migrate`.

Alternatives considered:

- Prisma 7.10.1: viable but adds adapter and config churn and TypeScript-oriented peer requirements with no product benefit.
- Prisma 8 RC: pre-release; rejected for production paths.
- Knex or raw SQL: more control but loses schema and migration ergonomics.

Consequences: The team must track Prisma 6 maintenance. Upgrading later requires an explicit migration task. Raw SQL remains limited to queue operations, keeping most access typed.

Verification: `prisma generate`, `prisma migrate dev`, and `prisma migrate deploy` succeed; no adapter or TypeScript dependency is required.

## 7. ADR-006: pdf-lib for merge, split, rotate, and image composition

Context: These operations need page-level manipulation without rasterization. Candidate libraries include pdf-lib, HummusJS, and native tools.

Decision: Use pdf-lib for page copying, extraction, rotation, and image embedding. Validate inputs with signature checks and Poppler `pdfinfo`.

Alternatives considered:

- Ghostscript for every operation: loses control over page order and metadata, heavier, and less precise for rotation.
- HummusJS: native and less maintained.
- qpdf: not installed and not needed for these operations.

Consequences: pdf-lib is pure JavaScript and deterministic, but must load files into memory. Limits (25 MB per file, 150 MB per job) bound memory. Merge copies sequentially to avoid holding all sources at once.

Verification: Page order and rotation value assertions on real PDFs; memory observation during a 20-file merge within limits.

## 8. ADR-007: Ghostscript for compression

Context: pdf-lib cannot efficiently rewrite embedded images and streams for size reduction. Ghostscript is installed and provides presets.

Decision: Use Ghostscript `pdfwrite` with `-dSAFER`, a fixed argument array, a selected preset, an operation timeout, and output validation. If output is not smaller, return the original copy with `applied: false`.

Alternatives considered:

- Poppler `pdfimages` plus reconstruction: lossy control and complex.
- qpdf: not installed and not a compressor.
- ImageMagick: rasterizes and loses text quality.

Consequences: Ghostscript is a native dependency in the worker image. Its AGPL license must be reviewed before redistribution; for this local MVP it is invoked as a separate process. Output is a new file; inputs are unchanged.

Verification: Valid PDF with unchanged page count; honest size reporting; timeout kill test.

## 9. ADR-008: Poppler for PDF-to-image rendering

Context: Rendering quality, page control, and memory bounds matter. Candidates are Poppler, Ghostscript, and pdf.js.

Decision: Use `pdftoppm` with one page per invocation, `-png` or `-jpeg`, a DPI range of 72–200, page and pixel limits, and per-page timeout.

Alternatives considered:

- Ghostscript `png16m`: works but less precise control over naming and per-page isolation.
- pdf.js in Node: heavy, memory-hungry on complex PDFs.
- ImageMagick: delegates to Ghostscript anyway and adds policy surface.

Consequences: Process startup per page adds overhead but bounds memory and gives exact page selection. Rendering fonts not embedded in the PDF requires system fonts; install DejaVu and Liberation fonts in the worker image.

Verification: Rendered dimensions match DPI expectations; 101-page job rejected; large-page pixel budget test.

## 10. ADR-009: Sharp for image normalization

Context: Images to PDF accepts JPEG, PNG, WebP, and TIFF, with EXIF orientation and transparency.

Decision: Use Sharp for metadata, orientation, flattening, resizing, and JPEG normalization; embed the normalized JPEG with pdf-lib. Do not use ImageMagick.

Alternatives considered:

- ImageMagick CLI: broader policy and memory surface, extra process, weaker Node integration.
- Pure pdf-lib embedding: cannot handle WebP/TIFF, EXIF, or alpha safely.
- Browser-side canvas: inconsistent and shifts CPU to the client.

Consequences: Sharp is a native npm dependency with prebuilt binaries. Processing is sequential to limit memory. Multi-page and animated images are rejected in the MVP.

Verification: Mixed-format fixtures produce one page per image with correct order; corrupted image rejected; pixel cap enforced.

## 11. ADR-010: Express 5 and Multer 2

Context: The prompt requires Express and a streaming multipart solution. The API is small.

Decision: Express 5.3.0 with Multer 2.5.0 disk storage, explicit limits, and central error middleware. JSON bodies are capped at 64 KiB.

Alternatives considered:

- Fastify: faster but contradicts the required stack and adds plugin differences.
- Busboy directly: more control, more code; Multer wraps it adequately.
- Manual multipart parsing: rejected.

Consequences: Multer error codes require mapping to public errors. Express 5 handles rejected async handlers, simplifying controllers. Upload cleanup must be explicit on failure.

Verification: Partial upload test verifies no leftover files; malformed multipart returns a 400 envelope.

## 12. ADR-011: Zod for runtime validation

Context: Environment variables, request bodies, options, and page ranges need precise validation and safe messages.

Decision: Use Zod 4.6.7 for environment and request schemas, plus a dedicated page-range parser because the grammar is domain-specific. Map validation issues to field-level details.

Alternatives considered:

- Joi: mature but larger and less aligned with the rest of the codebase.
- JSON Schema plus Ajv: viable, more moving parts for request schemas.
- Manual checks: error-prone and inconsistent.

Consequences: Validation happens at the boundary; services receive validated values. Zod messages are internal unless explicitly mapped; public messages remain stable.

Verification: Invalid environment fails fast with a clear variable name; invalid options return `422` with field details.

## 13. ADR-012: Pino structured logging

Context: The worker and API need correlated, machine-readable logs without leaking documents.

Decision: Pino with JSON output; pino-http for request ids and durations; redaction of authorization and cookie headers; no request-body logging; no filenames.

Alternatives considered:

- Winston: heavier configuration.
- Console logs: unstructured and hard to redact.
- OpenTelemetry: unnecessary infrastructure for the MVP.

Consequences: Logs are grep-friendly and safe by default. Development readability is secondary; `pino-pretty` can be a dev-only tool.

Verification: Log inspection test asserts no tokens, names, paths, or content.

## 14. ADR-013: In-memory rate limiting

Context: The API runs as one process locally. The prompt forbids Redis.

Decision: Use `express-rate-limit` 8.7.4 with per-route and global limiters, standard headers, and `Retry-After`. Do not trust proxy headers by default.

Alternatives considered:

- Redis-backed limiter: adds forbidden infrastructure.
- Database counters: extra writes and contention.
- No limits: unacceptable for upload and processing endpoints.

Consequences: Limits reset on restart and are per process. A future multi-instance deployment needs a shared store. This is documented in the security and architecture documents.

Verification: Burst test returns 429 with the documented headers.

## 15. ADR-014: Archiver for ZIP outputs

Context: Split and PDF-to-image jobs may produce multiple artifacts.

Decision: Use Archiver 8.0.0 in-process with fixed entry names and no user paths. Store one ZIP artifact when more than one output exists. Use the ZIP only when required.

Alternatives considered:

- System `zip`: extra process and filename handling risk.
- `yazl`: viable but Archiver is mature and streaming.
- Multiple download endpoints: more API and UI complexity for the MVP.

Consequences: One artifact per job simplifies authorization and cleanup. Individual images are not retained outside the ZIP, which is a documented product behavior.

Verification: ZIP entry names and order; unzip readability; path traversal test on entry names.

## 16. ADR-015: React 19, Vite 8, React Router 7, plain CSS

Context: The interface has a homepage and six tool workspaces. It must be responsive and lightweight.

Decision: React with Vite, React Router for deep-linkable tool URLs, and plain CSS with variables. No component library, CSS framework, or global state library. Server state is fetched with a small API client; per-tool state stays local.

Alternatives considered:

- Next.js: server rendering is unnecessary for a local API-backed SPA.
- Tailwind: useful but adds build configuration; plain CSS suffices for six pages.
- Redux or React Query: unnecessary for a small workflow; polling is simple.

Consequences: More custom CSS and form code, but fewer dependencies and full control over layout. Accessibility and responsive behavior require deliberate implementation.

Verification: All six workflows at 360 px and 1440 px; route reload works; no console errors.

## 17. ADR-016: JavaScript with ESM, no TypeScript

Context: The prompt requires JavaScript and values a small dependency surface. Runtime validation is needed regardless.

Decision: Use ESM (`"type": "module"`) across backend and frontend, with Zod at boundaries. No TypeScript, no JSDoc type comments.

Alternatives considered:

- TypeScript: strong compile-time safety but contradicts the stated stack and adds configuration.
- CommonJS: incompatible with ESM-only `file-type` and less future-proof.

Consequences: Type mistakes are caught by tests and runtime validation rather than the compiler. `file-type` 22 and Vite work naturally. Import extensions must be explicit in Node ESM.

Verification: `node src/server.js` starts without transpilation; tests run directly with Vitest.

## 18. ADR-017: No code comments

Context: The project owner explicitly requires no comments in frontend or backend code. Maintainability comes from small modules, descriptive names, tests, and documentation.

Decision: Production and test code contain no line or block comments. Rationale and non-obvious behavior live in `docs/`. Configuration examples contain no commentary beyond unavoidable format constraints.

Alternatives considered:

- Minimal comments for tricky queue SQL: the SQL and documentation already explain it; code identifiers and tests carry intent.
- JSDoc: rejected under the same instruction.

Consequences: Reviewers must read the architecture documents. Code must be self-describing. Any temptation to explain behavior with a comment should become a clearer function name or a documentation update.

Verification: Code review grep for comment syntax in application and test files.

## 19. ADR-018: Vitest and Supertest for tests

Context: The backend is ESM, the frontend is Vite, and API tests need real HTTP semantics.

Decision: Vitest for unit and integration tests; Supertest for the Express app; real MySQL through Docker for persistence tests; generated real documents for processing tests.

Alternatives considered:

- Jest: heavier ESM configuration.
- Node test runner: viable but duplicates tooling already present through Vite.
- Mock-only processing tests: rejected; outputs must be verified with real parsers.

Consequences: Integration tests require a running test database and native engines. Tests must clean up storage and database rows. CI is not part of the local MVP.

Verification: Test suite runs against a clean migrated database and generates real PDFs and images.

## 20. ADR-019: Docker Compose for MySQL and application services

Context: MySQL must be reproducible and isolated from the host server. API and worker need the same native dependencies and storage.

Decision: Compose project with `db`, `api`, `worker`, and `web`, named volumes for MySQL and storage, health checks, UTC, and non-root application containers. Host development remains supported with only `db` in Compose.

Alternatives considered:

- Host MySQL: conflicts with an existing datadir and server configuration.
- Host-only development: fastest, but does not satisfy reproducible setup.
- Kubernetes: explicitly out of scope.

Consequences: The API and worker images include Ghostscript, Poppler, fonts, OpenSSL for Prisma, and Sharp. The storage volume must be shared. First run pulls the MySQL image.

Verification: Clean `docker compose up` reaches healthy services; migrations run; a full job completes through the containerized stack.

## 21. ADR-020: Deferred technologies

| Technology | Decision | Reason |
| --- | --- | --- |
| LibreOffice | Defer to Office conversion phase | Heavy, slow startup, not needed for six tools |
| Tesseract | Defer to OCR phase | Not installed and not in MVP |
| WordPress plugin | Implemented in `wordpress/utilityhub-identity` | Guest workflows remain independent; no live WordPress instance in this repository |
| Redis | Excluded | No demonstrated need; forbidden by scope |
| Object storage | Defer | Local filesystem required; adapter boundary exists |
| qpdf | Not adopted | Not installed; pdf-lib and Poppler cover MVP validation |
| ImageMagick | Not adopted | Sharp covers the required image operations with less process surface |
| FFmpeg | Not adopted | No media conversion in MVP |
| WebSockets | Not adopted | Polling is sufficient and simpler |

## 22. Licensing notes

| Component | License | Note |
| --- | --- | --- |
| Node.js | MIT | Runtime |
| Express | MIT | Backend |
| Prisma | Apache-2.0 | ORM |
| MySQL | GPL-2.0 with FOSS exception | Run as a separate service; not linked |
| Ghostscript | AGPL-3.0 | Separate process; review before redistribution |
| Poppler | GPL-2.0+ | Separate process; review before redistribution |
| pdf-lib | MIT | Pure JS |
| Sharp | Apache-2.0 | Native package |
| React, Vite, React Router | MIT | Frontend |
| Archiver | MIT | ZIP |
| Pino, Zod, Helmet, express-rate-limit | MIT | Backend utilities |

This is an engineering note, not legal advice. Redistribution or hosted commercial use requires a license review.

## 23. Native dependency installation

Fedora host:

```bash
sudo dnf install -y ghostscript poppler-utils fontconfig dejavu-sans-fonts liberation-fonts
```

Worker image (Debian slim):

```text
apt-get update
apt-get install -y --no-install-recommends ghostscript poppler-utils fontconfig fonts-dejavu-core fonts-liberation openssl ca-certificates
rm -rf /var/lib/apt/lists/*
```

Verification commands:

```bash
gs --version
pdftoppm -v
pdfinfo -v
node --version
npm --version
```

## 24. Environment configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | Environment | `development` |
| `PORT` | API port | `4000` |
| `DATABASE_URL` | MySQL connection | required |
| `CORS_ORIGINS` | Allowed frontend origins | `http://localhost:5173` |
| `STORAGE_ROOT` | Private storage root | `/app/var/storage` in containers |
| `LOG_LEVEL` | Pino level | `info` |
| `MAX_FILE_SIZE_MB` | Per-file limit | `25` |
| `MAX_FILES_PER_UPLOAD` | Upload count | `20` |
| `MAX_UPLOAD_TOTAL_MB` | Request size | `100` |
| `MAX_JOB_INPUT_MB` | Job input size | `150` |
| `MAX_PDF_PAGES` | Upload page limit | `500` |
| `MAX_MERGED_PAGES` | Merge output pages | `2000` |
| `MAX_SPLIT_PARTS` | Split parts | `20` |
| `PDF_TO_IMAGES_MAX_PAGES` | Render page limit | `100` |
| `MAX_IMAGE_MEGAPIXELS` | Input image pixels | `40` |
| `PDF_TO_IMAGES_MAX_PIXELS` | Per rendered page | `50000000` |
| `WORKER_CONCURRENCY` | Parallel jobs | `2` |
| `JOB_LEASE_SECONDS` | Lease length | `60` |
| `JOB_HEARTBEAT_SECONDS` | Renewal interval | `15` |
| `INPUT_RETENTION_MINUTES` | Upload retention | `60` |
| `OUTPUT_RETENTION_MINUTES` | Artifact retention | `60` |
| `JOB_METADATA_RETENTION_HOURS` | Expired metadata | `24` |
| `CLEANUP_INTERVAL_SECONDS` | Cleanup cadence | `300` |
| `STORAGE_MIN_FREE_MB` | Reserve | `2048` |
| `TRUST_PROXY` | Trust `X-Forwarded-For` | `false` |
| `VITE_API_BASE_URL` | Frontend API origin | `http://localhost:4000/api/v1` |

Secrets live in `.env`, which is ignored by Git. `.env.example` contains placeholders only.

## 25. Decision review triggers

Revisit these decisions when any of the following occurs:

- A second API instance is required, making in-memory rate limits and local leases insufficient.
- Sustained queue depth exceeds what one worker pool can drain.
- Object storage or multi-node deployment becomes a requirement.
- Prisma 6 reaches end of maintenance or a required database feature appears only in Prisma 7+.
- Redistribution requires a different PDF engine licensing posture.
- A future tool needs Office conversion, OCR, or large-document streaming beyond the current limits.
