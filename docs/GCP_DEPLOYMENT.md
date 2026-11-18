# UtilityHub — GCP Deployment

Version: 2.0
Date: 2026-11-18
Status: **Documented, not executed in this workspace.** No GCP project, billing
account, or credentials were available. Every command below is written for an
operator with project ownership. Treat the first deployment as staging.

## 1. Target topology

| Piece | Resource | Region / ingress |
| --- | --- | --- |
| Frontend | Firebase Hosting (`<project>.web.app`) | Global CDN |
| Auth | Firebase Authentication (Google + email/password) | Managed |
| API | Cloud Run service `utilityhub-api` | Public, `asia-southeast1` |
| Worker | Cloud Run service `utilityhub-worker` | Internal + load balancing |
| Cleanup | Cloud Run Job `utilityhub-cleanup` | Internal, daily schedule |
| Database | Firestore Native `(default)` | `asia-southeast1` |
| Objects | Cloud Storage `utilityhub-prod-<project>` | `asia-southeast1` |
| Images | Artifact Registry `utilityhub` | `asia-southeast1` |
| Secret | Secret Manager `utilityhub-worker-shared-secret` | Automatic replication |

The Firebase Hosting rewrite `/api/**` targets `utilityhub-api` in
`asia-southeast1`. If you deploy to another region, update `firebase.json`
**and** the `_REGION` substitution so both agree.

## 2. Prerequisites

- Google Cloud project with billing enabled.
- `gcloud` authenticated as an owner:
  ```bash
  gcloud auth login
  gcloud auth application-default login
  gcloud config set project YOUR_PROJECT_ID
  ```
- Firebase added to the project (Console → Add project, or
  `firebase projects:addfirebase YOUR_PROJECT_ID`).
- Node 22 locally for Firebase CLI commands (optional; Cloud Build does it).
- The Firebase CLI for rules/indexes if Cloud Build cannot authenticate to
  Firebase:
  ```bash
  npm install -g firebase-tools
  firebase login
  ```

## 3. Provision infrastructure

```bash
cd /path/to/utilityhub
PROJECT_ID=your-project-id \
REGION=asia-southeast1 \
BUCKET=utilityhub-prod-your-project-id \
HOSTING_ORIGIN=https://your-project-id.web.app \
./infra/setup-gcp.sh
```

The script is idempotent and creates:

- Enabled APIs (Run, Build, Artifact Registry, Firestore, Storage, Secret
  Manager, Scheduler, Firebase Hosting/Auth, IAM, Logging, Monitoring).
- Service accounts `utilityhub-api`, `utilityhub-worker`,
  `utilityhub-cleanup`, `utilityhub-build`, `utilityhub-scheduler`.
- Firestore Native `(default)` if absent.
- A private, uniform-access bucket with public access prevention, CORS for the
  Hosting and localhost origins, and lifecycle rules from
  `infra/gcs-lifecycle.json`.
- Artifact Registry repository `utilityhub`.
- Worker shared secret and scoped secret access.
- A daily Cloud Scheduler job for the cleanup Cloud Run Job.

### 3.1 Configure Firebase Authentication

In Firebase Console → Authentication:

1. Enable **Google** and **Email/Password** providers.
2. Add authorized domains: `<project>.web.app`, any custom domain, and
   `localhost` for development.
3. Register a **Web App** and copy:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `appId`
   - `messagingSenderId`

The Firebase web config is public by design; it is not a secret. Do **not** put
service-account JSON keys in the frontend or the repository.

## 4. Build and deploy

Use the dedicated build service account so Cloud Build has exactly the roles
created by the setup script.

```bash
PROJECT_ID=your-project-id

gcloud builds submit \
  --config cloudbuild.yaml \
  --service-account="utilityhub-build@${PROJECT_ID}.iam.gserviceaccount.com" \
  --substitutions="_REGION=asia-southeast1,_BUCKET=utilityhub-prod-${PROJECT_ID},_HOSTING_ORIGIN=https://${PROJECT_ID}.web.app,_FIREBASE_API_KEY=...,_FIREBASE_AUTH_DOMAIN=${PROJECT_ID}.firebaseapp.com,_FIREBASE_APP_ID=...,_FIREBASE_MESSAGING_SENDER_ID=..."
```

The pipeline performs, in order:

1. Build and push `api` and `worker` images tagged with `$BUILD_ID`.
2. Deploy `utilityhub-worker` with no public invoker and internal ingress.
3. Read the worker URL, write it back as `WORKER_URL` (the OIDC audience), and
   grant the API service account `roles/run.invoker` on the worker.
4. Deploy `utilityhub-api` with Firestore/GCS/Firebase auth and the worker URL.
5. Deploy `utilityhub-cleanup` as a Cloud Run Job running
   `node src/worker.js --cleanup`.
6. Build the frontend with the Firebase web config and deploy Hosting + the
   Firestore rules and indexes.

### 4.1 If the Hosting step cannot authenticate

Cloud Build's service account must be able to use Firebase. If the
`deploy-hosting` step fails with an authorization error, deploy Hosting and
Firestore from a workstation:

```bash
cd frontend
VITE_AUTH_MODE=firebase \
VITE_FIREBASE_API_KEY=... \
VITE_FIREBASE_AUTH_DOMAIN=${PROJECT_ID}.firebaseapp.com \
VITE_FIREBASE_PROJECT_ID=${PROJECT_ID} \
VITE_FIREBASE_APP_ID=... \
VITE_FIREBASE_MESSAGING_SENDER_ID=... \
npm ci && npm run build

cd ..
firebase deploy --only hosting,firestore:rules,firestore:indexes --project "$PROJECT_ID"
```

Alternatively store a `firebase login:ci` token in Secret Manager and pass it
to `firebase deploy --token`. Never commit the token.

## 5. Post-deploy verification

```bash
PROJECT_ID=your-project-id
API_URL=$(gcloud run services describe utilityhub-api \
  --region asia-southeast1 --format='value(status.url)')
WORKER_URL=$(gcloud run services describe utilityhub-worker \
  --region asia-southeast1 --format='value(status.url)')

curl -fsS "$API_URL/api/v1/health/live"
curl -fsS "$API_URL/api/v1/health/ready"
curl -fsS "$API_URL/api/v1/operations" | head -c 400

# The worker must reject unauthenticated callers.
curl -i -X POST "$WORKER_URL/internal/run" -H 'Content-Type: application/json' -d '{}'

# Hosting and the API rewrite.
curl -fsSI "https://${PROJECT_ID}.web.app/"
curl -fsS "https://${PROJECT_ID}.web.app/api/v1/health/live"
```

Expected:

- `/health/live` → `200`, `service: utilityhub-api`, `version: 2.0.0`.
- `/health/ready` → `200`, drivers `firestore` / `gcs` / `firebase`.
- Worker request without an OIDC token → `403`.
- Hosting `/api/v1/health/live` reaches the same API response.

Then in a browser:

1. Sign in with Google and with a new email/password account.
2. Run **Text → Case Converter** on a small text file.
3. Confirm the job moves `queued → processing → done` and the download works.
4. Delete the job; confirm it disappears from history.
5. Sign out and confirm cloud tools require sign-in again.

## 6. Configuration reference

The API and worker share these production values:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `GCP_PROJECT_ID` | project id |
| `GCS_BUCKET` | bucket name (no `gs://`) |
| `FIRESTORE_DATABASE_ID` | `(default)` |
| `STORAGE_DRIVER` | `gcs` |
| `DB_DRIVER` | `firestore` |
| `AUTH_MODE` | `firebase` |
| `CORS_ORIGINS` | exact Hosting origin(s), comma-separated |
| `PUBLIC_API_URL` | Hosting origin |
| `WORKER_URL` | worker Cloud Run URL (API and worker) |
| `WORKER_POLL` | `false` on Cloud Run (request-driven) |
| `WORKER_SHARED_SECRET` | mounted from Secret Manager |
| Retention, quota, and timeout variables | defaults in `backend/.env.example` |

Production startup refuses `local`, `memory`, `dev`, placeholder project/bucket
names, or a local-only signing secret.

## 7. Local development (no cloud)

```bash
cd backend
cp .env.example .env
npm install
npm start        # memory store + local object folder + dev auth

# another terminal
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open <http://localhost:5173>. Use **Dev sign in**; the frontend sends
`X-Dev-User`. The backend accepts it only when `AUTH_MODE=dev`. The local
signed-URL endpoint `/api/v1/dev-storage` returns 404 in cloud mode. Because the
memory store is process-local, the API runs an in-process `JobRunner` when
`WORKER_URL` is unset; no separate local worker is started.

Or run the whole local stack:

```bash
docker compose up --build
```

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| API starts then exits with “Refusing to start…” | local driver or placeholder config in production | set `gcs`/`firestore`/`firebase`, real project and bucket |
| `/health/ready` returns 503 | Firestore or bucket unreachable | check `roles/datastore.user`, bucket IAM, project id |
| GCS `403` on signed URL creation | runtime SA cannot `signBlob` | grant `roles/iam.serviceAccountTokenCreator` on `utilityhub-api@` itself |
| Worker returns `403` to API trigger | IAM invoker or `WORKER_URL` audience mismatch | grant `roles/run.invoker`; set the exact worker URL on both services |
| Jobs stay `queued` | worker trigger failed or worker crash | inspect worker logs; the poll fallback is off in cloud, so fix the trigger |
| Firestore “index required” link in logs | missing composite index | deploy `infra/firestore.indexes.json` |
| Browser sign-in popup blocked or `auth/unauthorized-domain` | domain missing in Firebase Auth | add Hosting domain to authorized domains |
| CORS error on signed PUT | bucket CORS lacks the origin | rerun the CORS section of `setup-gcp.sh` with `HOSTING_ORIGIN` |
| `auth/invalid-api-key` | wrong/empty Firebase Web config | rebuild Hosting with correct `VITE_FIREBASE_*` values |
| Cleanup never runs | Scheduler cannot invoke the job | check Scheduler logs and `roles/run.invoker` on the job |

## 9. Cost guardrails

- Cloud Run scales to zero; max 10 API instances and 3 worker instances.
- Files are capped at 25 MB, jobs at 3 concurrent, results expire in 24 h.
- GCS lifecycle deletes at 1 day as a backstop; the app deletes earlier.
- Set a budget alert (e.g. $10) at 50/90/100% in Cloud Billing.
- Signed downloads are the dominant egress cost; keep `DOWNLOAD_URL_TTL_SECONDS`
  short and results small.
