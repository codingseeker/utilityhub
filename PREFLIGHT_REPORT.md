# UtilityHub — GCP Deployment Pre-Flight Report

**Audit date:** 2026-11-22  
**Repository:** `/home/blank04/projects/utilityhub`  
**Branch:** `main`  
**HEAD:** `9e65dbe Initial commit: UtilityHub complete`  
**Auditor stance:** Read-only. No application code, configuration, or infrastructure was changed. No deployment was performed. A GCP project/credentials were not available, so cloud-side IAM/runtime behavior is inferred from the checked-in configuration and is marked as such.

---

## 1. Executive Verdict

**Status: NOT READY TO DEPLOY.**

The application builds, tests pass, containers build, production guardrails work, and the documented Cloud Build path is largely coherent. However, there are deployment blockers and high-risk gaps:

| # | Severity | Finding |
|---|---|---|
| 1 | **Blocker** | Working tree is dirty: 19 modified files and 3 untracked paths. There is no clean commit to deploy or roll back to. |
| 2 | **Blocker** | GCS soft delete is not disabled. New buckets default to 7-day soft-delete retention; the lifecycle rules only delete live objects, so deleted objects can remain billable. Docs claim soft delete is disabled. |
| 3 | **Blocker / High risk** | The Cloud Build service account is not granted Firebase Rules or Firestore index permissions, but `cloudbuild.yaml` deploys `firestore:rules,firestore:indexes`. This is expected to fail with `403` and abort the Hosting deploy step. |
| 4 | **Requirement mismatch** | The brief requires `us-central1`; the repo consistently uses `asia-southeast1` for GCS, Firestore, Cloud Run, Artifact Registry, and the Hosting rewrite. If `us-central1` is mandatory, this is a blocker and all regions must change together. |
| 5 | **Requirement mismatch** | `frontend/.env.production` does not exist. Cloud Build injects the `VITE_*` values directly, so the pipeline can still build, but a manual `npm run build` produces an unconfigured frontend. |
| 6 | **Risk** | Signed upload URLs do not enforce a maximum object size. Size limits are checked after upload and before job creation, allowing temporary oversized-object storage costs. |
| 7 | **Risk** | The API triggers the worker with an 8-second HTTP timeout, while jobs may run for up to 15 minutes. Long jobs can outlive the trigger request, creating lease/retry risk. |
| 8 | **Hygiene** | Production CORS and the built `index.html` meta CSP still include `localhost`; the frontend Dockerfile runs the Vite dev server rather than a production static server. |

---

## 2. Git & Repository Hygiene

### 2.1 Working tree — FAIL

Command:

```bash
git status --porcelain=v1
```

Result: 19 modified files + 3 untracked paths = 22 entries.

```
 M README.md
 M docs/FRONTEND_ARCHITECTURE.md
 M docs/README.md
 M docs/TEST_REPORT.md
 M docs/TOOL_INVENTORY.md
 M frontend/index.html
 M frontend/package-lock.json
 M frontend/package.json
 M frontend/src/App.jsx
 M frontend/src/api.js
 M frontend/src/components/FileDropzone.jsx
 M frontend/src/components/FileList.jsx
 M frontend/src/components/StatusBadge.jsx
 M frontend/src/components/ToolIcon.jsx
 M frontend/src/pages/BrowsePage.jsx
 M frontend/src/pages/HomePage.jsx
 M frontend/src/pages/ToolPage.jsx
 M frontend/src/styles.css
 M frontend/src/tools.js
?? frontend/scripts/
?? frontend/src/pages/LocalToolPage.jsx
?? frontend/src/services/
```

These are the client-side DOCX/PPTX changes from the preceding task. They must be reviewed, committed, and given a tag/SHA before deployment. Deploying from a dirty tree makes rollback and reproducibility impossible.

### 2.2 Ignored secrets — PASS

`.gitignore` (lines 1–7):

```
node_modules/
dist/
var/
.env
.env.*
!.env.example
!.env.test.example
```

`git check-ignore -v` results:

```
.env                       -> .gitignore:4:.env
backend/.env               -> .gitignore:4:.env
backend/.env.test          -> .gitignore:5:.env.*
frontend/.env.production   -> .gitignore:5:.env.*   (hypothetical; file is missing)
```

No tracked credentials, service-account JSON, `.pem`, or `.key` files were found. Only example files are tracked:

```
.env.example
backend/.env.example
backend/.env.test.example
frontend/.env.example
```

### 2.3 Tracked build/dependency directories — PASS

```
node_modules=0  dist=0  var=0
```

No `node_modules/`, `dist/`, or local `var/` files are tracked.

---

## 3. Frontend Build & Environment

### 3.1 Production build — PASS (build only)

Command:

```bash
cd frontend && npm run build
```

Result: exit 0.

```
vite v8.3.8 building client environment for production...
✓ 340 modules transformed.
dist/index.html                                    1.85 kB │ gzip:   0.86 kB
dist/assets/index-Dckccfuw.css                    39.03 kB │ gzip:   7.96 kB
dist/assets/index-DFUZchDx.js                    428.93 kB │ gzip: 129.19 kB
✓ built in 276ms
```

The build succeeds. However, this local build was made **without** `frontend/.env.production`, so it is not a deployable production bundle for auth/API configuration. Cloud Build supplies the values separately (see 3.3).

### 3.2 `dist/` scan — WARN

No application API endpoint is hardcoded to `localhost`:

```
JS files containing "localhost": 1
dist/assets/index-DFUZchDx.js
```

Those two `localhost` occurrences are internal Firebase Auth SDK constants (`http://localhost`), not UtilityHub API calls:

```
... var ua = `http://localhost` ...
... L = `http://localhost` ...
```

No `127.0.0.1`, `:4000`, or `:5173` occurrences were found in JS assets.

The built HTML still contains the development CSP:

```
frontend/dist/index.html:20:
connect-src 'self' ws: wss: http://localhost:4000 http://127.0.0.1:4000 ...
```

Source: `frontend/index.html:20`. This is a stale development allowance. Production hosting sets a stricter CSP via `firebase.json:24`; browsers combine both policies, so the production header still restricts `connect-src`. It is a hygiene issue, not a runtime blocker.

The bundle also contains dev-auth path strings:

```
1 × utilityhub.dev.user
2 × X-Dev-User
```

Source: `frontend/src/context/AuthContext.jsx:21,24,170`. These strings are present in every build because the dev-auth branch is bundled. They do not make production dev-auth active:

- Cloud Build sets `VITE_AUTH_MODE=firebase` (`cloudbuild.yaml:176`).
- Without that variable and without Firebase config, a production build resolves to `unconfigured`, not `dev` (`AuthContext.jsx:23-30`).
- The backend refuses `AUTH_MODE=dev` when `NODE_ENV=production` (`backend/src/config/env.js:94-113`).

### 3.3 `frontend/.env.production` — FAIL (requirement), mitigated by Cloud Build

```
$ test -f frontend/.env.production && echo exists || echo MISSING
MISSING
```

The file is correctly covered by `.gitignore`, but it does not exist. The Cloud Build pipeline does inject the required values:

```yaml
# cloudbuild.yaml:174-180
env:
  - VITE_API_BASE_URL=/api/v1
  - VITE_AUTH_MODE=firebase
  - VITE_FIREBASE_API_KEY=${_FIREBASE_API_KEY}
  - VITE_FIREBASE_AUTH_DOMAIN=${_FIREBASE_AUTH_DOMAIN}
  - VITE_FIREBASE_PROJECT_ID=$PROJECT_ID
  - VITE_FIREBASE_APP_ID=${_FIREBASE_APP_ID}
  - VITE_FIREBASE_MESSAGING_SENDER_ID=${_FIREBASE_MESSAGING_SENDER_ID}
```

So the Cloud Build path is viable, but the explicit audit requirement is not met and manual builds are unsafe. A committed `.env.production.example` with placeholders would be the safer pattern.

Note: the repo uses `VITE_API_BASE_URL` (documented in `frontend/.env.example:6`), not `VITE_API_URL`. `frontend/src/api.js:3` defaults to `/api/v1`, which is correct for the Firebase Hosting `/api/**` rewrite.

### 3.4 Frontend Dockerfile — WARN

`frontend/Dockerfile:18`:

```dockerfile
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

This is a Vite development server image, not a production static server. It is used by `docker-compose.yml` for local development. The GCP deployment path does **not** use this image; `cloudbuild.yaml` runs `npm run build` and deploys `frontend/dist` through Firebase Hosting. Mark it as local-only and do not deploy it to Cloud Run.

### 3.5 Automatic upload on load — PASS

Uploads are started only from the explicit form-submit handler (`frontend/src/pages/ToolPage.jsx:291-315`). No `useEffect` calls `uploadJobFiles`, `initUploads`, or `fetch` to upload on page load. Local DOCX/PPTX tools process files in-browser and never call the upload path.

---

## 4. Backend API Readiness

### 4.1 Tests — PASS

Command:

```bash
cd backend && npm test
```

Result: exit 0.

```
Test Files  5 passed (5)
Tests       42 passed (42)
Duration    3.01s
```

### 4.2 Required backend environment variables

The authoritative schema is `backend/src/config/env.js`. Production values used by `cloudbuild.yaml`:

| Variable | Required in production | Notes |
|---|---|---|
| `NODE_ENV` | Yes | Must be `production`; set by Dockerfile (`backend/Dockerfile:4`). |
| `PORT` | Injected | Cloud Run sets it; app listens on `config.port` (`server.js:9`). Dockerfile default `8080`. |
| `GCP_PROJECT_ID` | **Yes** | Must not be `utilityhub-local`. Used by Firestore/GCS/Firebase Admin (`env.js:26`). |
| `GCS_BUCKET` | **Yes** | Must not be `utilityhub-local` (`env.js:27`). |
| `FIRESTORE_DATABASE_ID` | Recommended | Defaults to `(default)` (`env.js:28`). |
| `STORAGE_DRIVER` | **Yes** | Must be `gcs` (`env.js:29,96`). |
| `DB_DRIVER` | **Yes** | Must be `firestore` (`env.js:30,97`). |
| `AUTH_MODE` | **Yes** | Must be `firebase` (`env.js:31,98`). |
| `CORS_ORIGINS` | **Yes** | Must be HTTPS origins in production (`env.js:120-122`). |
| `PUBLIC_API_URL` | Recommended | Cloud Build sets it to the Hosting origin. |
| `WORKER_URL` | **Yes** | Worker OIDC audience and trigger target. |
| `WORKER_SHARED_SECRET` | Recommended | Mounted from Secret Manager; defense in depth on top of OIDC. |
| `TRUST_PROXY` | Recommended | Set `true` behind Cloud Run/Firebase Hosting. |
| `SIGNED_URL_SECRET` | No when using GCS | Only required for the local storage driver (`env.js:101-108`). |

The names in the audit brief are slightly different from the implementation. This repo expects **`GCP_PROJECT_ID`** and **`FIRESTORE_DATABASE_ID`**, not `GCP_PROJECT` or `FIRESTORE_DATABASE`. Setting the latter names would be silently ignored.

Optional operational variables (quotas, retention, limits, timeouts, worker tuning) are listed in `backend/.env.example` and `backend/src/config/env.js:38-80`.

### 4.3 Production guardrail — PASS

Both API and worker containers start with `NODE_ENV=production` (`backend/Dockerfile:4`, `backend/Dockerfile.worker:5`). With zero cloud environment variables, both crash immediately at import time:

```
Error: Refusing to start in production with local-only configuration:
STORAGE_DRIVER must be gcs; DB_DRIVER must be firestore; AUTH_MODE must be firebase;
GCS_BUCKET must be configured; GCP_PROJECT_ID must be configured;
SIGNED_URL_SECRET must be configured
    at file:///app/src/config/env.js:110:11
EXIT_CODE=1
```

Guard source: `backend/src/config/env.js:94-113`. No silent fallback to memory/local/dev mode occurs in production.

### 4.4 Docker build and `$PORT` — PASS

Docker availability:

```
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.0
```

API build:

```bash
docker build -f backend/Dockerfile -t utilityhub-api:preflight backend
```

Exit 0; image `utilityhub-api:preflight` created. Image config:

```
ENV ... NODE_ENV=production PORT=8080
CMD ["node","src/server.js"]
EXPOSED {"8080/tcp":{}}
```

`$PORT` behavior was verified by running the API with `PORT=8123`:

```bash
docker run -e NODE_ENV=development -e PORT=8123 ... -p 8123:8123 utilityhub-api:preflight
curl http://127.0.0.1:8123/api/v1/health/live
```

Response:

```json
{"data":{"status":"ok","service":"utilityhub-api","version":"2.0.0"},"requestId":"..."}
```

Log:

```json
{"level":30,...,"port":8123,"store":"memory","storage":"local","auth":"dev","inlineWorker":true,"msg":"utilityhub api listening"}
```

Cloud Run's injected `PORT` will therefore be honored.

---

## 5. Worker Readiness & Guardrails

### 5.1 Worker Docker build — PASS

```bash
docker build -f backend/Dockerfile.worker -t utilityhub-worker:preflight backend
```

Exit 0; image `utilityhub-worker:preflight` created.

```
ENV ... NODE_ENV=production PORT=8080
CMD ["node","src/worker.js"]
EXPOSED {"8080/tcp":{}}
```

### 5.2 Zero-cloud-env crash — PASS

```bash
docker run --rm --network none utilityhub-worker:preflight
```

Result: immediate crash, exit code 1, with the explicit production refusal shown in 4.3. This satisfies the requirement that zero cloud environment variables must not silently start an unsafe local worker.

### 5.3 Worker environment required to start

Minimum to pass the production guard:

- `NODE_ENV=production` (baked into the image)
- `GCP_PROJECT_ID`
- `GCS_BUCKET`
- `STORAGE_DRIVER=gcs`
- `DB_DRIVER=firestore`
- `AUTH_MODE=firebase`

For the worker HTTP service in Firebase auth mode:

- `WORKER_URL` — required as the OIDC token audience (`backend/src/lib/auth.js:80-95`)
- `WORKER_SHARED_SECRET` — optional additional check (`backend/src/lib/auth.js:84-89`)
- `WORKER_POLL=false` — required for request-driven, scale-to-zero behavior
- `PORT` — injected by Cloud Run; defaults to `8080`

For the cleanup job (`node src/worker.js --cleanup`), the same cloud driver variables are required; `WORKER_URL`/polling are not.

### 5.4 Polling and scale-to-zero behavior — PASS for the checked-in pipeline, WARN on defaults

- API does not start an inline worker in production: `backend/src/app.js:24` requires `!config.isProduction`.
- API does not poll: job triggering is request-driven (`backend/src/lib/services/jobs.js:30-63`).
- Worker service is deployed with `WORKER_POLL=false` (`cloudbuild.yaml:83`), `--min-instances 0` (`cloudbuild.yaml:81`), and request-driven `/internal/run`.
- Cleanup runs as a daily Cloud Run Job, not a permanently running process (`cloudbuild.yaml:138-155`, `infra/setup-gcp.sh:176-199`).
- API Cloud Run also uses `--min-instances 0` (`cloudbuild.yaml:133`).
- The only backend `setInterval` is the lease heartbeat inside an actively processing job (`backend/src/lib/processing/runner.js:65`), not an idle loop.
- The only indefinite loop is the worker poll loop, which is disabled by `WORKER_POLL=false` (`backend/src/worker.js:64-72,96`).

**WARN:** `WORKER_POLL` defaults to `true` in the schema (`backend/src/config/env.js:40`). A manual worker deployment that supplies cloud credentials but forgets `WORKER_POLL=false` will poll every 2 seconds and consume CPU. The checked-in Cloud Build command is correct, but there is no production guard that forces polling off.

### 5.5 API → worker trigger timeout — WARN

`backend/src/lib/services/jobs.js:42` and `:58` use an 8-second timeout:

```js
signal: AbortSignal.timeout(8000)
// and
timeout: 8000
```

Jobs can run for up to `WORKER_RUN_BUDGET_MS` (default 480,000 ms) and the worker service has `--timeout 900`. A job taking longer than 8 seconds can outlive the API's trigger request. Depending on Cloud Run request-cancellation behavior this can cause a canceled worker request, lease expiry, and retry. This should be validated in staging and likely needs either a fire-and-forget trigger or a longer timeout.

---

## 6. Cost-Safety & Upload Limits

### 6.1 File-size limits — PASS with a signed-URL caveat

Limits are enforced in multiple places:

- Per-file: `MAX_FILE_SIZE_MB=25` (`backend/src/config/env.js:54`), checked at upload-session init (`jobs.js:611-617`) and before job creation after upload (`jobs.js:284-286`).
- Per-job total: `MAX_JOB_INPUT_MB=100` (`env.js:55`), checked at session init (`jobs.js:193-199`) and job creation (`jobs.js:328`).
- Daily quota: `QUOTA_BYTES_PER_DAY_MB=500`, `QUOTA_JOBS_PER_DAY=50` (`env.js:67-68`).
- Active-job cap: `MAX_ACTIVE_JOBS=3` (`env.js:69`).
- Content validation: actual downloaded file size and signature are checked before processing (`backend/src/lib/operations/validate-file.js:36-56`).
- Quota accounting uses verified actual bytes at job creation (`jobs.js:328,367`), not client-declared bytes.

**Caveat:** GCS signed upload URLs are created without `x-goog-content-length-range` or an equivalent size restriction (`backend/src/lib/storage/gcs.js:23-38`). A client can declare a small `sizeBytes` at init, then upload a much larger object directly to GCS. The API rejects it later at job creation, and cleanup removes it, but the object can temporarily consume storage. Add a signed `x-goog-content-length-range` header (or use a resumable session with a size limit) to close this gap.

### 6.2 No automatic frontend uploads — PASS

Confirmed in 3.5.

### 6.3 GCS lifecycle — PASS (live objects)

`infra/gcs-lifecycle.json`:

- `uploads/` — delete after 1 day
- `results/` — delete after 1 day
- `tmp/` — delete after 1 day
- `staging/` — delete after 7 days

Application cleanup is more aggressive: uploads expire after 6 hours, results after 24 hours (`backend/src/config/env.js:59-60`), via the daily cleanup job. This is a reasonable cost backstop for live objects.

---

## 7. Infrastructure Configuration

### 7.1 Firestore indexes — PASS (definition)

`infra/firestore.indexes.json` exists with 8 compound indexes. Every compound query in `backend/src/lib/store/firestore.js` is covered:

| Query | Fields | Index |
|---|---|---|
| Expired pending uploads (`:92-94`) | `status`, `expiresAt` | `uploads` index (lines 53-58) |
| Claim queued job (`:119-121`) | `status`, `createdAt ASC` | `jobs` index (lines 4-9) |
| Expired processing leases (`:228-230`) | `status`, `leaseExpiresAt` | `jobs` index (lines 20-25) |
| User job history (`:278-280`) | `uid`, `createdAt DESC` | `jobs` index (lines 28-33) |
| Count active jobs (`:287-289`) | `uid`, `status` | `jobs` index (lines 36-41) |
| Delete terminal jobs (`:300-302`) | `uid`, `status` | `jobs` index (lines 36-41) |
| Expired jobs (`:312-314`) | `status`, `expiresAt` | `jobs` index (lines 12-17) |
| Old jobs (`:321-322`) | `createdAt` | Single-field automatic index |
| Uploads by user/status | `uid`, `status` | `uploads` index (lines 61-66) |

The extra `uid + status + createdAt` index is harmless.

`firebase.json:68-71` points to the rules/index files, and `cloudbuild.yaml:191-194` includes `firestore:rules,firestore:indexes` in the deploy command.

### 7.2 Firestore rules — PASS

`infra/firestore.rules` denies all client reads/writes. All access goes through the Admin SDK in the API.

### 7.3 Cloud Build Firestore deploy permissions — HIGH RISK / likely blocker

`cloudbuild.yaml:191-194` deploys both Hosting and Firestore rules/indexes in one command. The Cloud Build service account is granted (`infra/setup-gcp.sh:102-108`):

```
roles/run.admin
roles/iam.serviceAccountUser
roles/artifactregistry.writer
roles/storage.admin
roles/cloudbuild.builds.builder
roles/firebasehosting.admin
roles/firebase.viewer
```

It is **not** granted Firebase Rules admin or Firestore index permissions. Deploying `firestore:rules` and `firestore:indexes` normally requires permissions equivalent to:

- `roles/firebaserules.admin` for rules releases
- `roles/datastore.owner` (or a custom role with index create/update permissions) for indexes

`roles/firebase.viewer` is read-only. Because the Hosting deploy is in the same `firebase deploy` invocation, a Firestore permission failure can abort the entire step, including Hosting. This could not be executed without a GCP project, but it is a clear configuration gap. The setup script’s “deploy later” fallback does not fix the Cloud Build pipeline itself.

### 7.4 Region — FAIL against the stated `us-central1` requirement

The repo consistently uses `asia-southeast1`:

- `infra/setup-gcp.sh:19` — `REGION="${REGION:-asia-southeast1}"`
- `cloudbuild.yaml:13` — `_REGION: asia-southeast1`
- `firebase.json:10` — Hosting rewrite target region `asia-southeast1`
- `docs/GCP_DEPLOYMENT.md:15-20` — all components `asia-southeast1`
- `infra/setup-gcp.sh:132` — GCS bucket `--location "${REGION}"`

If `us-central1` is mandatory, changing only the bucket would place GCS, Firestore, Cloud Run, and Artifact Registry in different regions, adding latency and cross-region egress. Change all regions together and update the Hosting rewrite. If `asia-southeast1` is acceptable, this requirement should be explicitly waived.

### 7.5 GCS bucket soft delete — FAIL

`infra/setup-gcp.sh:129-136` creates the bucket with region, uniform access, and public-access prevention, but **does not set `--soft-delete-duration`**:

```bash
gcloud storage buckets create "gs://${BUCKET}" \
  --location "${REGION}" \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file="${SCRIPT_DIR}/gcs-lifecycle.json"
```

New GCS buckets have soft delete enabled by default with a 7-day retention period. Lifecycle deletion moves objects to the soft-deleted state; those bytes can remain billable. The docs claim otherwise:

```
docs/GCP_INFRASTRUCTURE.md:68:
- Versioning disabled (privacy and cost); soft delete disabled or 7 days maximum.
```

That claim is not implemented. This is both a cost risk and a documentation mismatch. The bucket creation/update path should explicitly set the soft-delete duration (for example to `0` to disable it) and the existing bucket should be updated if it was already created.

### 7.6 Other infrastructure notes — WARN

- Production bucket CORS includes the local development origin by default (`infra/setup-gcp.sh:143` with `LOCAL_ORIGIN="${LOCAL_ORIGIN:-http://localhost:5173}"`). Scope this to the Hosting origin in production.
- `roles/storage.admin` is granted project-wide to the build service account (`setup-gcp.sh:105`). This is broader than necessary; least privilege would scope it to the bucket.
- `firebase.json:24` has a production-safe CSP, but the source/built HTML meta CSP still lists localhost (3.2). Consider removing the meta CSP entirely or making it environment-aware.
- The frontend Docker build reported `6 high severity vulnerabilities` from `npm ci` (development dependency tree). This is not a GCP deployment blocker but should be reviewed before release.

---

## 8. Deployment Blockers and Recommended Actions

No fixes were applied. The following actions are recommended before deployment:

### P0 — must fix

1. **Commit or stash the working tree.** Review the DOCX/PPTX changes, commit them, and deploy from a clean SHA. Add a tag for rollback.
2. **Disable GCS soft delete explicitly.** Add `--soft-delete-duration=0` (or a documented, intentional short duration) to bucket creation/update in `infra/setup-gcp.sh`, and update any existing bucket.
3. **Fix Cloud Build Firestore deploy permissions.** Grant the build SA the required Firebase Rules/Firestore index roles, or split `deploy-hosting` into Hosting-only and a separately authorized Firestore rules/index deploy.
4. **Resolve the region requirement.** If `us-central1` is mandatory, change `infra/setup-gcp.sh:19`, `cloudbuild.yaml:13`, `firebase.json:10`, and the deployment docs together. Do not move only GCS.

### P1 — should fix before production

5. **Add `frontend/.env.production` handling.** Either provide it in the deploy environment (never commit secrets/real config) or add a committed `.env.production.example` and document that Cloud Build injects the real values. The current missing-file state fails the stated audit criterion.
6. **Enforce upload size at the signed URL.** Add `x-goog-content-length-range` (or equivalent) to `GcsObjectStore.createUploadUrl` so oversized PUTs are rejected at GCS, not after upload.
7. **Review the 8-second worker trigger timeout.** Ensure jobs longer than 8 seconds cannot be canceled or retried unexpectedly; use a fire-and-forget/OIDC trigger or align the timeout with the worker budget.
8. **Harden `WORKER_POLL`.** Consider refusing `WORKER_POLL=true` when `NODE_ENV=production` unless explicitly intended, or document it as a required Cloud Run setting.

### P2 — hygiene

9. Remove `http://localhost:4000` / `http://127.0.0.1:4000` from the production CSP path.
10. Remove the localhost origin from production bucket CORS.
11. Clarify that `frontend/Dockerfile` is a local development image, not a deployable production frontend; the production frontend is Firebase Hosting.
12. Scope the build SA’s `roles/storage.admin` to the bucket if feasible.

---

## 9. Check Summary

| Area | Result |
|---|---|
| Git working tree clean | **FAIL** (22 entries) |
| `.env` / `.env.*` ignored | **PASS** |
| No tracked secrets | **PASS** |
| No tracked `node_modules` / `dist` / `var` | **PASS** |
| Frontend production build | **PASS** |
| `dist` hardcoded API endpoints | **PASS** (only Firebase SDK `http://localhost` constants) |
| `dist` localhost CSP | **WARN** |
| `frontend/.env.production` | **FAIL** (missing; Cloud Build injects values) |
| Backend tests | **PASS** (42/42) |
| Backend production env guard | **PASS** |
| Backend Docker build | **PASS** |
| `$PORT` honored | **PASS** (verified on 8123) |
| Worker Docker build | **PASS** |
| Worker zero-env crash | **PASS** (explicit error, exit 1) |
| API scale-to-zero / no idle polling | **PASS** (checked-in pipeline) |
| Worker scale-to-zero | **PASS** (`WORKER_POLL=false`, min 0) |
| Frontend auto-upload on load | **PASS** (none) |
| Backend upload limits | **PASS** with signed-URL **WARN** |
| Firestore compound indexes | **PASS** (all queries covered) |
| Firestore rules | **PASS** (deny all client access) |
| Cloud Build Firestore deploy IAM | **HIGH RISK** (roles missing) |
| GCS region `us-central1` | **FAIL** (repo uses `asia-southeast1`) |
| GCS soft delete disabled | **FAIL** (not configured) |
| GCS lifecycle cleanup | **PASS** (live objects) |

---

## 10. Appendix — Commands Executed

```bash
# Repository hygiene
git status --porcelain=v1
git branch --show-current
git ls-files
git check-ignore -v .env backend/.env backend/.env.test frontend/.env.production

# Frontend
cd frontend && npm run build
grep -RInE 'localhost|127\.0\.0\.1|:4000|:5173' dist
grep -RoE 'utilityhub\.dev\.user|X-Dev-User' dist/assets/*.js

# Backend
cd backend && npm test

# Containers
docker build -f backend/Dockerfile -t utilityhub-api:preflight backend
docker build -f backend/Dockerfile.worker -t utilityhub-worker:preflight backend
docker build -f frontend/Dockerfile -t utilityhub-web:preflight frontend
docker run --rm --network none utilityhub-worker:preflight
docker run --rm --network none utilityhub-api:preflight
docker run -d -p 8123:8123 -e NODE_ENV=development -e PORT=8123 \
  -e STORAGE_DRIVER=local -e DB_DRIVER=memory -e AUTH_MODE=dev \
  utilityhub-api:preflight
curl -sS http://127.0.0.1:8123/api/v1/health/live

# Infrastructure inspection
cat infra/setup-gcp.sh
cat infra/firestore.indexes.json
cat infra/gcs-lifecycle.json
cat firebase.json
cat cloudbuild.yaml
```

---

**Final assessment:** The application layer is in good shape for a containerized deployment: tests pass, both images build, `$PORT` works, production guardrails are explicit, scale-to-zero is configured, and Firestore indexes are complete. Deployment is blocked by repository state, GCS soft-delete configuration, Cloud Build Firestore IAM, and the unresolved region requirement. The `.env.production` and signed-upload-size gaps should be closed before production traffic.
