> **Superseded (2026-11-18).** This document describes the pre-GCP
> architecture (MySQL, Prisma, local disk, and/or WordPress identity). It is kept
> for traceability. See [docs/README.md](./README.md) for the current set.

# UtilityHub — Environment Audit

Audit date: 2026-11-17 (Asia/Yangon, UTC+06:30)
Host: Fedora Linux 43 (Xfce), kernel `7.2.11-100.fc43.x86_64`, x86_64 virtualized host
Project path: `/home/blank04/projects/utilityhub`

## 1. Result

The host meets the requirements for the UtilityHub MVP. No blocking dependency is missing. All required document-processing engines for the six MVP tools are available natively. MySQL will run through Docker to avoid interfering with the installed host server.

## 2. Runtime and tooling

| Component | Installed | Required for MVP | Assessment |
| --- | --- | --- | --- |
| Node.js | `v22.23.2` | Yes | Satisfies Express 5, Vite 8, Vitest 5, Sharp 0.35, `file-type` 22 |
| npm | `10.9.8` | Yes | Sufficient; lockfile-based installs |
| npx | `10.9.8` | Optional | Available |
| pnpm / Yarn / Bun | Not installed | No | npm is the single package manager to avoid mixed lockfiles |
| Git | `2.56.0` | Recommended | Repository is not initialized |
| Docker Engine | `29.9.2` (`overlayfs`) | Yes | Daemon reachable; Docker root is `/home/blank04/.local/share/docker` (user-level daemon) |
| Docker Compose | `v5.6.0` | Yes | Current plugin syntax supported |
| MySQL client | `8.4.13` | Diagnostic only | `mysql`, `mysqladmin`, `mysqldump` available |

## 3. Database environment

| Check | Result |
| --- | --- |
| MySQL Community Server package | `mysql-community-server-8.4.13-10.fc43.x86_64` |
| Service state | `mysqld.service` is inactive and disabled |
| Existing data directory | `/var/lib/mysql` exists, last modified 2024-02-12 |
| Active listener on `3306` | None |
| Planned runtime | `mysql:8.4` container, host port `3307`, named volume `utilityhub_db_data` |

The host server is intentionally left untouched. The project uses an isolated container with its own credentials and volume so the pre-existing data directory cannot be modified or exposed.

## 4. Processing engines

| Engine | Version | Path | MVP use | Notes |
| --- | --- | --- | --- | --- |
| Ghostscript | `10.05.1` | `/usr/bin/gs` | Compress PDF | Ships with Fedora; `-dSAFER` available |
| Poppler `pdftoppm` | `25.07.0` | `/usr/bin/pdftoppm` | PDF to Images | PNG and JPEG rendering |
| Poppler `pdfinfo` | `25.07.0` | `/usr/bin/pdfinfo` | PDF validation, page count, encryption detection | Spawned with timeout |
| Poppler `pdftotext` | `25.07.0` | `/usr/bin/pdftotext` | Not used in MVP | Available for future text extraction |
| Sharp (npm) | `0.35.5` available | npm package | Image normalization for Images to PDF | Prebuilt binaries; no system dependency required |
| pdf-lib (npm) | `1.17.1` available | npm package | Merge, split, rotate, Images to PDF | Pure JavaScript |
| ImageMagick | `7.1.2-32` | `/usr/bin/magick` | Not used in MVP | Present but not selected as a primary engine |
| LibreOffice | `25.8.7.3` | `/usr/bin/libreoffice` | Future Office conversion | Not an MVP dependency |
| Tesseract | Missing | — | Future OCR | Not required for MVP |
| qpdf | Missing | — | Future PDF repair/linearization | Not required for MVP |
| `zip` / `unzip` | Present | `/usr/bin/zip`, `/usr/bin/unzip` | No | Archiving is done in-process with `archiver` |

`sharp` was not installed globally; the version shown is the current registry release and will be installed as a project dependency. Native binaries are only invoked with argument arrays and never through a shell.

## 5. Host resources

| Resource | Value | MVP relevance |
| --- | --- | --- |
| CPU | 12 logical cores | Worker concurrency limited to 2 to keep memory and CPU predictable |
| Memory | 15.3 GiB total (`16,423,677,952` bytes) | Sufficient for MySQL plus API plus bounded worker |
| Swap | 8.0 GiB, unused | Not relied upon |
| Disk | `/home` 247 GB total, 60 GB available (76% used) | Sufficient; storage quotas plus cleanup required |
| Open-file limit | 524,288 | No tuning required |
| Default `umask` | `0022` | Application must set `0077` and explicit file modes |
| Docker CPU/memory visibility | 12 CPUs, 15.3 GiB | Container limits can be applied without oversubscription |

Disk headroom is adequate but not unlimited. The design enforces per-file, per-request, and per-job size caps, plus a storage free-space guard before processing.

## 6. Network and ports

| Port | State | Planned use |
| --- | --- | --- |
| `53` | In use (system resolver, `127.0.0.53` and libvirt bridge) | Leave untouched |
| `5432` | In use (PostgreSQL) | Leave untouched |
| `8080` | In use | Leave untouched |
| `5355` | In use (systemd-resolved LLMNR) | Leave untouched |
| `631` | In use (CUPS) | Leave untouched |
| `3307` | Free | MySQL container published to host |
| `4000` | Free | Express API |
| `5173` | Free | Vite dev server |
| `4173` | Free | Vite preview (optional) |

Outbound connectivity:

| Endpoint | Result |
| --- | --- |
| `https://registry.npmjs.org/` | HTTP 200 |
| `https://registry-1.docker.io/v2/` | HTTP 401 without credentials (expected; registry reachable) |

Docker Hub is reachable but `mysql:8.4` is not in the local image cache. Cached images include `alpine`, `postgres`, `golang`, and unrelated project images. The MySQL pull is a one-time Phase 3 step.

## 7. Environment variables

Environment variable names were inspected without printing values. No project-relevant variables (`DATABASE_URL`, `MYSQL_*`, `PRISMA_*`, `NODE_ENV`, etc.) are defined in the shell. No secret values were exposed.

The project will ship a `.env.example` with placeholders and load configuration through a validated environment module. `.env` will be ignored by Git.

## 8. Version compatibility matrix

| Package or runtime | Planned version | Node 22.23.2 compatible | Notes |
| --- | --- | --- | --- |
| Express | `5.3.0` | Yes | Requires Node >= 18 |
| Prisma CLI and Client | `6.19.3` | Yes | Classic MySQL provider; pinned because Prisma 7/8 introduce driver-adapter and config changes not needed here |
| React / React DOM | `19.3.1` | Yes | Frontend only |
| Vite | `8.3.8` | Yes | Requires Node ^20.19 or >= 22.12 |
| `@vitejs/plugin-react` | Current 5.x at install time | Yes | Pin in lockfile |
| Vitest | `5.1.0` | Yes | Requires Node ^22.12 or newer |
| Supertest | `7.3.2` | Yes | API integration tests |
| Multer | `2.5.0` | Yes | Streaming multipart with disk storage |
| `file-type` | `22.3.0` | Yes | ESM-only; backend is ESM |
| Sharp | `0.35.5` | Yes | Requires Node >= 20.9 |
| pdf-lib | `1.17.1` | Yes | Pure JavaScript |
| Archiver | `8.0.0` | Yes | ZIP generation without a shell |
| Pino / pino-http | `10.4.0` / `11.0.0` | Yes | Structured JSON logs |
| Helmet | `8.3.0` | Yes | Security headers |
| `express-rate-limit` | `8.7.4` | Yes | In-memory limiter for a single API process |
| Zod | `4.6.7` | Yes | Environment, request, and option validation |
| dotenv | `18.0.10` | Yes | Local `.env` loading |

Versions are pinned in `package-lock.json` during Phase 3. If a listed major version cannot be installed reproducibly, the substitute must be recorded in `docs/TECHNOLOGY_DECISIONS.md` before use.

## 9. Missing or deferred dependencies

| Dependency | Status | Decision |
| --- | --- | --- |
| MySQL Docker image | Not cached | Pull in Phase 3 |
| Tesseract OCR | Not installed | Out of MVP scope |
| qpdf | Not installed | Not needed; pdf-lib and Poppler cover MVP validation |
| LibreOffice in worker | Installed on host, optional in container | Deferred until Office conversion |
| WordPress | Not installed locally | Optional identity provider; plugin and signed-token contract implemented, guest workflow works without it |
| Redis / message broker | Not installed | Intentionally excluded; database-backed queue |
| Nginx | Not installed | Not required for local MVP; Vite dev/preview serves the frontend |

## 10. Operational notes

- The Docker daemon is user-level; project commands must run as `blank04`, not root.
- Containers share a named storage volume because the API writes uploads and the worker reads them.
- The host `pdftoppm`, `gs`, and `pdfinfo` versions are recent; the worker container will pin equivalents through `ghostscript` and `poppler-utils` packages so behavior is reproducible.
- Time synchronization and locale are adequate; all persisted timestamps are UTC.
- No cloud services, external processing APIs, or third-party accounts are required or permitted.

## 11. Phase 0 conclusion

All Phase 0 minimum acceptance criteria are satisfied:

- Existing work is understood: only `todo.md` exists.
- Required tool and runtime versions are documented.
- No existing files were overwritten.
- Missing dependencies are identified with a resolution plan.
- A clear starting point exists: documentation first, then Phase 3 scaffolding.

There are no blockers to Phases 1 and 2.
