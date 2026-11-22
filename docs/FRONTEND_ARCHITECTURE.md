# UtilityHub — Frontend Architecture

Version: 2.0 (GCP cloud-first)
Date: 2026-11-18
Stack: React 19 + Vite 8 (JavaScript), Firebase Hosting, Firebase Authentication

## 1. Principles

- PDFs, images, CSV, JSON, and text are processed by the GCP worker. The browser never processes PDFs.
- DOCX and PPTX are the deliberate local exception. `FileServiceRouter` sends every Office file to `LocalFileAdapter`, which uses browser-capable libraries. Office bytes never enter an upload request.
- The browser uploads **directly to GCS** with short-lived signed URLs. Files never transit the API container's disk.
- The browser authenticates with Firebase and sends an ID token to the API.
- Every visual state maps to a real job or a real local processor. No fake progress. Cloud jobs poll; local Office work shows a browser spinner.
- Client-side utilities are explicitly labelled **INSTANT**, and local Office tools are labelled **● LOCAL**; neither creates a cloud job.

## 2. Directory layout

```text
frontend/
  src/
    App.jsx                    route switch + shell
    main.jsx                   React root
    firebase.js                Firebase app/auth bootstrap
    api.js                     typed API + signed upload client (Office guard)
    tools.js                   catalog fallback, local tools, option helpers, formatting
    services/
      FileServiceRouter.js     local-vs-cloud routing before any upload
      LocalFileAdapter.js      mammoth/docx/JSZip/PptxGenJS processors
      fileTypes.js             Office extension/MIME guards
    context/
      AuthContext.jsx          Firebase session, token accessor, sign-in/out
      ThemeContext.jsx         dark/light theme persistence
      JobsContext.jsx          recent jobs, polling, clear history
    components/
      Header.jsx               brand, search, auth, theme, nav
      MobileNav.jsx            Home / Browse / Recent / Settings
      AuthDialog.jsx           Google + email/password sign-in
      ToolCard.jsx             cloud/instant badge, category label
      ToolIcon.jsx             inline SVG per tool family
      StatBar.jsx              TOOLS | CATEGORIES | CLOUD JOBS
      SearchBar.jsx            accessible filter input
      FileDropzone.jsx         drag/drop + picker
      FileList.jsx             order, remove, size
      JobPanel.jsx             queued/processing/done/failed/expired states
      RecentJobs.jsx           job history list
      Toast.jsx                non-blocking errors
    pages/
      HomePage.jsx             hero, stat bar, search, categories, tools, recent
      ToolPage.jsx             cloud workflow + local/client dispatch
      LocalToolPage.jsx        Office workflow, browser spinner, Blob download
      ClientToolPage.jsx       unit converter / percentage calculator
      RecentPage.jsx           full job history
      SettingsPage.jsx         theme, account, clear history, retention info
    styles.css                 Neo-Brutalist design tokens + layout
  index.html
  firebase.json                Hosting SPA rewrite + cache headers
```

## 3. Routing

| Path | View | Auth |
| --- | --- | --- |
| `/` | Home: hero, stats, categories, searchable tool grid, recent jobs | Public |
| `/tools/:id` | Cloud tool workflow, local Office tool, or client utility | Sign-in required before cloud job creation; local tools are public |
| `/recent` | Job history | Required |
| `/settings` | Theme, account, data controls | Public; account section requires auth |
| unknown | Not found | Public |

Routing uses the History API with a `popstate` listener. Firebase Hosting rewrites all paths to `index.html`.

## 4. Local Office boundary

`FileServiceRouter.route()` runs before any upload. It resolves a request to `local` when the operation is one of `docx-to-txt`, `txt-to-docx`, `pptx-to-txt`, or `txt-to-pptx`, or when any selected file is `.docx`/`.pptx`. `LocalFileAdapter` then processes the file with `mammoth`, `docx`, `JSZip`, `fast-xml-parser`, and `PptxGenJS`.

Defence in depth:

| Layer | Behaviour |
| --- | --- |
| Catalog | Office tools are frontend-only and merged into the API response by `mergeCatalogOperations()` |
| Router | An Office file always routes to `LocalFileAdapter`, even if a cloud operation id is requested |
| API client | `initUploads`, `uploadJobFiles`, and `uploadToSignedUrl` throw `LOCAL_ONLY_FILE` before `fetch`/XHR when an Office file is present |
| Backend | The upload catalog does not list `.docx`/`.pptx`, so the API rejects them as unsupported |
| UI | Office → PDF is never attempted; the required Neo-Brutalist error explains that only text extraction is available |

The local page never polls a job. It shows a browser spinner, then exposes a `Blob` download. `npm run verify:local-office` builds 5 MB DOCX/PPTX inputs and asserts zero `fetch` calls.

## 5. Visual system (Neo-Brutalist)

Tokens:

| Token | Dark | Light |
| --- | --- | --- |
| `--bg` | `#0F0F0F` | `#FAFAFA` |
| `--surface` | `#171717` | `#FFFFFF` |
| `--ink` | `#F5F5F5` | `#0F0F0F` |
| `--muted` | `#A3A3A3` | `#525252` |
| `--line` | `#F5F5F5` | `#0F0F0F` |
| `--mustard` | `#FFD54F` | `#FFD54F` |
| `--mint` | `#69F0AE` | `#69F0AE` |
| `--danger` | `#FF6B6B` | `#D92D20` |

Rules:

- 1px/2px hard borders, 4–6px offset solid shadows, no blur, no gradients.
- Square corners (0–4px) except pills for status badges.
- Anton/Oswald/Archivo Black condensed headings; Inter body; JetBrains Mono metadata.
- Accent blocks are flat mustard or mint with black text.
- Hover moves a card by 2px and increases the offset shadow; focus uses a 3px mustard outline.
- Reduced-motion preference disables transitions and the polling spinner animation.

## 6. Layout

- **Header:** wordmark, tool search, theme toggle, auth button/avatar, desktop nav.
- **Hero:** oversized condensed claim, short cloud-specific copy, primary CTA, `CLOUD`/`GCP` stamps.
- **Stat bar:** `TOOLS | CATEGORIES | CLOUD JOBS`; counts derive from the catalog and the user's job list, never hard-coded.
- **Category chips:** All, PDF, Photo, Data, Text, Utilities — filter the grid without a page reload.
- **Tool cards:** icon, category, name, description, badge (`CLOUD` or `INSTANT`), input summary.
- **Recent jobs:** authenticated only; status, tool, age, expiry, open action.
- **Tool page:** auth gate → dropzone → options → upload progress → job queue → processing poll → download.
- **Mobile nav:** fixed bottom bar with Home, Browse, Recent, Settings; safe-area padding.
- **Settings:** theme, signed-in identity, clear history, retention policy, sign out.

## 7. State model

```text
idle → auth-required → files-selected → uploading → creating-job
     → queued → processing → done | failed | expired
```

Additional states: `catalog-offline`, `quota-exceeded`, `upload-error`, `network-retry`.

Rules:

- `auth-required` is shown before any upload when the user is not signed in.
- Upload progress is real XHR `upload.onprogress` for the signed PUT.
- Job status is polled every 1 s while queued, 1.5 s while processing, with exponential backoff to 5 s after a network error.
- The UI stops polling on `done`, `failed`, or `expired`.
- The download button calls the API for a fresh 5-minute signed URL, then navigates to it.
- Quota errors (`429 QUOTA_EXCEEDED`) render a dedicated state with reset time.

## 8. API client

`src/api.js` exposes:

| Function | Purpose |
| --- | --- |
| `fetchOperations()` | Public catalog |
| `initUploads(files, token)` | Create upload records + signed PUT URLs |
| `putToSignedUrl(url, file, headers, onProgress)` | Direct GCS upload via XHR |
| `createJob(payload, token)` | Create cloud job |
| `fetchJob(id, token)` | Status |
| `fetchMyJobs(token)` | History |
| `getDownloadUrl(id, token)` | Signed download URL |
| `deleteJob(id, token)` | Delete job + files |
| `clearHistory(token)` | Delete all terminal jobs |
| `fetchHealth()` | API status |

All authenticated calls send `Authorization: Bearer <Firebase ID token>`; the token is fetched fresh per request via the auth context.

## 9. Authentication UX

- `AuthDialog` offers Google popup and email/password (sign-in and create account).
- Signed-out users can browse and use client utilities.
- Selecting files as a signed-out user opens the auth dialog and preserves the selection.
- Auth errors are human-readable: popup blocked, wrong password, email in use, network.
- The header shows avatar/initials, email, and a sign-out action.
- When `VITE_FIREBASE_*` variables are absent, the app runs an explicit **DEV SESSION** mode that sends `X-Dev-User`; the UI displays a `DEV` badge. Production builds must provide Firebase config.

## 10. Accessibility

- Semantic landmarks (`header`, `nav`, `main`, `footer`).
- Visible focus rings on every interactive element.
- `aria-live="polite"` on job status; `role="progressbar"` with values.
- Dropzone is keyboard-operable and accepts files via a labelled button.
- Search input has a label and result count announcement.
- Minimum 44px touch targets on mobile.
- Colour contrast ≥ 4.5:1; status is never conveyed by colour alone (label + shape).

## 11. Performance

- Catalog is fetched once and cached in memory; a built-in fallback catalog drives offline rendering.
- No heavy client libraries: only React, Firebase Auth, and the API client.
- Tool icons are inline SVG (no icon font/network dependency).
- Fonts are loaded with `display=swap`; system fallbacks are declared.
- Signed URLs mean uploads use GCS bandwidth, not the Cloud Run API.
- Vite builds hashed assets; Firebase Hosting serves them from its CDN with immutable caching.

## 12. Environment variables

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Cloud Run API origin + `/api/v1` |
| `VITE_FIREBASE_API_KEY` | Firebase web config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase web config |
| `VITE_FIREBASE_PROJECT_ID` | Firebase web config |
| `VITE_FIREBASE_APP_ID` | Firebase web config |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase web config |
| `VITE_DEV_AUTH` | `true` only for local development |

`VITE_*` values are public client configuration, never secrets.
