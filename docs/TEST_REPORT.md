# UtilityHub — Test Report

Version: 2.0
Date: 2026-11-18
Result: **Local verification green. Cloud deployment unverified** because no GCP
project, billing account, Firebase project, or credentials were available.

## 1. Environment

| Item | Value |
| --- | --- |
| Platform | Linux |
| Node.js | v22.23.2 |
| npm | 10.9.8 |
| Backend test runner | Vitest 5.1.0 |
| Browser check | Google Chrome headless (`--headless=new`) |
| Local drivers | `DB_DRIVER=memory`, `STORAGE_DRIVER=local`, `AUTH_MODE=dev` |
| Cloud credentials | None |
| Network | No calls to GCP, Firebase, or other paid services |

## 2. Backend automated tests

Command:

```bash
cd backend && npm test
```

Result:

```text
Test Files  5 passed (5)
     Tests  42 passed (42)
  Duration  6.90s
```

Suites:

| File | Tests | Coverage |
| --- | ---: | --- |
| `tests/api.test.js` | 16 | health, catalog, dev auth, upload init, signed URLs, job creation, ownership, quota, expiry, deletion, history, validation, rate-limit configuration |
| `tests/processing.test.js` | 15 | every cloud processor (see matrix below) |
| `tests/lifecycle.test.js` | 5 | duplicate claim prevention, lease renewal ownership, interrupted-worker requeue, attempt exhaustion, result expiry, object deletion, metadata purge, expired uploads |
| `tests/config.test.js` | 3 | production refuses local drivers and placeholder values; accepts a full cloud config; rejects non-HTTPS CORS |
| `tests/worker-auth.test.js` | 3 | worker rejects missing, incorrect, and accepts correct shared secret |

### 2.1 Processor matrix

All cloud operations were executed against real local fixtures. Outputs were
downloaded through the signed-URL flow and validated.

| Category | Operation | Validation performed |
| --- | --- | --- |
| PDF | `merge-pdf` | Output loads in `pdf-lib`; page count equals inputs |
| PDF | `split-pdf` | ZIP signature (`PK`), part count summary |
| PDF | `compress-pdf` | Output loads; Ghostscript preset recorded |
| PDF | `rotate-pdf` | Selected page rotation is 90°, unselected page stays 0° |
| PDF | `images-to-pdf` | Page count matches images; valid PDF |
| PDF | `pdf-to-images` | ZIP signature; expected image entries |
| Photo | `image-convert` | Output decodes with Sharp; expected format |
| Photo | `image-compress` | Output decodes; size/quality summary |
| Photo | `color-picker` | Dominant color matches fixture |
| Data | `csv-to-json` | Parsed rows match fixture |
| Data | `json-to-csv` | CSV parses with expected headers/rows |
| Data | `json-format` | Pretty-printed JSON round-trips |
| Data | `table-preview` | Column/row summary and preview match |
| Text | `text-case` | Output bytes equal expected case transform |
| Text | `text-counter` | Word and sentence counts match |
| Text | `text-remove-lines` | Blank lines/duplicates removed correctly |

Client utilities (`unit-converter`, `percentage-calculator`) are covered by the
catalog test and the browser render check, not by backend processors.

## 3. Frontend production build

Command:

```bash
cd frontend && npm run build
```

Result:

```text
✓ 46 modules transformed.
dist/index.html                   1.84 kB │ gzip:   0.86 kB
dist/assets/index-LH7fAUIn.css   36.93 kB │ gzip:   7.64 kB
dist/assets/index-B5FwWGUV.js   405.89 kB │ gzip: 122.14 kB
✓ built in 556ms
```

No build warnings or errors. The bundle includes React 19 and Firebase 11.10.0.

## 4. Browser verification

The old Docker stack (MySQL/local disk) was stopped before verification; it was
holding ports 4000/5173 and served stale UI.

### 4.1 Visual checks

Headless Chrome screenshots at 1440 px:

- Home page: dark `#0F0F0F` canvas, mustard `#FFD54F`, mint `#69F0AE`, offset
  block shadows, Anton/Oswald headings, JetBrains Mono metadata, responsive
  tool grid, live `CLOUD API ONLINE` status.
- Tool page while signed out: identity gate explains Firebase-scoped jobs and
  signed GCS uploads.
- Browse page: all 18 tools, category counts, search, status badges.
- Client utilities: unit converter (length/mass/data/temperature) and
  percentage calculator render and compute locally.
- Completed job panel: `DONE` badge, verified output filename/size, retention
  countdown (`1d left`, not `23h 60m`), download/process-another/delete
  actions.

A catalog-shape mismatch was found and fixed during this pass: client tools
were returned without the `input` object, which crashed the shared tool route.
The API now returns a consistent `input` shape and the frontend also tolerates
older responses; a regression assertion was added to `api.test.js`.

### 4.2 End-to-end browser flow

Driven through the Chrome DevTools Protocol against the real local stack:

1. Render the home page and confirm the catalog loaded from `/api/v1/operations`.
2. Set a dev identity and open `/tools/text-case`.
3. Attach `sample.txt` to the hidden file input.
4. Submit the form.
5. The browser calls `/uploads/init`, receives a signed local-storage URL, and
   PUTs bytes directly (never through the API).
6. The API queues the job; the in-process local runner claims and processes it.
7. The UI polls until `done` and renders the result panel.
8. Clicking download calls `/jobs/:id/download` and retrieves the signed GET
   URL; Chrome saved the file.

Observed result:

```json
{
  "done": true,
  "file": "sample-upper.txt",
  "bytes": 29,
  "content": "HELLO UTILITYHUB\nSECOND LINE"
}
```

This validated the full integration path: Firebase/dev auth header → upload
init → signed write → Firestore-shaped job → worker claim → processor →
artifact validation → signed read → browser download.

### 4.3 Re-run after the catalog fix

The browser flow was repeated after the client-catalog shape change. Result was
identical (`sample-upper.txt`, 29 bytes, expected content), so returning a
consistent `input` object introduced no regression.

## 5. Container builds

Both images were built locally with Docker. The API image was built first; the
worker image reuses the same dependency layer.

| Image | Command | Result |
| --- | --- | --- |
| API | `docker build -f backend/Dockerfile -t utilityhub-api:test backend` | Success, 285 production packages, `npm audit` 0 vulnerabilities |
| Worker | `docker build -f backend/Dockerfile.worker -t utilityhub-worker:test backend` | Success |

Worker runtime verification inside the image:

```text
$ docker run --rm utilityhub-worker:test sh -c 'gs --version; pdftoppm -v; node -e ...'
10.00.0
pdftoppm version 22.12.0
sharp ok 8.18.7
```

Production guardrail verification inside the image:

```text
$ docker run --rm utilityhub-worker:test node src/worker.js --once
Error: Refusing to start in production with local-only configuration:
STORAGE_DRIVER must be gcs; DB_DRIVER must be firestore; AUTH_MODE must be
firebase; GCS_BUCKET must be configured; GCP_PROJECT_ID must be configured;
SIGNED_URL_SECRET must be configured
```

This confirms the container defaults to `NODE_ENV=production` and refuses to
boot without real cloud configuration, so a misconfigured deploy fails at
startup instead of silently using local drivers.

## 6. Static and configuration checks

| Check | Result |
| --- | --- |
| `bash -n infra/setup-gcp.sh` | Pass |
| `cloudbuild.yaml` parsed with PyYAML | Pass, 9 steps |
| `firebase.json`, `firestore.indexes.json`, `gcs-lifecycle.json` parsed with `JSON.parse` | Pass |
| Firestore indexes declared | 8 composite indexes |
| Backend import smoke (`node -e "import('./src/app.js')"`) | Pass |
| Production config child-process tests | Pass (see `config.test.js`) |
| Frontend CSP | Includes Google Fonts, Firebase Auth, GCS, Cloud Run, and local dev API origins |

## 7. What was not verified

These items require cloud resources or credentials and are therefore **not
claimed as tested**:

- Real Firebase ID-token verification (`verifyIdToken`) against a live project.
- Google and email/password sign-in in a real Firebase project.
- Firestore transactions, composite-index behavior, and quota contention.
- GCS v4 signed URL generation through IAM `signBlob`.
- Bucket CORS, lifecycle enforcement, and public-access prevention.
- Cloud Run service-to-service OIDC invocation and internal ingress.
- Cloud Scheduler → Cloud Run Job cleanup invocation.
- Cloud Build, Artifact Registry, Firebase Hosting, and the `/api/**` rewrite.
- Load, concurrency, and large-file performance testing.
- Cross-browser testing beyond headless Chrome.
- Accessibility audit with a screen reader or axe.

## 8. Reproduce locally

```bash
cd backend
cp .env.example .env
npm ci
npm test

cd ../frontend
cp .env.example .env.local
npm ci
npm run build

# Optional full stack
cd ..
docker compose up --build -d
curl -fsS http://127.0.0.1:4000/api/v1/health/ready
curl -fsS http://127.0.0.1:5173/ >/dev/null
docker compose down
```

## 9. Verdict

The local application, processors, signed-upload flow, job lifecycle, cleanup,
UI, and production configuration guardrails are verified. Production deployment
remains blocked on GCP/Firebase provisioning and must be treated as the next
independent test phase (staging smoke, then production).
