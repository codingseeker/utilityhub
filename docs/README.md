# UtilityHub Documentation

Version: 2.0 (GCP-native refactor)
Last updated: 2026-11-18

## Current documents

Read these first. They describe the application as it exists in this workspace.

| Document | Purpose |
| --- | --- |
| [`EXISTING_PROJECT_AUDIT.md`](./EXISTING_PROJECT_AUDIT.md) | What the inherited repository contained and what was replaced |
| [`TOOL_INVENTORY.md`](./TOOL_INVENTORY.md) | The 16 cloud operations and 2 client utilities, inputs, limits, and outputs |
| [`FRONTEND_ARCHITECTURE.md`](./FRONTEND_ARCHITECTURE.md) | React/Vite structure, auth, upload/polling flow, design system |
| [`API_CONTRACT.md`](./API_CONTRACT.md) | Authoritative HTTP contract and error codes |
| [`JOB_LIFECYCLE.md`](./JOB_LIFECYCLE.md) | Job states, leases, retries, expiry, cleanup |
| [`GCP_INFRASTRUCTURE.md`](./GCP_INFRASTRUCTURE.md) | Topology, Firestore/GCS design, IAM, secrets, cost model |
| [`GCP_DEPLOYMENT.md`](./GCP_DEPLOYMENT.md) | Provisioning and first-deployment instructions |
| [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) | Release, verification, rollback, and incident procedures |
| [`REFACTORING_PLAN.md`](./REFACTORING_PLAN.md) | Phase plan and acceptance criteria |
| [`TEST_REPORT.md`](./TEST_REPORT.md) | Actual local test/build/browser results and unverified cloud items |

## Historical documents

The following describe the **pre-refactor** architecture (MySQL, Prisma, local
disk, WordPress identity). They are kept for traceability only and are marked
superseded at the top of each file:

- `ARCHITECTURE.md`
- `API_SPECIFICATION.md`
- `DATABASE_DESIGN.md`
- `PROCESSING_PIPELINE.md`
- `PRD.md`
- `SECURITY_DESIGN.md`
- `SECURITY_REVIEW.md`
- `TECHNOLOGY_DECISIONS.md`
- `WORDPRESS_INTEGRATION.md`
- `ENVIRONMENT_AUDIT.md`
- `EXISTING_REPOSITORY_AUDIT.md`

## Source of truth

1. Runtime behavior: `backend/src` and `frontend/src`.
2. API shape: `docs/API_CONTRACT.md`, enforced by `backend/src/routes` and
   `backend/tests/api.test.js`.
3. Infrastructure: `infra/setup-gcp.sh`, `cloudbuild.yaml`, `firebase.json`,
   and the JSON files under `infra/`.
