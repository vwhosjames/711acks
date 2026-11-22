# 711acks — Phase 4B-3: Supabase Edge Functions Deployment Preflight Report

- **Phase:** 4B-3 (Strictly Read-Only Edge Functions Deployment Preflight)
- **Target Project:** `711acks` — Supabase Free Plan, Southeast Asia (Singapore)
- **Live Database Prerequisite Status:** Migrations `001`–`006` applied and verified (`18` RLS-enabled `public` tables, `4` Storage buckets, `16` `storage.objects` policies, `5` verified `SECURITY DEFINER` security functions, `website_settings` singleton present)
- **Inspected Files:**
  - `supabase/config.toml`
  - `supabase/functions/_shared/adminAuthShared.ts`
  - `supabase/functions/_shared/smtpClient.ts`
  - `supabase/functions/admin-auth-initiate/index.ts`
  - `supabase/functions/admin-auth-resend/index.ts`
  - `supabase/functions/admin-auth-verify/index.ts`
  - `supabase/functions/admin-auth-logout/index.ts`
  - `supabase/functions/admin-auth-complete-recovery/index.ts`
  - `supabase/functions/approve-community-submission/index.ts`
  - `src/lib/adminAuthController.ts`, `src/lib/communityApprovalController.ts`, `src/lib/supabaseClient.ts`, `.env.example`
- **Final Verdict:** **`READY TO DEPLOY`**

---

## Executive Summary

All six Supabase Edge Functions, both `_shared` helper modules, `supabase/config.toml`, and their frontend invokers were inspected read-only against the live schema created by migrations `001`–`006`.

- **100% Schema & RPC Alignment:** Every table query, column name, Storage bucket/path rule, and PostgreSQL RPC parameter signature across all six functions matches migrations `001`–`006` exactly.
- **Zero Credential Leaks & Zero OTP Bypass:** No function logs or returns `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_OTP_PEPPER`, `SMTP_PASS`, or plaintext 6-digit OTPs. Neither `admin-auth-initiate` nor `admin-auth-complete-recovery` ever releases a browser session token; `admin-auth-verify` is the sole session minting path after atomic `FOR UPDATE` OTP verification.
- **Strict CORS & Cache Controls:** All six functions enforce explicit `ALLOWED_ORIGINS` validation (`403` on unapproved browser `Origin`, zero wildcard `*`) and emit `Cache-Control: no-store`, `Pragma: no-cache`, and `Vary: Origin`.
- **Two Key Operational Precautions for Manual Deployment:**
  1. Do **not** include `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in `supabase secrets set` — Supabase auto-injects reserved `SUPABASE_*` secrets into Edge Functions and skips/rejects CLI overrides starting with `SUPABASE_`.
  2. Set custom secrets (`ADMIN_OTP_PEPPER`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS`, `SMTP_*`) **before** testing from any browser origin, and verify gateway `verify_jwt = true` compatibility on `admin-auth-logout` and `approve-community-submission` during post-deploy smoke testing (especially if the project issues asymmetric ECC/`ES256` user JWTs).

---

## 1. Six-Function Inventory & Entry Points

All six functions use native `Deno.serve(async (req: Request) => ...)` (compatible with Supabase Edge Runtime / Deno 2) and contain a single `index.ts` entry point with no custom `deno.json` or `import_map.json` required.

| # | Function Name | Entry Point | Lines | HTTP Methods | Auth Gate | Database Tables / RPCs / Storage Touched |
|---|---|---|---|---|---|---|
| 1 | `admin-auth-initiate` | `supabase/functions/admin-auth-initiate/index.ts` | 369 | `OPTIONS`, `POST` | Pre-auth (`verify_jwt = false`) | RPCs: `check_admin_auth_rate_limit`, `record_admin_failed_login`; Tables: `admin_profiles`, `admin_otp_challenges`, `security_events`; Auth: `signInWithPassword` (disposable) + `auth.admin.signOut('local')`; Outbound TLS/STARTTLS SMTP |
| 2 | `admin-auth-resend` | `supabase/functions/admin-auth-resend/index.ts` | 286 | `OPTIONS`, `POST` | Pre-auth (`verify_jwt = false`) | RPCs: `check_admin_auth_rate_limit`, `rotate_admin_otp_challenge_for_resend`; Tables: `admin_otp_challenges`, `security_events`; Outbound TLS/STARTTLS SMTP |
| 3 | `admin-auth-verify` | `supabase/functions/admin-auth-verify/index.ts` | 297 | `OPTIONS`, `POST` | Pre-auth (`verify_jwt = false`) | RPCs: `check_admin_auth_rate_limit`, `verify_admin_otp_challenge`, `revoke_admin_otp_session` (rollback); Auth: `auth.admin.generateLink('magiclink')`, `auth.verifyOtp('magiclink')`, `auth.admin.signOut('local')` (rollback) |
| 4 | `admin-auth-logout` | `supabase/functions/admin-auth-logout/index.ts` | 103 | `OPTIONS`, `POST` | Bearer JWT (`verify_jwt = true`) | Auth: `userClient.auth.getUser()`, `auth.admin.signOut(jwt, 'global')`; RPC: `revoke_admin_otp_session` |
| 5 | `admin-auth-complete-recovery` | `supabase/functions/admin-auth-complete-recovery/index.ts` | 258 | `OPTIONS`, `POST` | Pre-auth (`verify_jwt = false`) | RPCs: `check_admin_auth_rate_limit`, `revoke_admin_otp_session`; Tables: `admin_profiles`; Auth: `verifyOtp('recovery')` or `getUser(accessToken)`, `auth.admin.updateUserById`, `auth.admin.signOut('global')` |
| 6 | `approve-community-submission` | `supabase/functions/approve-community-submission/index.ts` | 403 | `OPTIONS`, `POST` | Bearer JWT (`verify_jwt = true`) + `is_verified_admin()` | Auth: `userClient.auth.getUser()`; RPCs: `is_verified_admin`, `approve_community_submission`; Table: `community_submissions`; Storage: `pending-submissions` (download + delete), `published-drinks` (upload + rollback delete) |

---

## 2. Imports & Shared Dependencies

### External Runtime Import (All 6 Functions)
- `https://esm.sh/@supabase/supabase-js@2.49.4` — Pinned exact minor/patch version across all six `index.ts` files. No unpinned `@2` or `latest` URLs.

### Shared Internal Modules (`supabase/functions/_shared/`)
| Shared Module | Lines | Imported By | Runtime APIs Used |
|---|---|---|---|
| `../_shared/adminAuthShared.ts` | 413 | All 6 functions | Standard Web APIs (`URL`, `Request`, `Response`, `TextEncoder`, `crypto.getRandomValues`, `crypto.subtle`), `Deno.env.get` |
| `../_shared/smtpClient.ts` | 546 | `admin-auth-initiate`, `admin-auth-resend` | Standard Web APIs (`TextEncoder`, `TextDecoder`, `btoa`, `crypto.randomUUID`, `setTimeout`), `Deno.env.get`, `Deno.connectTls`, `Deno.connect`, `Deno.startTls` |

### Dependency Checks
- **Zero Node.js-only packages or `node:*` imports** in any Edge Function or `_shared` module.
- **Zero frontend bundle leakage:** Neither `_shared/adminAuthShared.ts` nor `_shared/smtpClient.ts` is imported by any runtime component under `src/`.
- **TypeScript Ambient Declaration Note (`smtpClient.ts` line 387):** `declare const Deno: DenoSocketRuntime | undefined;` is erased at transpilation time and binds to the native Deno Edge Runtime `Deno` global cleanly at runtime.
- **Bundling Network Prerequisite:** Deploying via Supabase CLI fetches `https://esm.sh/@supabase/supabase-js@2.49.4` during bundling.

---

## 3. Required Environment Secrets & Configuration (Names Only)

### 3.1 Platform Auto-Injected Secrets (Managed Automatically by Supabase)
Do **not** pass `SUPABASE_*` names to `supabase secrets set` (the CLI reserves the `SUPABASE_` prefix and skips/rejects manual writes). Verify they exist automatically in Supabase Edge Runtime:
- `SUPABASE_URL` — Used by all 6 functions.
- `SUPABASE_ANON_KEY` — Used by all 6 functions (for disposable Auth verification or user-scoped clients).
- `SUPABASE_SERVICE_ROLE_KEY` — Used by all 6 functions (strictly server-side for `service_role` RPCs, admin Auth API, or private-to-public Storage promotion).

### 3.2 Custom Secrets to Configure via `supabase secrets set`

| Secret Name | Requirement | Used By | Expected Format / Constraints |
|---|---|---|---|
| `ADMIN_OTP_PEPPER` | **Required** | `admin-auth-initiate`, `admin-auth-resend`, `admin-auth-verify`, `admin-auth-logout`, `admin-auth-complete-recovery` | High-entropy random secret (recommended 64-char hex / >= 32 random bytes). Missing value causes `503` on all 5 auth functions (including `admin-auth-logout`, which calls `getRequiredAdminAuthEnv()`). |
| `ALLOWED_ORIGINS` | **Required for Browser Access** | All 6 functions | Comma-separated exact browser origin(s) (`https://your-domain.vercel.app`). No trailing slash, no wildcard `*`, no credentials in URL. |
| `ALLOW_LOCALHOST_CORS` | Optional (default empty/`false`) | All 6 functions | Set to `"false"` in production. Only `"true"` appends `http://localhost:3000` and `http://127.0.0.1:3000`. |
| `ADMIN_OTP_VALIDITY_MINUTES` | Optional (default `120`) | `admin-auth-verify` | Integer clamped to `[15, 480]`. Controls absolute OTP session cap (30-min inactivity cap remains enforced by `is_verified_admin()`). |
| `SMTP_HOST` | **Required** | `admin-auth-initiate`, `admin-auth-resend` | Validated hostname with no CR/LF/NUL (e.g., Gmail SMTP host). |
| `SMTP_PORT` | Optional (default `465`) | `admin-auth-initiate`, `admin-auth-resend` | Strictly `465` (implicit TLS) or `587` (STARTTLS). **Any other port causes `loadSmtpConfigFromEnv()` to return `null` (`503`).** |
| `SMTP_SECURE` | Optional (defaults to `true` on `465`, `false` on `587`) | `admin-auth-initiate`, `admin-auth-resend` | Explicitly set `"true"` with port `465`, or `"false"` with port `587`. |
| `SMTP_USER` | **Required** | `admin-auth-initiate`, `admin-auth-resend` | Authenticated SMTP username / Gmail address (no CR/LF/NUL). |
| `SMTP_PASS` | **Required** | `admin-auth-initiate`, `admin-auth-resend` | 16-character Google App Password (requires 2-Step Verification on Gmail). |
| `SMTP_FROM` | Optional (defaults to `SMTP_USER`) | `admin-auth-initiate`, `admin-auth-resend` | Bare email or `"Display Name <email>"`. Bare address must pass RFC-style validation and match `SMTP_USER` for Gmail acceptance. |

---

## 4. JWT Verification Settings (`supabase/config.toml`)

| Function Name | `supabase/config.toml` | Handler-Level Auth Enforcement | Rationale |
|---|---|---|---|
| `admin-auth-initiate` | `verify_jwt = false` | Rate limits + owner email/password verified via disposable Auth client | Runs before any user JWT exists; also avoids gateway rejection if frontend uses opaque `sb_publishable_*` keys. |
| `admin-auth-resend` | `verify_jwt = false` | Fail-closed IP rate limit + constant-time `challengeToken` hash match in `FOR UPDATE` RPC | Runs between Step 1 and Step 2 before any user JWT exists. |
| `admin-auth-verify` | `verify_jwt = false` | Fail-closed IP rate limit + constant-time `challengeToken` & `otpCode` HMAC verification in `FOR UPDATE` RPC | Runs at Step 2 to mint the initial post-OTP JWT. |
| `admin-auth-complete-recovery` | `verify_jwt = false` | Fail-closed IP rate limit + server-side `verifyOtp('recovery')`/`getUser()` + `owner` check | Runs on `/admin` recovery link without browser session hydration (`detectSessionInUrl: false`). |
| `admin-auth-logout` | `verify_jwt = true` | Requires `Authorization: Bearer <jwt>` + `userClient.auth.getUser()` | Only invoked with an active post-OTP admin session JWT. |
| `approve-community-submission` | `verify_jwt = true` | Requires `Authorization: Bearer <jwt>` + `userClient.auth.getUser()` + `userClient.rpc('is_verified_admin')` + user-scoped DB RPC | Privileged moderation endpoint; double-checks verified owner status in Edge Function and PostgreSQL. |

---

## 5. CORS Allowlist Behavior & Production `ALLOWED_ORIGINS` Requirements

Inspected in `supabase/functions/_shared/adminAuthShared.ts` (lines 45–196):

1. **Strict Origin Normalization:** Each comma-separated entry in `ALLOWED_ORIGINS` is parsed via `new URL(...)`. Only `http:` and `https:` origins without credentials are accepted; `*` is explicitly rejected (`normalizeOrigin` returns `null`).
2. **Preflight (`OPTIONS`) & Request Enforcement:** Every one of the six functions runs `handleAdminPreflight(req)` on `OPTIONS` and `rejectIfDisallowedOrigin(req)` before parsing JSON or touching Supabase.
   - **Approved browser `Origin`:** Returns `Access-Control-Allow-Origin: <exact origin>`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Vary: Origin`, `Cache-Control: no-store`, `Pragma: no-cache`.
   - **Unapproved browser `Origin` (or blank `ALLOWED_ORIGINS` in prod):** Returns **HTTP `403`** (`{"error":"Forbidden: Origin is not allowed."}`) with **no** `Access-Control-Allow-Origin` header and `Cache-Control: no-store`.
   - **No `Origin` header (non-browser CLI/`curl` requests):** Allowed through `isOriginAllowed()` with **no** `Access-Control-Allow-Origin` header; handler auth/rate-limit/input checks still apply.
3. **Production Rule:**
   - Set `ALLOWED_ORIGINS` to the exact production Vercel domain (e.g., `https://711acks.vercel.app` or your custom HTTPS domain, comma-separated if multiple) with **no trailing slash**.
   - Keep `ALLOW_LOCALHOST_CORS="false"` in production.
   - Note: Vercel Preview deployments generate unique subdomains; they will be blocked with `403` unless explicitly added to `ALLOWED_ORIGINS` (recommended: test admin auth strictly on the primary production domain).

---

## 6. End-to-End Authentication & Moderation Flow Verification

1. **Step 1 — Initiate (`admin-auth-initiate`):**
   - Browser calls `db.functions.invoke('admin-auth-initiate', { body: { email, password } })` (never `supabase.auth.signInWithPassword`).
   - Enforces fail-closed IP limit (`15 / 15m`), checks `admin_profiles` (`role = 'owner'`), checks `locked_until`, verifies password on a disposable client and immediately signs out that token (`signOut(..., 'local')`).
   - Wrong password invokes atomic `record_admin_failed_login` (`5` failures -> 15m lock) with a `>= 250ms` timing floor.
   - Valid password enforces fail-closed OTP issuance limit (`5 / 15m`), clears `otp_verified_until` & prior challenges, stores HMAC-SHA256 OTP + SHA-256 challenge token hashes, sends email via TLS/STARTTLS SMTP (invalidating challenge immediately if SMTP throws/times out), and returns `{ challengeId, challengeToken, email, expiresAt, resendAvailableAt, maxAttempts }` with **zero session tokens**.
2. **Step 1B — Resend (`admin-auth-resend`):**
   - Enforces fail-closed IP limit (`10 / 15m`), then calls atomic `rotate_admin_otp_challenge_for_resend` (`FOR UPDATE` row lock, constant-time token check, 30s cooldown, per-admin `5 / 15m` limit, old-challenge invalidation + new challenge insert in one transaction).
   - Dispatches new OTP via SMTP (invalidating the newly inserted challenge if SMTP fails).
3. **Step 2 — Verify (`admin-auth-verify`):**
   - Enforces fail-closed IP limit (`20 / 15m`), then calls `verify_admin_otp_challenge` (`FOR UPDATE` lock, constant-time token & OTP hash comparison, 5-min expiry, 5-attempt max, single-use consumption).
   - On success, `verify_admin_otp_challenge` sets both `otp_verified_until` and `last_active_at = now()` (matching Migration `006`'s tightened `is_verified_admin()`).
   - Only then mints a real Supabase session (`auth.admin.generateLink({ type: 'magiclink' })` + `exchangeClient.auth.verifyOtp({ token_hash, type: 'magiclink' })`), rolling back both Auth session and `otp_verified_until` if minting fails or user ID mismatches.
   - Browser hydrates the returned session strictly in memory (`persistSession: false`).
4. **Session Revocation (`admin-auth-logout`):**
   - Validates Bearer JWT via `userClient.auth.getUser()`, clears `otp_verified_until` and pending challenges via `revoke_admin_otp_session`, and globally signs out the JWT (`auth.admin.signOut(jwt, 'global')`).
5. **Password Recovery (`admin-auth-complete-recovery`):**
   - Browser parses `/admin` recovery link strictly in memory (`detectSessionInUrl: false`) and scrubs the URL via `history.replaceState`.
   - Function enforces IP limit (`10 / 15m`), validates `tokenHash` or `accessToken` on a disposable client, verifies `role = 'owner'`, enforces 12+ char mixed-class password, updates password via `auth.admin.updateUserById`, calls `revoke_admin_otp_session`, resets lockout/OTP fields, globally signs out the disposable token, and returns zero tokens (requiring full Password + OTP login).
6. **Community Approval & Image Promotion (`approve-community-submission`):**
   - Validates Bearer JWT (`getUser()`) AND `userClient.rpc('is_verified_admin')`, checks submission is `Pending`, downloads private image from `pending-submissions`, validates MIME (`image/jpeg`, `image/png`, `image/webp`) and `<= 5 MB`, uploads to `published-drinks` at `community/<submissionId>/<filename>` (matching Migration `003` regex), commits via user-scoped `approve_community_submission` RPC (`004`), rolls back promoted image on DB failure, and removes the pending file on commit.

### Compatibility with Live Migrations `001`–`006`
- **Every RPC name, argument list, return column, and role grant matches `001`–`006` 1:1:**
  - `check_admin_auth_rate_limit(text, int, int)` (`006`, `service_role`)
  - `record_admin_failed_login(uuid, int, int, text)` (`006`, `service_role`)
  - `rotate_admin_otp_challenge_for_resend(uuid, text, uuid, text, text, timestamptz, timestamptz, int, text)` (`006`, `service_role`)
  - `verify_admin_otp_challenge(uuid, text, text, int)` (`006`, `service_role`)
  - `revoke_admin_otp_session(uuid, text, text)` (`005`, `service_role`)
  - `is_verified_admin()` (`006`, `anon, authenticated`)
  - `approve_community_submission(uuid, text, text, drink_category, text, text, jsonb, text, text)` (`004`, `authenticated`)

---

## 7. Security Audit Check (Credential Exposure & OTP Bypass)

- **Privileged Credentials:** **PASS** — `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_OTP_PEPPER`, `SMTP_USER`, `SMTP_PASS`, and plaintext OTP codes are never serialized into responses, error bodies, `security_events`, or console output.
- **OTP Bypass Prevention:** **PASS** — Pre-OTP password tokens are revoked locally before returning from `admin-auth-initiate`; recovery tokens are revoked globally in `admin-auth-complete-recovery`; `is_verified_admin()` requires `otp_verified_until > now()` and `last_active_at` within the inactivity window.
- **Trusted IP Extraction:** **PASS** — `extractTrustedClientIp()` reads `cf-connecting-ip` -> `x-real-ip` -> `x-envoy-external-address` -> rightmost public `x-forwarded-for` -> `'untrusted-ip-fallback'` (never trusting spoofable leftmost `X-Forwarded-For`).
- **Minor Non-Blocking Observations:**
  1. `approve-community-submission` forwards Supabase error `.message` strings in `400`/`500`/`502` JSON bodies strictly after passing JWT + `is_verified_admin()` verification (not exposed to public visitors, and contains no secrets).
  2. `admin-auth-logout` does not inspect the boolean result of `revoke_admin_otp_session` (safe because `revoke_admin_otp_session` restricts updates to `role = 'owner'` and returns `false` harmlessly for non-owners).

---

## 8. Deployment Order & Exact Supabase CLI Commands (For Manual Review Only)

### Does Deployment Order Matter?
- **Among the 6 functions:** No strict runtime dependency exists between functions (none invokes another Edge Function over HTTP; `_shared/*` is bundled into each function individually).
- **Secrets vs. Functions:** Configure all custom secrets **first** (or immediately after linking) so deployed functions do not respond with `503` (missing `ADMIN_OTP_PEPPER`/`SMTP_*`) or `403` (empty `ALLOWED_ORIGINS`).
- **Directory Requirement:** Always run `supabase functions deploy` from the **repository root** so the CLI reads `supabase/config.toml` automatically.

### Exact Manual CLI Sequence (Do Not Execute Until Approved)

```bash
# 1. Authenticate Supabase CLI and link to the 711acks Singapore project
supabase login
supabase link --project-ref <YOUR_711ACKS_PROJECT_REF>

# 2. Set custom server-side Edge Function secrets (NEVER include SUPABASE_* reserved vars)
#    Use a freshly generated 64-character random hex string for ADMIN_OTP_PEPPER
#    and your 16-character Google 2SV App Password for SMTP_PASS.
supabase secrets set \
  ADMIN_OTP_PEPPER="<GENERATED_64_CHAR_RANDOM_HEX>" \
  ADMIN_OTP_VALIDITY_MINUTES="120" \
  ALLOWED_ORIGINS="https://<YOUR_VERCEL_DOMAIN>" \
  ALLOW_LOCALHOST_CORS="false" \
  SMTP_HOST="smtp.gmail.com" \
  SMTP_PORT="465" \
  SMTP_SECURE="true" \
  SMTP_USER="<OWNER_GMAIL_ADDRESS>" \
  SMTP_PASS="<16_CHAR_GOOGLE_APP_PASSWORD>" \
  SMTP_FROM="711acks Security <OWNER_GMAIL_ADDRESS>"

# 3. Verify secret names are registered (prints digests only, never plaintext values)
supabase secrets list

# 4. Deploy pre-authentication functions (verify_jwt = false per supabase/config.toml)
supabase functions deploy admin-auth-initiate --no-verify-jwt
supabase functions deploy admin-auth-resend --no-verify-jwt
supabase functions deploy admin-auth-verify --no-verify-jwt
supabase functions deploy admin-auth-complete-recovery --no-verify-jwt

# 5. Deploy authenticated admin functions (verify_jwt = true per supabase/config.toml)
supabase functions deploy admin-auth-logout
supabase functions deploy approve-community-submission

# 6. Confirm all 6 functions are ACTIVE with expected JWT settings
supabase functions list
```

> **Note on `--no-verify-jwt`:** Even though `supabase/config.toml` already sets `verify_jwt = false` on the four pre-auth functions and `verify_jwt = true` on the two authenticated functions, explicitly passing `--no-verify-jwt` on Step 4 guarantees consistent CLI behavior across all Supabase CLI versions. Confirm every function's JWT toggle in **Supabase Dashboard -> Edge Functions** after Step 6.

---

## 9. Post-Deployment Smoke-Test Plan

Execute in two stages: **Stage A** immediately after Phase 4B-3 deployment (no owner account required yet), and **Stage B** after Phase 4B-4 (single owner account provisioned) and Phase 4B-5 (Vercel deployed).

### Stage A — Immediate Post-Deploy Verification (No Owner Account Needed)
1. **CORS Rejection Check (All 6 Functions):**
   - Send `OPTIONS` and `POST` with `Origin: https://evil.example.com` -> Expect **HTTP `403`**, `Cache-Control: no-store`, and **no** `Access-Control-Allow-Origin` header.
2. **CORS Approval Check (All 6 Functions):**
   - Send `OPTIONS` with `Origin: https://<YOUR_VERCEL_DOMAIN>` -> Expect **HTTP `200`** (`ok`), `Access-Control-Allow-Origin: https://<YOUR_VERCEL_DOMAIN>`, `Vary: Origin`, `Cache-Control: no-store`.
3. **Method Guard Check:**
   - Send `GET` to each endpoint -> Expect **HTTP `405`** (`Method not allowed.`) on the 4 pre-auth functions (and `401`/`405` on the 2 JWT-gated functions).
4. **Configuration & Auth Boundary Check (No `503`):**
   - `POST admin-auth-initiate` with fake email/password (from allowlisted origin) -> Expect **HTTP `401`** (`Invalid administrator credentials.`), confirming `ADMIN_OTP_PEPPER`, `SMTP_*`, and `check_admin_auth_rate_limit` RPC are wired cleanly (a `503` indicates a missing/invalid secret or RPC issue).
   - `POST admin-auth-resend` with malformed payload -> Expect **HTTP `400`** (`challengeInvalidated: true`), not `503`.
   - `POST admin-auth-verify` with invalid UUID/token -> Expect **HTTP `400`** (`challengeInvalidated: true`), not `503`.
   - `POST admin-auth-complete-recovery` with missing token -> Expect **HTTP `400`**, not `503`.
   - `POST admin-auth-logout` without `Authorization` header -> Expect **HTTP `401`**.
   - `POST approve-community-submission` without `Authorization` header -> Expect **HTTP `401`**.

### Stage B — Full Live E2E Verification (After Owner Account + Vercel Live)
1. **Real SMTP & Step 1 -> Step 2 Login:**
   - Sign in on `/admin` with real owner credentials -> Confirm `admin-auth-initiate` delivers 6-digit OTP to owner Gmail within `<15s` (verifies outbound Deno TLS socket connectivity to `smtp.gmail.com:465`), and confirm zero session tokens appear in network response or browser storage.
   - Test `admin-auth-resend` after 30s cooldown -> Confirm old OTP is invalidated and new OTP succeeds in `admin-auth-verify`.
   - Verify `admin-auth-verify` returns a live session and `/admin` dashboard loads cleanly.
2. **Gateway `verify_jwt = true` Check (Crucial for ECC/ES256 Projects):**
   - While signed in post-OTP, approve a test pending community submission (with a real uploaded image in `pending-submissions`) -> Confirm `approve-community-submission` returns `200`, promotes image to `published-drinks/community/<id>/...`, and removes the pending file.
   - Click Logout -> Confirm `admin-auth-logout` returns `200`, clears `admin_profiles.otp_verified_until = null`, and rejects any replayed JWT with `401`/`403`.
3. **Password Recovery Check:**
   - Trigger owner password recovery -> Open `/admin` recovery link -> Confirm `admin-auth-complete-recovery` updates password, revokes all sessions, returns zero tokens, and enforces fresh Step 1 Password + Step 2 Email OTP sign-in.

---

## 10. Risks & Potential Blockers to Monitor During Live Rollout

| # | Risk / Watch Item | Severity | Mitigation / Action Plan |
|---|---|---|---|
| 1 | **Outbound SMTP Port 465/587 Reachability from Supabase Edge Runtime** | Medium | Direct Deno sockets (`smtpClient.ts`) have not yet been tested live over Supabase's cloud egress. If port `465` (`SMTP_SECURE="true"`) times out during Stage B testing, test port `587` (`SMTP_SECURE="false"`, mandatory `STARTTLS`) via `supabase secrets set`. |
| 2 | **Gateway `verify_jwt = true` with Asymmetric (`ES256`) JWT Signing Keys** | Medium | Newer Supabase projects may sign user JWTs with asymmetric ECC (`ES256`) keys; some Edge gateway versions only validate legacy `HS256` tokens when `verify_jwt = true`. Verify `admin-auth-logout` and `approve-community-submission` during Stage B. Both handlers already enforce `userClient.auth.getUser()` (and `is_verified_admin()`) internally if gateway verification needs adjustment later. |
| 3 | **Missing or Mismatched `ALLOWED_ORIGINS`** | Medium | Because `ALLOW_LOCALHOST_CORS` is `"false"` in production, any typo or trailing slash in `ALLOWED_ORIGINS` will cause `403` on all 6 functions. Update `ALLOWED_ORIGINS` immediately once the final Vercel production URL is known. |
| 4 | **`SUPABASE_*` Prefix Passed to `supabase secrets set`** | Low | Supabase CLI skips/rejects user-defined secrets starting with `SUPABASE_`. Only pass the custom secrets (`ADMIN_OTP_*`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS`, `SMTP_*`). |
| 5 | **`SMTP_FROM` Mismatch with `SMTP_USER` on Gmail** | Low | Gmail may reject or rewrite `From:` if the bare email inside `SMTP_FROM` differs from the authenticated `SMTP_USER` account. Keep both email addresses identical. |
| 6 | **Implicit vs. PKCE Recovery Link Format** | Low | `src/lib/supabaseClient.ts` uses default implicit flow (matching `parsePasswordRecoveryUrl()` and `admin-auth-complete-recovery`). Keep Supabase Auth's default recovery template (or ensure `?token_hash={{ .TokenHash }}&type=recovery` / `#access_token=...&type=recovery` targeting `/admin`). |

---

## 11. Final Verdict

### **`READY TO DEPLOY`**

All six Supabase Edge Functions, shared modules, `supabase/config.toml`, CORS controls, secret requirements, and PostgreSQL RPC/Storage integrations are fully verified and compatible with live migrations `001`–`006`. No code, SQL, or configuration fixes are needed prior to Phase 4B-3 deployment. Ready to proceed with manual secret setup and CLI deployment upon your approval.
