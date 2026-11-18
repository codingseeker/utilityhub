#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# UtilityHub — idempotent GCP provisioning.
#
# Prerequisites:
#   - gcloud authenticated as an owner (or equivalent) of the target project
#   - Billing enabled on the project
#   - Firebase project initialized (console or `firebase projects:addfirebase`)
#
# Usage:
#   PROJECT_ID=my-project REGION=asia-southeast1 ./infra/setup-gcp.sh
#
# This script creates infrastructure only. It does not deploy application
# images; run `gcloud builds submit --config cloudbuild.yaml` afterwards.
# ---------------------------------------------------------------------------
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to the target Google Cloud project}"
REGION="${REGION:-asia-southeast1}"
BUCKET="${BUCKET:-utilityhub-prod-${PROJECT_ID}}"
HOSTING_ORIGIN="${HOSTING_ORIGIN:-https://${PROJECT_ID}.web.app}"
LOCAL_ORIGIN="${LOCAL_ORIGIN:-http://localhost:5173}"

API_SA="utilityhub-api"
WORKER_SA="utilityhub-worker"
CLEANUP_SA="utilityhub-cleanup"
BUILD_SA="utilityhub-build"
SCHEDULER_SA="utilityhub-scheduler"
REPO="utilityhub"
SECRET_NAME="utilityhub-worker-shared-secret"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

info() { printf '\n[utilityhub] %s\n' "$1"; }

account() { printf '%s@%s.iam.gserviceaccount.com' "$1" "${PROJECT_ID}"; }

create_service_account() {
  local name="$1"
  local display="$2"
  if ! gcloud iam service-accounts describe "$(account "${name}")" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    info "Creating service account ${name}"
    gcloud iam service-accounts create "${name}" \
      --project "${PROJECT_ID}" \
      --display-name "${display}"
  fi
}

grant_project_role() {
  local member="$1"
  local role="$2"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${member}" \
    --role "${role}" \
    --condition=None \
    --quiet >/dev/null
}

info "Target project: ${PROJECT_ID} (${REGION})"
gcloud config set project "${PROJECT_ID}" --quiet

info "Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  firebasehosting.googleapis.com \
  identitytoolkit.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  --project "${PROJECT_ID}"

info "Creating service accounts"
create_service_account "${API_SA}" "UtilityHub API"
create_service_account "${WORKER_SA}" "UtilityHub worker"
create_service_account "${CLEANUP_SA}" "UtilityHub cleanup"
create_service_account "${BUILD_SA}" "UtilityHub Cloud Build"
create_service_account "${SCHEDULER_SA}" "UtilityHub scheduler"

info "Granting project roles"
for sa in "${API_SA}" "${WORKER_SA}" "${CLEANUP_SA}"; do
  grant_project_role "$(account "${sa}")" roles/datastore.user
  grant_project_role "$(account "${sa}")" roles/logging.logWriter
  grant_project_role "$(account "${sa}")" roles/monitoring.metricWriter
done

# The API signs GCS v4 URLs with the runtime service account, which requires
# signBlob on itself. Scope this to the API service account only.
gcloud iam service-accounts add-iam-policy-binding "$(account "${API_SA}")" \
  --project "${PROJECT_ID}" \
  --member "serviceAccount:$(account "${API_SA}")" \
  --role roles/iam.serviceAccountTokenCreator \
  --quiet >/dev/null

grant_project_role "$(account "${BUILD_SA}")" roles/run.admin
grant_project_role "$(account "${BUILD_SA}")" roles/iam.serviceAccountUser
grant_project_role "$(account "${BUILD_SA}")" roles/artifactregistry.writer
grant_project_role "$(account "${BUILD_SA}")" roles/storage.admin
grant_project_role "$(account "${BUILD_SA}")" roles/cloudbuild.builds.builder
grant_project_role "$(account "${BUILD_SA}")" roles/firebasehosting.admin
grant_project_role "$(account "${BUILD_SA}")" roles/firebase.viewer
grant_project_role "$(account "${SCHEDULER_SA}")" roles/logging.logWriter

info "Creating Artifact Registry repository"
if ! gcloud artifacts repositories describe "${REPO}" --location "${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPO}" \
    --location "${REGION}" \
    --repository-format docker \
    --description "UtilityHub container images"
fi

info "Creating Firestore Native database"
if ! gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database="(default)" \
    --location="${REGION}" \
    --type=firestore-native
else
  echo "Firestore (default) already exists"
fi

info "Creating Cloud Storage bucket gs://${BUCKET}"
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --location "${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file="${SCRIPT_DIR}/gcs-lifecycle.json"

CORS_FILE="$(mktemp)"
trap 'rm -f "${CORS_FILE}"' EXIT
cat >"${CORS_FILE}" <<EOF
[
  {
    "origin": ["${HOSTING_ORIGIN}", "${LOCAL_ORIGIN}"],
    "method": ["GET", "HEAD", "PUT", "OPTIONS"],
    "responseHeader": ["Content-Type", "Content-Length", "Content-Range", "ETag", "x-goog-resumable"],
    "maxAgeSeconds": 3600
  }
]
EOF
gcloud storage buckets update "gs://${BUCKET}" --cors-file="${CORS_FILE}"

info "Granting bucket access"
for sa in "${API_SA}" "${WORKER_SA}" "${CLEANUP_SA}"; do
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member "serviceAccount:$(account "${sa}")" \
    --role roles/storage.objectAdmin \
    --quiet >/dev/null
done

info "Creating worker shared secret"
if ! gcloud secrets describe "${SECRET_NAME}" >/dev/null 2>&1; then
  head -c 48 /dev/urandom | base64 | tr -d '\n' \
    | gcloud secrets create "${SECRET_NAME}" --data-file=- --replication-policy=automatic
else
  echo "Secret ${SECRET_NAME} already exists"
fi
for sa in "${API_SA}" "${WORKER_SA}"; do
  gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
    --member "serviceAccount:$(account "${sa}")" \
    --role roles/secretmanager.secretAccessor \
    --quiet >/dev/null
done

info "Firestore rules and indexes"
echo "Deploy them with:"
echo "  firebase deploy --only firestore:rules,firestore:indexes --project ${PROJECT_ID}"

info "Daily cleanup scheduler"
SCHEDULER_URI="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/utilityhub-cleanup:run"
if gcloud scheduler jobs describe utilityhub-cleanup-daily --location "${REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http utilityhub-cleanup-daily \
    --location "${REGION}" \
    --schedule "15 3 * * *" \
    --time-zone "Etc/UTC" \
    --uri "${SCHEDULER_URI}" \
    --http-method POST \
    --oauth-service-account-email "$(account "${SCHEDULER_SA}")" \
    --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform" \
    --quiet
else
  gcloud scheduler jobs create http utilityhub-cleanup-daily \
    --location "${REGION}" \
    --schedule "15 3 * * *" \
    --time-zone "Etc/UTC" \
    --uri "${SCHEDULER_URI}" \
    --http-method POST \
    --oauth-service-account-email "$(account "${SCHEDULER_SA}")" \
    --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform" \
    --quiet
fi

info "Provisioning complete"
cat <<EOF

Next steps:
  1. Add the Hosting domain (${HOSTING_ORIGIN}) and localhost to
     Firebase Authentication → Settings → Authorized domains.
  2. Enable Google and Email/Password providers in Firebase Authentication.
  3. Register a Firebase Web App and collect its config values.
  4. Build and deploy:
       gcloud builds submit --config cloudbuild.yaml \\
         --substitutions=_REGION=${REGION},_BUCKET=${BUCKET},_HOSTING_ORIGIN=${HOSTING_ORIGIN},_FIREBASE_API_KEY=...,_FIREBASE_AUTH_DOMAIN=...,_FIREBASE_PROJECT_ID=${PROJECT_ID},_FIREBASE_APP_ID=...
  5. Deploy Firestore rules/indexes if Cloud Build hosting auth is unavailable:
       firebase deploy --only firestore:rules,firestore:indexes --project ${PROJECT_ID}
  6. See docs/DEPLOYMENT_RUNBOOK.md for verification and rollback.

EOF
