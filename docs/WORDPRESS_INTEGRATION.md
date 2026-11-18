> **Superseded (2026-11-18).** This document describes the pre-GCP
> architecture (MySQL, Prisma, local disk, and/or WordPress identity). It is kept
> for traceability. See [docs/README.md](./README.md) for the current set.

# UtilityHub — WordPress Identity Integration

Version: 1.0
Date: 2026-11-17
Status: contract implemented and tested with controlled fixtures; no live WordPress instance is available in this repository

## 1. Scope

WordPress is an optional identity provider. It is not required for file processing, storage, job claiming, or cleanup. Guest processing remains fully functional when WordPress is absent, misconfigured, or unavailable.

The Node.js backend never reads WordPress tables, never uses WordPress database credentials, and never modifies WordPress users or sessions. WordPress signs a short-lived identity assertion; UtilityHub verifies it with a shared HMAC secret.

## 2. Trust model

```text
Browser -> WordPress (session cookie, WordPress nonce)
Browser -> UtilityHub plugin REST endpoint
WordPress -> signed identity token (shared secret)
Browser -> UtilityHub API (job/upload token + identity header)
UtilityHub API -> verifies signature, issuer, audience, expiry, subject
```

The identity token adds an ownership constraint. It never replaces the capability token. A WordPress-owned job requires both:

1. A valid job capability token.
2. A valid identity token whose subject matches the job owner reference.

A stolen job token alone cannot access an authenticated job.

## 3. Token contract

Format: compact JWT-like token with three base64url segments.

```text
base64url(header).base64url(payload).base64url(HMAC-SHA256(header.payload))
```

Header:

| Claim | Value |
| --- | --- |
| `alg` | `HS256` |
| `typ` | `JWT` |

Payload:

| Claim | Type | Rule |
| --- | --- | --- |
| `iss` | string | Must exactly equal `WORDPRESS_IDENTITY_ISSUER` |
| `sub` | string or integer | WordPress user id; positive decimal string |
| `aud` | string | Must equal `WORDPRESS_IDENTITY_AUDIENCE` |
| `iat` | integer | Unix seconds; not more than 30 seconds in the future |
| `exp` | integer | Unix seconds; must be after `iat` and in the future |
| `jti` | string | Optional unique identifier; maximum 128 characters |

Lifetime must not exceed `WORDPRESS_IDENTITY_MAX_AGE_SECONDS`.

Signature is HMAC-SHA256 over the exact ASCII string `header.payload`, using `WORDPRESS_IDENTITY_SECRET`. Comparison is constant-time.

## 4. Transport

Identity tokens travel in a dedicated request header:

```http
X-UtilityHub-Identity: <token>
```

Never place identity or capability tokens in a URL, query string, referrer, or log message.

| Endpoint | Identity behavior |
| --- | --- |
| `POST /api/v1/uploads` | Optional. A valid identity marks the uploads as `WORDPRESS`. An invalid identity returns `401 INVALID_IDENTITY` and removes temporary files. |
| `POST /api/v1/jobs` | Optional. Must match every input upload. Guest uploads with an identity, or WordPress uploads without one, are rejected. |
| `GET /api/v1/jobs/:id` | Required only when the job owner is `WORDPRESS`. Missing, invalid, or mismatched identity returns `404 UNAUTHORIZED`. |
| `GET /api/v1/jobs/:id/download` | Same rule as status. |
| `DELETE /api/v1/jobs/:id` | Same rule as status. |
| `DELETE /api/v1/uploads/:id` | Required only when the upload owner is `WORDPRESS`. |

Invalid identity headers are ignored for guest jobs and guest uploads so an expired WordPress session cannot break guest processing. Uploads and job creation reject an invalid identity instead of silently creating a guest resource.

## 5. Ownership rules

| Upload identity | Job creation identity | Result |
| --- | --- | --- |
| None | None | Guest job, capability token only |
| Valid subject A | Valid subject A | WordPress job owned by A |
| Valid subject A | Valid subject B | `422 INVALID_INPUT_KIND` |
| Guest | Valid subject A | `422 INVALID_INPUT_KIND` |
| Valid subject A | None | `401 INVALID_IDENTITY` |
| Invalid token | Any | `401 INVALID_IDENTITY` during upload or job creation |

`File.ownerType`, `File.ownerRef`, `Job.ownerType`, and `Job.ownerRef` store the association. Output files inherit the job owner.

## 6. Backend configuration

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `WORDPRESS_IDENTITY_SECRET` | No | 48-character random string | Enables identity verification; shared with WordPress |
| `WORDPRESS_IDENTITY_ISSUER` | With secret | `http://localhost:8080` | Exact WordPress `home_url()` |
| `WORDPRESS_IDENTITY_AUDIENCE` | No | `utilityhub` | Service audience |
| `WORDPRESS_IDENTITY_MAX_AGE_SECONDS` | No | `300` | Maximum accepted token lifetime |

When the secret is empty, identity verification is disabled and only guest processing is available. If a secret is set without an issuer, startup fails with a configuration error.

Generate a local secret:

```bash
openssl rand -hex 32
```

Set the same value in `backend/.env`, the Compose environment, and WordPress `wp-config.php`.

## 7. WordPress setup

1. Copy `wordpress/utilityhub-identity` into `wp-content/plugins/`.
2. Add these constants to `wp-config.php`:

```php
define('UTILITYHUB_IDENTITY_SECRET', 'replace-with-the-same-48-character-secret');
define('UTILITYHUB_IDENTITY_AUDIENCE', 'utilityhub');
define('UTILITYHUB_IDENTITY_MAX_AGE', 300);
```

3. Activate **UtilityHub Identity** in WordPress.
4. Confirm `WORDPRESS_IDENTITY_ISSUER` equals the site `home_url()` exactly, including scheme, host, port, and path.
5. Request a token while signed in:

```bash
curl -sS http://localhost:8080/wp-json/utilityhub/v1/identity \
  -H "X-WP-Nonce: <wp-rest-nonce>" \
  --cookie "<wordpress-session-cookies>"
```

A successful response:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2026-11-17T11:15:30+00:00"
}
```

WordPress cookie authentication for REST requires a valid `X-WP-Nonce`. A WordPress theme or plugin should inject the nonce and fetch the token server-side or through a same-origin request. Do not cache identity tokens in page HTML or shared caches.

## 8. Client usage

Send the identity header only while it is valid:

```bash
curl -sS -X POST http://localhost:4000/api/v1/uploads \
  -H "X-UtilityHub-Identity: $IDENTITY_TOKEN" \
  -F "files=@document.pdf"
```

```bash
curl -sS -X POST http://localhost:4000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -H "X-UtilityHub-Identity: $IDENTITY_TOKEN" \
  -d '{"operation":"rotate-pdf","inputs":[{"fileId":"...","uploadToken":"..."}],"options":{"angle":90,"pages":"all"}}'
```

```bash
curl -sS http://localhost:4000/api/v1/jobs/<jobId> \
  -H "Authorization: Bearer <jobToken>" \
  -H "X-UtilityHub-Identity: $IDENTITY_TOKEN"
```

## 9. Failure behavior

| Condition | Response |
| --- | --- |
| Malformed, forged, expired, wrong issuer, or wrong audience on upload/job creation | `401 INVALID_IDENTITY` |
| Missing/mismatched identity on a WordPress-owned job | `404 UNAUTHORIZED` |
| Missing/mismatched identity on a WordPress-owned upload deletion | `404 UNAUTHORIZED` |
| WordPress unavailable | Guest processing continues; authenticated requests fail closed |
| Secret not configured | Identity features disabled; guest processing continues |

## 10. Verification performed

`backend/tests/identity.test.js` generates controlled HS256 fixtures with the test secret and verifies:

- Authenticated upload and job ownership.
- Status, download, and delete require the matching identity in addition to the job token.
- Guest processing works with no identity and with an invalid identity header.
- Forged signatures, expired tokens, wrong audience, wrong issuer, `alg: none`, and invalid subjects are rejected.
- Cross-identity, guest-to-authenticated, and mixed-owner job creation are rejected.

Run:

```bash
cd backend
npm test -- tests/identity.test.js
```

No live WordPress instance was available. The PHP plugin is provided as the integration layer and has not been executed against a running WordPress installation in this repository.
