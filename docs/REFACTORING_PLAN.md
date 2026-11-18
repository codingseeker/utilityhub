# UtilityHub — Refactoring Plan

Version: 2.0
Date: 2026-11-18

## 1. Strategy

Preserve the proven PDF processing core, replace every local-first platform concern with a GCP-native one, expand the catalog, and rebuild the visual layer. Work is ordered so each phase leaves a verifiable system.

The result has two runtime modes:

| Mode | Persistence | Objects | Auth | Allowed |
| --- | --- | --- | --- | --- |
| Local verification | in-memory adapter | local HMAC-signed object store | explicit `X-Dev-User` | `NODE_ENV !== production` only |
| GCP production | Firestore | GCS signed URLs | Firebase ID tokens | `NODE_ENV=production` |

Production refuses to start with local adapters.

## 2. Phase plan

### Phase 0 — Audit (complete)

- Inventory repository, tools, engines, dependencies, routing, styling, risks.
- Deliverables: `docs/EXISTING_PROJECT_AUDIT.md`, `docs/TOOL_INVENTORY.md`.

### Phase 1 — Architecture (complete)

- Frontend architecture, API contract, job lifecycle, GCP infrastructure, this plan.
- Every existing tool mapped to a server-side operation.

### Phase 2 — Design system and UI

- Replace `styles.css` with Neo-Brutalist tokens, dark/light themes, hard borders, offset shadows, condensed headings.
- Header with search, theme toggle, auth state; hero; stat bar; categories; cloud/instant tool cards; recent jobs; mobile nav.
- Auth dialog, job states, quota state, error states, keyboard/focus support.
- Remove every "local" claim; replace with **CLOUD** and GCP copy.

### Phase 3 — Cloud Run API

- Rewrite `backend/src` around Express 5, zod, Firestore/GCS adapters, Firebase Admin.
- Endpoints from `docs/API_CONTRACT.md`.
- Signed upload/download URLs; quota; rate limits; structured errors and logs.
- Dev-only adapters gated by config.

### Phase 4 — Workers

- Worker service with lease claim, heartbeat, retry, timeout, temp cleanup.
- Port the six PDF operations and add photo/data/text operations.
- Validate inputs deeply; verify artifacts; upload results; transactional completion.
- Cloud Run Jobs cleanup entrypoint.

### Phase 5 — Frontend file flow

- Signed PUT with progress, job creation, polling, signed download, history, quotas, clear history.
- Auth gate before cloud work; client utilities require no auth.

### Phase 6 — Storage and data lifecycle

- Bucket prefixes, lifecycle rules, CORS, Firestore rules/indexes, TTL cleanup job.
- UI clear-history action.

### Phase 7 — Hardening

- Signature/extension/MIME/size validation; signed URL scopes/expiry; per-user quotas; input sanitisation; worker limits; logging/monitoring; security tests.

### Phase 8 — Deployment blueprint

- `docs/GCP_DEPLOYMENT.md`, IAM, secrets, cost, Cloud Run Jobs vs service decision.

### Phase 9 — Testing

- Unit, integration, auth, security, failure, accessibility, and end-to-end tests per tool.
- `docs/TEST_REPORT.md` with actual results.

### Phase 10 — Deployment runbook

- `docs/DEPLOYMENT_RUNBOOK.md` and `infra/setup-gcp.sh`.
- Deployment itself requires a real GCP project and is not performed in this environment.

## 3. Backend module plan

```text
backend/src/
  config/env.js              validated config + production guards
  lib/
    errors.js                AppError / ProcessingError
    logger.js                pino
    auth.js                  Firebase Admin + dev auth
    store/
      index.js               adapter selection
      memory.js              test/dev store
      firestore.js           production store
      jobs.js                job operations shared by both
    storage/
      index.js               adapter selection
      local.js               HMAC-signed local object store
      gcs.js                 GCS signed URLs + IO
    operations/
      catalog.js             descriptors + zod schemas + validation
      processing/            runner + operation implementations
      validation.js          magic bytes, PDF/image/text checks
    util/                    pages, process, pdfinfo, zip, filenames
  routes/                    health, operations, uploads, jobs, me, internal
  middleware/                auth, rate limits, request id, errors
  app.js
  server.js                  API
  worker.js                  worker service / one-shot
```

## 4. Frontend module plan

- `context/AuthContext`, `ThemeContext`, `JobsContext`.
- `components/` refactored from existing Header, FileDropzone, FileList, JobPanel, ToolIcon; new AuthDialog, StatBar, ToolCard, RecentJobs, MobileNav.
- `pages/HomePage` rebuilt, `ToolPage` rebuilt around signed URLs, new `ClientToolPage`, `RecentPage`, `SettingsPage`.
- `api.js` rewritten; `firebase.js` added; `tools.js` expanded.

## 5. Reuse and replacement matrix

| Area | Action |
| --- | --- |
| PDF processors | Keep, adapt inputs from GCS downloads |
| Page parser, pdfinfo, process spawn, zip, artifact validation | Keep |
| Prisma schema/migrations/client | Remove from runtime |
| MySQL queue/claim/lease SQL | Replace with Firestore transactions |
| Multer/local upload | Replace with signed URLs |
| Capability tokens/WordPress identity | Remove |
| Frontend visual layer | Replace |
| Frontend component boundaries | Preserve and extend |
| Old tests | Replace |
| Old docs | Keep for history; new docs are authoritative |

## 6. Data migration

No production data exists. There is no MySQL → Firestore migration. The old local volumes remain on disk but are not read by the new system; operators may delete them after verifying the cloud stack.

## 7. Rollout and rollback

1. Deploy API/worker to a staging GCP project.
2. Run the pipeline tests and manual smoke tests with a staging Firebase user.
3. Deploy Hosting preview; verify auth, upload, job, download.
4. Promote to production; enable budget alerts.
5. Rollback: Cloud Run revisions are pinned; Firebase Hosting releases can be rolled back. Firestore/GCS data is environment-specific and unchanged by a code rollback.

## 8. Definition of done

- All catalog tools have real implementations and pass tests.
- Signed URL upload/download flow verified end-to-end locally.
- Auth required for all cloud jobs; unauthorized access rejected.
- Firestore/GCS adapters compile and are covered by focused unit tests; live GCP behavior is verified by operator smoke tests.
- Neo-Brutalist UI is responsive, uses semantic controls and visible `:focus-visible` styles, and is free of misleading local claims. A full screen-reader/axe audit remains a follow-up item.
- No secrets committed; production guards reject dev adapters.
- Documentation matches the implementation and reports real test results.

## 9. Accepted limitations

- This environment has no GCP credentials, so no live deployment or Firebase sign-in is performed here.
- Firestore and GCS emulators are not installed; cloud adapters are verified by type/contract review and shared job semantics, not by an emulator run.
- The local adapters are explicitly non-production and produce a startup error in production mode.
- The old MySQL/Prisma stack is retired, not migrated.
