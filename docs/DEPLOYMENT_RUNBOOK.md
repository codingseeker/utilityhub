# UtilityHub — Deployment Runbook

Version: 2.0
Date: 2026-11-18
Audience: on-call operator with project IAM and Firebase access.

## 1. Release preflight

Run from the repository root.

```bash
# Backend contract and processors
cd backend && npm ci && npm test && cd ..

# Frontend production build
cd frontend && npm ci && npm run build && cd ..

# Artifact sanity
node -e "JSON.parse(require('fs').readFileSync('firebase.json'))"
node -e "JSON.parse(require('fs').readFileSync('infra/firestore.indexes.json'))"
bash -n infra/setup-gcp.sh
```

Optional local smoke:

```bash
docker compose up --build -d
curl -fsS http://127.0.0.1:4000/api/v1/health/ready
curl -fsS http://127.0.0.1:5173/ >/dev/null
docker compose down
```

Do not deploy unless every command is green.

## 2. Normal release

1. Confirm the target project and region:
   ```bash
   gcloud config get-value project
   gcloud config get-value run/region 2>/dev/null || true
   ```
2. Confirm the bucket and Firebase app still exist:
   ```bash
   gcloud storage buckets describe gs://utilityhub-prod-<project>
   firebase apps:list --project <project>
   ```
3. Run the pipeline with the build service account:
   ```bash
   gcloud builds submit --config cloudbuild.yaml \
     --service-account=utilityhub-build@<project>.iam.gserviceaccount.com \
     --substitutions="_REGION=asia-southeast1,_BUCKET=utilityhub-prod-<project>,_HOSTING_ORIGIN=https://<project>.web.app,_FIREBASE_API_KEY=...,_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com,_FIREBASE_APP_ID=...,_FIREBASE_MESSAGING_SENDER_ID=..."
   ```
4. Watch the build:
   ```bash
   gcloud builds list --limit=5
   gcloud builds log <BUILD_ID> --stream
   ```

## 3. Deploy one component

Images are tagged with the Cloud Build id. To redeploy parts manually:

```bash
REGION=asia-southeast1
PROJECT=your-project
TAG=<build-id>
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/utilityhub"

# Worker
gcloud run deploy utilityhub-worker \
  --region "$REGION" \
  --image "${IMAGE}/worker:${TAG}" \
  --no-allow-unauthenticated \
  --ingress internal-and-cloud-load-balancing

# API (update env first if configuration changed)
gcloud run deploy utilityhub-api \
  --region "$REGION" \
  --image "${IMAGE}/api:${TAG}" \
  --allow-unauthenticated

# Cleanup job
gcloud run jobs deploy utilityhub-cleanup \
  --region "$REGION" \
  --image "${IMAGE}/worker:${TAG}" \
  --command node \
  --args src/worker.js,--cleanup

# Hosting
firebase deploy --only hosting --project "$PROJECT"
```

Never deploy the API before the worker exists; the API's `WORKER_URL` is the
OIDC audience and must match the worker URL exactly.

## 4. Post-deploy verification

```bash
API=$(gcloud run services describe utilityhub-api --region "$REGION" --format='value(status.url)')
WORKER=$(gcloud run services describe utilityhub-worker --region "$REGION" --format='value(status.url)')

curl -fsS "$API/api/v1/health/live"
curl -fsS "$API/api/v1/health/ready"
curl -fsS "https://${PROJECT}.web.app/api/v1/health/live"

# Worker must reject anonymous invocation.
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WORKER/internal/run" \
  -H 'Content-Type: application/json' -d '{}')" = "403"
```

Browser checks:

- Google sign-in completes.
- Email/password sign-up and sign-in complete.
- A text job run reaches `done` and the file downloads.
- A PDF job run reaches `done` and the downloaded file opens.
- Deleting a job removes it from history.
- Expired downloads return `410 JOB_EXPIRED`.

Functional smoke through the API with a real ID token:

```bash
TOKEN=... # Firebase ID token from the browser, never log it
curl -fsS "$API/api/v1/me" -H "Authorization: Bearer $TOKEN"
curl -fsS "$API/api/v1/operations" | jq '.data.operations | length'
```

## 5. Rollback

Cloud Run keeps prior revisions. Roll back the API or worker without rebuilding:

```bash
gcloud run revisions list --service utilityhub-api --region "$REGION"
gcloud run services update-traffic utilityhub-api \
  --region "$REGION" --to-revisions=<revision-name>=100

gcloud run revisions list --service utilityhub-worker --region "$REGION"
gcloud run services update-traffic utilityhub-worker \
  --region "$REGION" --to-revisions=<revision-name>=100
```

For Hosting, rebuild and redeploy the previous commit, then:

```bash
firebase hosting:rollback --project "$PROJECT"
```

For the cleanup job, redeploy the previous image tag. Firestore and GCS data
are not versioned in this design; rollback affects code, not stored jobs.

## 6. Incident playbooks

### Jobs stuck in `queued`

1. Check recent worker logs:
   ```bash
   gcloud run services logs read utilityhub-worker --region "$REGION" --limit=100
   ```
2. Confirm the API can invoke the worker:
   ```bash
   gcloud run services get-iam-policy utilityhub-worker --region "$REGION"
   gcloud run services describe utilityhub-worker --region "$REGION" --format='value(status.url)'
   ```
3. Compare `WORKER_URL` on both services.
4. Trigger a single job manually from inside a privileged shell, or temporarily
   run the worker with `--once` as a Cloud Run Job:
   ```bash
   gcloud run jobs deploy utilityhub-worker-once \
     --region "$REGION" --image "${IMAGE}/worker:${TAG}" \
     --command node --args src/worker.js,--once
   gcloud run jobs execute utilityhub-worker-once --region "$REGION" --wait
   ```
   Delete the temporary job afterwards.

### Worker returns 500 / OOM

- PDF jobs need memory; raise `--memory 4Gi` and `--cpu 2`.
- Check for `WORKER_LOST`: the lease expired and the job was requeued or failed
  after `WORKER_MAX_ATTEMPTS`.
- Re-run the job from the UI after the worker is healthy.

### Signed upload `403` from GCS

- The browser origin is missing from bucket CORS.
- The upload URL expired (`UPLOAD_URL_TTL_SECONDS`, default 15 min).
- The API cannot sign: verify `roles/iam.serviceAccountTokenCreator` on
  `utilityhub-api@` itself.

### Downloads fail with `410`

The result exceeded `RESULT_RETENTION_HOURS` (24 h). This is expected. Ask the
user to upload again.

### Firestore index error

Open the URL in the error log and create the index, or deploy
`infra/firestore.indexes.json`:

```bash
firebase deploy --only firestore:indexes --project "$PROJECT"
```

### Auth failures

- `auth/unauthorized-domain`: add the Hosting domain in Firebase Auth.
- `auth/operation-not-allowed`: enable Google or Email/Password.
- `auth/invalid-api-key`: rebuild Hosting with the current web config.
- API `401`: the ID token expired or belongs to another project; sign out/in.

## 7. Secret rotation

```bash
NEW_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
printf '%s' "$NEW_SECRET" | gcloud secrets versions add utilityhub-worker-shared-secret --data-file=-
```

Then redeploy or update both services so they mount the new `:latest` version:

```bash
gcloud run services update utilityhub-worker --region "$REGION" --update-secrets=WORKER_SHARED_SECRET=utilityhub-worker-shared-secret:latest
gcloud run services update utilityhub-api --region "$REGION" --update-secrets=WORKER_SHARED_SECRET=utilityhub-worker-shared-secret:latest
```

## 8. Manual cleanup

```bash
gcloud run jobs execute utilityhub-cleanup --region "$REGION" --wait
gcloud run jobs executions list --job utilityhub-cleanup --region "$REGION" --limit=5
```

Expected log fields: `expiredJobs`, `purgedJobs`, `expiredUploads`.

## 9. Audit trail

For each release record:

- Git commit (if the repository is versioned) and `BUILD_ID`.
- API and worker revision names.
- Firebase Hosting release version.
- Verification results and any skipped checks.
- Incidents, rollbacks, and follow-up issues.
