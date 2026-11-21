# 711acks — Phase 3.5 Security Audit & Live Readiness Review

- **Audit Type:** Independent Read-Only Code, Database, Edge Function, and Session Security Audit
- **Scope:** Phase 3 Server-Side Email OTP & Secure Admin Authentication + Cross-Check of Migrations `001`–`005` and Phase 2D Edge Function
- **Environment State:** Offline / Local Preview Mode (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` unset; no live Supabase project or live SMTP server tested)
- **Final Readiness Verdict:** **`READY AFTER REQUIRED FIXES`**

---

## 1. Files and Functions Inspected

### Supabase Edge Functions & Shared Modules
- `supabase/functions/_shared/adminAuthShared.ts` — `buildAdminCorsHeaders`, `jsonAdminResponse`, `generateSecureSixDigitOtp`, `generateChallengeToken`, `sha256Hex`, `computeServerOtpHash`, `extractAnonymizedIpHash`, `getRequiredAdminAuthEnv`
- `supabase/functions/_shared/smtpClient.ts` — `loadSmtpConfigFromEnv`, `assertNoHeaderInjection`, `SmtpSocketSession`, `dotStuffBody`, `sendAdminOtpEmailViaSmtp`
- `supabase/functions/admin-auth-initiate/index.ts` — `Deno.serve` Step 1 password check, lockout, rate limiting, challenge creation, SMTP dispatch
- `supabase/functions/admin-auth-resend/index.ts` — `Deno.serve` cooldown, challenge invalidation, SMTP resend
- `supabase/functions/admin-auth-verify/index.ts` — `Deno.serve` Step 2 atomic OTP check, session minting (`generateLink` + `verifyOtp`), rollback on failure
- `supabase/functions/admin-auth-logout/index.ts` — `Deno.serve` JWT authentication, `revoke_admin_otp_session`, `auth.admin.signOut(..., 'global')`
- `supabase/functions/approve-community-submission/index.ts` — Phase 2D compatibility, JWT + `is_verified_admin()` checks, CORS headers, Storage promotion

### SQL Migrations (`001`–`005`)
- `supabase/migrations/001_711acks_schema.sql` — base schema, RLS enablement, initial policies, `is_verified_admin()`
- `supabase/migrations/002_phase2_database_foundation.sql` — hardened `is_verified_admin()`, `touch_admin_activity()`, `website_settings`, RLS hardening, public/admin RPCs and grants
- `supabase/migrations/003_storage_setup.sql` — 4 buckets (`pending-submissions`, `published-drinks`, `verified-products`, `private-admin-backups`) and `storage.objects` policies
- `supabase/migrations/004_phase2d_security_hardening.sql` — dropped direct public INSERT policies, `submit_community_hack`, `resolve_unique_recipe_slug`, `save_recipe_with_ingredients`, `approve_community_submission`
- `supabase/migrations/005_phase3_admin_otp_auth.sql` — `uq_admin_profiles_single_owner`, `admin_otp_challenges` columns/indexes, `admin_auth_rate_limits`, `check_admin_auth_rate_limit`, `verify_admin_otp_challenge`, `revoke_admin_otp_session`, `service_role`-only grants

### Frontend Authentication, Client & Configuration
- `src/lib/supabaseClient.ts` — Supabase client initialization (`persistSession: false`, `detectSessionInUrl: false`)
- `src/lib/adminAuthController.ts` — Edge Function invokers, cryptographic helpers, `evaluateIsVerifiedAdmin`, server orchestration mirror
- `src/lib/supabaseRepository.ts` — `assertNoSupabaseError`, `touchAdminActivityInDb`, admin read/write wrappers
- `src/lib/communityApprovalController.ts` — `invokeApproveCommunitySubmissionEdgeFunction`
- `src/context/AppContext.tsx` — `initiateAdminLogin`, `verifyAdminOtp`, `resendAdminOtp`, `logoutAdmin`, `expireAdminSession`, `touchAdminActivity`, `requestPasswordRecovery`, `onAuthStateChange`
- `src/pages/AdminDashboardPage.tsx` — two-step login/OTP form, loading states, resend cooldown, session expiration notices
- `.env.example` — client vs. server-side secret separation

---

## 2. Verified Security Controls

The following controls were independently verified directly in the source code and SQL migrations:

| Area | Verified Implementation |
|---|---|
| **No Pre-OTP Browser Session** | `src/` contains zero executable calls to `supabase.auth.signInWithPassword()`. Step 1 runs strictly inside `admin-auth-initiate/index.ts` using a disposable `persistSession: false` client whose short-lived token is immediately revoked via `serviceClient.auth.admin.signOut(..., 'local')` and never returned to the browser. |
| **Memory-Only Browser Session** | `src/lib/supabaseClient.ts` configures `persistSession: false` and `detectSessionInUrl: false`. Live admin tokens are never written to `localStorage`, and no remember-me bypass exists. |
| **Atomic Single-Use OTP Verification** | `public.verify_admin_otp_challenge` (`005_phase3_admin_otp_auth.sql`) locks the challenge row and `admin_profiles` row with `FOR UPDATE` in a single PostgreSQL transaction, validates token hash, expiry, attempt cap, owner role, lockout, and HMAC OTP hash, then marks all active challenges `used = true` before setting `otp_verified_until` and `last_active_at`. |
| **Post-OTP Session Minting & Rollback** | `admin-auth-verify/index.ts` mints a Supabase Auth session (`generateLink` + `verifyOtp`) only after `verify_admin_otp_challenge` returns `verified === true`, verifies `sessionData.user.id === result.admin_id`, and invokes `revoke_admin_otp_session` if either `generateLink` or `verifyOtp` fails. |
| **Cryptographic OTP & Secret Storage** | 6-digit OTPs use Web Crypto CSPRNG (`crypto.getRandomValues`) with rejection sampling (`< 4,294,000,000`, zero modulo bias). Only `HMAC-SHA256(ADMIN_OTP_PEPPER, "${challengeId}:${otpCode}")` and `SHA-256(challengeToken)` are stored. Zero plaintext OTPs or credentials are logged or returned in API payloads. |
| **Single-Owner & No Client Escalation** | `uq_admin_profiles_single_owner` enforces at most one `role = 'owner'` row. `admin_profiles` has SELECT-own-row only; `admin_otp_challenges` and `admin_auth_rate_limits` have RLS enabled with zero `anon`/`authenticated` policies. All three Phase 3 functions are `SECURITY DEFINER`, pin `set search_path = public, pg_temp`, and are revoked from `public, anon, authenticated` (granted strictly to `service_role`). |
| **Session Lifetime Relationship** | `public.is_verified_admin()` (`002_phase2_database_foundation.sql` lines 185–190) combines `otp_verified_until > now()` **AND** `last_active_at > now() - make_interval(mins => coalesce(ws.session_timeout_minutes, 30))`. `ADMIN_OTP_VALIDITY_MINUTES` (default 120m, clamped 15–480m) acts strictly as an absolute upper ceiling and never extends or overrides the 30-minute inactivity timeout. `AppContext.tsx` likewise computes `Math.min(otpVerifiedUntilMs, now + timeoutMs)`. |
| **Storage & RLS Consistency** | Migrations `001`–`004` were preserved intact. All four Storage buckets and all admin tables/RPCs continue to rely on `public.is_verified_admin()`. `approve-community-submission/index.ts` verifies both `userClient.auth.getUser()` and `userClient.rpc('is_verified_admin')` and delegates final approval to the user-scoped `approve_community_submission` RPC. |
| **Memory Cleanup on Logout/Timeout** | `AppContext.tsx` clears `adminSession`, `pendingOtpChallenge`, and all privileged admin collections (`priceHistory`, `recipePriceSnapshots`, `communitySubmissions`, `productSuggestions`, `recipeRevisions`, `contactReports`, `securityEvents`, `backupRecords`) immediately upon logout, timeout, or `SIGNED_OUT`. |
| **Frontend Secret Isolation & Dependencies** | Zero `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASS`, or `ADMIN_OTP_PEPPER` references exist in `src/`. `bun audit` reported **0 vulnerabilities** across 151 packages. |

---

## 3. Audit Findings

### Critical Findings

*None identified.*

---

### High Findings

#### H-01 — Server-Side `touch_admin_activity()` Expiration Is Never Detected by the Frontend
- **Location:**
  - `src/context/AppContext.tsx` (`touchAdminActivity`, lines 666–707)
  - `src/lib/supabaseRepository.ts` (`assertNoSupabaseError`, lines 67–77; `touchAdminActivityInDb`, lines 996–1003)
  - `supabase/migrations/002_phase2_database_foundation.sql` (`public.touch_admin_activity`, lines 725–744)
- **What Was Found:**
  When `public.touch_admin_activity()` rejects an expired or revoked session, it executes `raise exception 'UNAUTHORIZED: Verified admin session required.';` without a custom SQLSTATE. PostgREST returns `error.code = 'P0001'` and `error.message = 'UNAUTHORIZED: Verified admin session required.'` (or `PGRST301` / `42501` if the JWT itself is rejected). However, `AppContext.tsx` line 697 checks only:
  ```ts
  if (err instanceof SupabaseRepositoryError && err.code === 'UNAUTHORIZED')
  ```
  Because `err.code` will be `'P0001'` (not `'UNAUTHORIZED'`), this branch will **never trigger** in live Supabase. Furthermore, lines 686–694 optimistically advance the local `adminSession.expiresAt` countdown *before* the async RPC finishes.
- **Impact:** PostgreSQL RLS and `is_verified_admin()` still protect all backend data, so no unauthorized read or write can succeed. However, if the server revokes or expires the session (e.g., via another tab, server clock drift, or admin revocation), the dashboard UI will stay unlocked and show a falsely refreshed timer until a later mutation fails.
- **Required Fix:** Update `AppContext.tsx` to detect server-side auth rejection across `'UNAUTHORIZED'`, `'PGRST301'`, `'42501'`, and `P0001` messages containing `UNAUTHORIZED`, and avoid extending local `expiresAt` until `touchAdminActivityInDb` succeeds (or roll back / expire immediately when rejected).

#### H-02 — Custom SMTP Client Lacks Socket Timeouts and Fails When `SMTP_FROM` Includes a Display Name
- **Location:**
  - `supabase/functions/_shared/smtpClient.ts` (`loadSmtpConfigFromEnv`, lines 29–53; `SmtpSocketSession.readResponse`, lines 93–118; `sendAdminOtpEmailViaSmtp`, lines 151–239)
- **What Was Found:**
  1. **No socket/operation timeouts:** `Deno.connectTls`, `Deno.connect`, `Deno.startTls`, `conn.read`, and `conn.write` have no timeout wrapper. If an SMTP server stalls or silently drops packets, the Edge Function hangs until Deno forcibly terminates the worker — bypassing the `catch` block that marks the newly inserted OTP challenge `used = true` and preventing a clean `503` response.
  2. **`SMTP_FROM` syntax hazard:** Lines 199 and 215 format:
     ```ts
     await session.sendCommand(`MAIL FROM:<${cleanFrom}>`, [250]);
     ...
     `From: 711acks Security <${cleanFrom}>`,
     ```
     If `SMTP_FROM` is configured with a display name (such as `711acks Security <owner@gmail.com>`), this produces `MAIL FROM:<711acks Security <owner@gmail.com>>` and a double-wrapped `From:` header, which Gmail SMTP rejects with `555 5.5.2 Syntax error`. `cleanFrom` is also not validated with an email format regex (unlike `cleanTo`).
  3. **Unbounded response buffer:** `readResponse()` appends incoming socket chunks to `this.buffer` with no maximum byte cap and does not verify that `EHLO` advertised `STARTTLS` or `AUTH LOGIN` before proceeding.
- **Impact:** High risk of live OTP email delivery failures on initial Gmail configuration (`SMTP_FROM` format) and hanging Edge Function invocations on transient SMTP network stalls.
- **Required Fix:**
  - Enforce a strict per-operation and overall SMTP timeout (e.g., 10–15 seconds total) with guaranteed `conn.close()` cleanup.
  - Validate `SMTP_FROM` as a bare email address (or parse/extract the bare address for `MAIL FROM:<addr>` while formatting `From:` cleanly without double angle brackets).
  - Cap `SmtpSocketSession.buffer` size (e.g., 64 KB) and verify `EHLO` responses advertise `STARTTLS` (when `port === 587`) and `AUTH` before sending credentials.

#### H-03 — Wildcard CORS (`Access-Control-Allow-Origin: '*'`) Remains on `approve-community-submission`
- **Location:** `supabase/functions/approve-community-submission/index.ts` (lines 49–64, `CORS_HEADERS` and `jsonResponse`)
- **What Was Found:** Unlike the four Phase 3 Edge Functions (which use `buildAdminCorsHeaders(req)` and `Cache-Control: no-store`), the Phase 2D `approve-community-submission` Edge Function still hardcodes `'Access-Control-Allow-Origin': '*'` and omits `'Cache-Control': 'no-store'`.
- **Impact:** Although the endpoint requires a valid Bearer JWT and `is_verified_admin()`, emitting wildcard CORS on a privileged admin mutation endpoint weakens origin isolation and diverges from the security baseline established in Phase 3.
- **Required Fix:** Import and use `buildAdminCorsHeaders(req)` and `jsonAdminResponse(req, ...)` (with `Cache-Control: no-store`) from `../_shared/adminAuthShared.ts` inside `approve-community-submission/index.ts`.

---

### Medium Findings

#### M-01 — Fail-Open Rate-Limit Checks and Concurrent Race Windows in Initiate, Resend, and Rate-Limit SQL
- **Location:**
  - `supabase/functions/admin-auth-initiate/index.ts` (lines 167–180, 203–223)
  - `supabase/functions/admin-auth-resend/index.ts` (lines 79–179)
  - `supabase/functions/admin-auth-verify/index.ts` (lines 84–101)
  - `supabase/migrations/005_phase3_admin_otp_auth.sql` (`check_admin_auth_rate_limit`, lines 87–104)
- **What Was Found:**
  1. **Fail-open on RPC errors:** `admin-auth-initiate` (`otp_issue`, line 203), `admin-auth-resend` (`otp_issue`, line 151), and `admin-auth-verify` (`verify:ip`, line 84) ignore the `error` returned by `check_admin_auth_rate_limit`. If the RPC fails, rate limiting silently fails open instead of returning `503`.
  2. **First-insert race in `check_admin_auth_rate_limit`:** On two simultaneous requests for a brand-new `bucket_key`, both transactions execute `SELECT ... FOR UPDATE` (0 rows) and then attempt plain `INSERT`, causing a `23505` unique key violation on the second request.
  3. **Non-atomic resend cooldown & invalidation:** `admin-auth-resend` reads `admin_otp_challenges` with a plain `SELECT` (no `FOR UPDATE` lock). Two simultaneous resend requests right after the 30-second cooldown can both pass validation, send two OTP emails, and interleave invalidation updates.
  4. **Non-atomic failed login counter:** `admin-auth-initiate` computes `nextFailures = (adminProfile.failed_login_attempts || 0) + 1` in JS and writes it back instead of incrementing atomically in PostgreSQL, allowing concurrent wrong-password bursts to undercount failures before lockout.
- **Required Fix:**
  - Check and fail closed (`503`) on every `check_admin_auth_rate_limit` RPC error.
  - Update `check_admin_auth_rate_limit` in an additive migration (`006`) to use `INSERT ... ON CONFLICT (bucket_key) DO NOTHING` before `SELECT ... FOR UPDATE`.
  - Move failed-login incrementing and resend challenge rotation into `service_role`-only transactional `FOR UPDATE` SQL functions (matching `verify_admin_otp_challenge`).

#### M-02 — IP Rate Limiting Trusts Leftmost `X-Forwarded-For` Ahead of `cf-connecting-ip`, and `admin-auth-resend` Lacks IP Rate Limiting
- **Location:**
  - `supabase/functions/_shared/adminAuthShared.ts` (`extractAnonymizedIpHash`, lines 127–138)
  - `supabase/functions/admin-auth-resend/index.ts` (lines 75–98)
- **What Was Found:**
  1. `extractAnonymizedIpHash` prioritizes `x-forwarded-for.split(',')[0]` before `cf-connecting-ip`. Because clients can inject an arbitrary `X-Forwarded-For` header that proxies preserve as the leftmost value, an attacker can spoof a fresh IP on every request and bypass the `initiate:ip:*` and `verify:ip:*` limits.
  2. `admin-auth-resend` calls `extractAnonymizedIpHash` (line 75) only for logging and never calls `check_admin_auth_rate_limit` on the IP before querying `admin_otp_challenges`.
- **Required Fix:** Prioritize `cf-connecting-ip` (trusted Cloudflare header on Supabase Edge Functions), then `x-real-ip`, and only fall back to the rightmost non-private hop of `x-forwarded-for`. Add a fail-closed IP rate limit at the top of `admin-auth-resend`.

#### M-03 — `admin-auth-resend` Uses Non-Constant-Time Hash Comparison and Omits `challengeInvalidated: true` on Expired/Inactive Challenges
- **Location:**
  - `supabase/functions/admin-auth-resend/index.ts` (lines 91, 93–112)
  - `src/context/AppContext.tsx` (lines 1341–1348)
- **What Was Found:**
  1. Line 91 compares `existingChallenge.challenge_token_hash !== oldTokenHash` using standard JS inequality rather than constant-time comparison.
  2. When a challenge is expired or already used, `admin-auth-resend` returns HTTP `401` with `{ error: ... }` but omits `challengeInvalidated: true`. As a result, `invokeAdminAuthResend` does not set `code: 'CHALLENGE_INVALIDATED'`, so `AppContext.tsx` keeps the expired challenge mounted on Step 2 instead of returning the user to Step 1.
- **Required Fix:** Use constant-time comparison for `challenge_token_hash` in `admin-auth-resend` (and `encode(digest(...))` / constant-time check where practical) and return `challengeInvalidated: true` on `401` inactive/expired resend responses.

#### M-04 — Password Recovery Flow Cannot Complete in Live SPA Mode
- **Location:**
  - `src/lib/supabaseClient.ts` (line 30: `detectSessionInUrl: false`)
  - `src/context/AppContext.tsx` (`requestPasswordRecovery`, lines 1422–1439)
- **What Was Found:** Clicking "Forgot password? Request email recovery" calls `supabase.auth.resetPasswordForEmail(cleanEmail)`. Security-wise, this **does not bypass OTP** because `detectSessionInUrl: false` ignores URL hash tokens and `public.is_verified_admin()` blocks all admin access until `otp_verified_until > now()`. However, functionally, clicking the recovery link from email will land on the SPA with no recovery token parser or password-update form, making self-service recovery inoperable in live mode.
- **Required Fix:** Either remove/disable the in-app recovery form in live mode (directing the single owner to reset the password via the Supabase Dashboard) or implement an explicit, OTP-gated recovery handler without enabling general URL session auto-hydration.

---

### Low Findings

#### L-01 — `localhost:3000` Is Always Included in Production Edge Function CORS Allowlist
- **Location:** `supabase/functions/_shared/adminAuthShared.ts` (lines 14–28)
- **What Was Found:** `DEFAULT_ALLOWED_ORIGINS` unconditionally merges `http://localhost:3000` and `http://127.0.0.1:3000` even when `ALLOWED_ORIGINS` is explicitly configured for production.
- **Recommendation:** Require explicit `ALLOWED_ORIGINS` entries and only include localhost origins when configured in development environments.

#### L-02 — `public.is_verified_admin()` Treats `last_active_at IS NULL` as Active
- **Location:** `supabase/migrations/002_phase2_database_foundation.sql` (lines 187–190)
- **What Was Found:** `and (ap.last_active_at is null or ap.last_active_at > now() - make_interval(...))`. Although `verify_admin_otp_challenge` always writes `last_active_at = v_now` (so it is non-null after Phase 3 verification), treating `NULL` as inactive (`ap.last_active_at is not null and ap.last_active_at > ...`) is safer defense-in-depth.
- **Recommendation:** Tighten `is_verified_admin()` in an additive migration (`006`) to require `ap.last_active_at is not null`.

#### L-03 — `public.resolve_unique_recipe_slug` Lacks an `is_verified_admin()` Check
- **Location:** `supabase/migrations/004_phase2d_security_hardening.sql` (lines 245–290, 764–765)
- **What Was Found:** `resolve_unique_recipe_slug` is `SECURITY DEFINER`, granted to `authenticated`, and queries `public.recipes` (including unpublished `Draft`/`Pending`/`Archived` rows) without verifying `public.is_verified_admin()`. While single-owner enforcement and zero pre-OTP sessions mitigate exposure today, any future authenticated user could probe private draft slugs.
- **Recommendation:** Add `if not public.is_verified_admin() then raise exception 'UNAUTHORIZED: ...'; end if;` in an additive migration (`006`), or restrict execution to internal calls only.

#### L-04 — Minor Timing & Lockout Signal Difference on Owner Email Enumeration
- **Location:** `supabase/functions/admin-auth-initiate/index.ts` (lines 122–140, 149–199)
- **What Was Found:** Unknown emails return immediately without a Supabase Auth password check (~20ms vs. ~150–400ms for the real owner email), and 5 wrong passwords on the real owner email return HTTP `429` account lockout rather than `401`.
- **Recommendation:** Acceptable trade-off for a single-owner admin console; optionally keep lockout notifications generic if stricter stealth is desired.

---

### Informational & Live Behavioral Notes

#### I-01 — Behavior & Side Effects of `auth.admin.signOut(jwt, 'global')` and Step 1 Session Invalidation
- **`admin-auth-logout` (`auth.admin.signOut(jwt, 'global')`):** Revokes **all** active Supabase Auth sessions for the owner user across all browser tabs and devices. Because `admin_profiles.otp_verified_until` is a single per-owner timestamp (single-owner design), this is intentionally consistent — logging out or timing out in Tab A immediately terminates Tab B as well.
- **Step 1 Side Effect (`admin-auth-initiate` line 231):** Passing Step 1 (valid password) immediately resets `admin_profiles.otp_verified_until = null` *before* Step 2 OTP completion. If the owner starts a new sign-in on Device B, any currently active verified session on Device A immediately loses `is_verified_admin()` access even if Device B cancels Step 2.
- **Sleeping-Tab Timeout Edge Case:** If the admin leaves a tab asleep for >1 hour so the Supabase JWT `exp` itself expires before the 5-second JS timer fires, `admin-auth-logout` will receive `401` from `userClient.auth.getUser()`. Server-side security remains intact because `is_verified_admin()` independently denies access after 30 minutes of inactivity, though the `ADMIN_SESSION_TIMEOUT` audit row will not be recorded for that sleeping tab.

#### I-02 — `auth.admin.generateLink({ type: 'magiclink' })` + `verifyOtp()` Live GoTrue Compatibility
- `admin-auth-verify` generates a server-only link token via `serviceClient.auth.admin.generateLink({ type: 'magiclink', email })` (no email is sent by Supabase) and exchanges `properties.hashed_token` via `exchangeClient.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })`.
- **Verify on Live Supabase:** Confirm that the target Supabase project's GoTrue version accepts `type: 'magiclink'` (or requires `type: 'email'`) for `token_hash` exchange, that Email auth provider is enabled, and that **Confirm Email / Disable Public Signups** are configured appropriately so no external user can self-register.
- Also note: if `sessionData.user.id !== result.admin_id` ever occurred in `admin-auth-verify`, revoking the minted `sessionData.session.access_token` via `signOut(..., 'local')` alongside `revoke_admin_otp_session` would make the defensive rollback 100% complete.

#### I-03 — Missing `supabase/config.toml` / Edge Function `verify_jwt` Deployment Flag
- The repository has no `supabase/config.toml`. Because `admin-auth-initiate`, `admin-auth-resend`, and `admin-auth-verify` are called *before* the browser has a user session, deploying them with Supabase's default `verify_jwt = true` works only with legacy JWT `anon` keys and will fail with `401 Invalid JWT` if the project uses Supabase's newer opaque `sb_publishable_*` keys.
- **Live Setup Note:** Deploy `admin-auth-initiate`, `admin-auth-resend`, and `admin-auth-verify` with `--no-verify-jwt` (or add `supabase/config.toml` with `verify_jwt = false` on those three functions), while keeping `userClient.auth.getUser()` validation inside `admin-auth-logout` and `approve-community-submission`.

#### I-04 — Table Retention & `session_timeout_minutes` Bounds
- `public.admin_auth_rate_limits` and `public.admin_otp_challenges` accumulate historical rows over time; schedule periodic cleanup (or opportunistic deletion of rows older than 7 days inside Edge Functions) during live operations.
- `website_settings.session_timeout_minutes` defaults to `30` but allows `5`–`240` (`002_phase2_database_foundation.sql` line 88). Keep this value at `30` (or clamp tighter if 30 minutes should be a hard maximum rather than configurable).

---

## 4. Required Corrections Before Live Provisioning

To move from `READY AFTER REQUIRED FIXES` to `READY FOR LIVE PROVISIONING`, apply the following targeted fixes (Phase 3.6 hardening pass):

1. **[H-01]** Fix server-side `UNAUTHORIZED` / `P0001` / `PGRST301` / `42501` detection in `src/context/AppContext.tsx` (`touchAdminActivity`) and avoid optimistically extending `adminSession.expiresAt` before the server confirms the heartbeat.
2. **[H-02]** Harden `supabase/functions/_shared/smtpClient.ts` with explicit socket/operation timeouts, `SMTP_FROM` email validation and bare-address extraction (preventing double angle-bracket syntax errors on Gmail), response buffer size limits, and `EHLO` capability checks (`STARTTLS` / `AUTH`).
3. **[H-03]** Replace wildcard `'Access-Control-Allow-Origin': '*'` in `supabase/functions/approve-community-submission/index.ts` with `buildAdminCorsHeaders(req)` and `Cache-Control: no-store`.
4. **[M-01 & M-02]** Fail closed (`503`) on all `check_admin_auth_rate_limit` errors across `initiate`, `resend`, and `verify`; prioritize `cf-connecting-ip` over leftmost `x-forwarded-for` in `extractAnonymizedIpHash`; add IP rate limiting to `admin-auth-resend`; and add an additive migration `006` that makes `check_admin_auth_rate_limit` first-insert race-safe (`ON CONFLICT`), makes failed-login increment and resend rotation atomic (`FOR UPDATE`), tightens `is_verified_admin()` to require `last_active_at is not null` (`L-02`), and guards `resolve_unique_recipe_slug` with `is_verified_admin()` (`L-03`).
5. **[M-03 & M-04]** Use constant-time comparison and return `challengeInvalidated: true` on expired/used challenges in `admin-auth-resend`, and clearly align the live-mode password recovery UX with `detectSessionInUrl: false`.
6. **[L-01 & I-03]** Remove hardcoded localhost origins from production CORS defaults unless configured in `ALLOWED_ORIGINS`, and document/add `supabase/config.toml` `verify_jwt` settings for Edge Function deployment.

---

## 5. Remaining Live-Testing Requirements

Even after the required code fixes above are completed, the following items **cannot** be certified offline and MUST be tested against the live Supabase project and live SMTP account:

1. **Live Gmail / SMTP Delivery Test:**
   - Test both port `465` (implicit TLS, `SMTP_SECURE=true`) and/or port `587` (STARTTLS, `SMTP_SECURE=false`) against `smtp.gmail.com` using a real 2-Step Verification Google App Password.
   - Verify `EHLO` hostname acceptance, `AUTH LOGIN` acceptance, `MAIL FROM` / `From` header acceptance, inbox deliverability (not rejected/bounced), and error rollback if credentials are intentionally wrong.
2. **Live Supabase GoTrue Session Minting Test:**
   - Verify `serviceClient.auth.admin.generateLink({ type: 'magiclink', email })` + `exchangeClient.auth.verifyOtp({ token_hash, type: 'magiclink' })` returns a valid `access_token` + `refresh_token` pair on the target project's GoTrue version and does NOT trigger Supabase's built-in email mailer.
   - Verify `supabase.auth.setSession(...)` in memory (`persistSession: false`) hydrates RLS requests and refreshes tokens cleanly while active, and leaves zero tokens in `localStorage` or `sessionStorage`.
3. **Live RLS & Storage Negative/Positive Verification:**
   - Verify unauthenticated `anon` and pre-OTP states cannot read/write `admin_profiles`, `admin_otp_challenges`, `admin_auth_rate_limits`, `community_submissions`, `contact_reports`, `pending-submissions`, or `private-admin-backups`.
   - Verify post-OTP owner session can execute all admin dashboard modules including `approve-community-submission` image promotion.
   - Verify waiting >30 minutes without activity (or revoking `otp_verified_until` in SQL) causes both PostgreSQL RLS and the frontend dashboard to immediately reject/expire the session.
   - Verify manual logout clears `otp_verified_until`, invalidates the session across tabs, and blocks replay of the previously captured Bearer JWT.

---

## 6. Tests, Build, Lint, and Dependency Audit Verification

All existing checks were re-executed read-only during this audit:

- **TypeScript (`npx tsc --noEmit`):** Passed (0 errors).
- **Unit & Security Contract Tests (`tsx --test` across all 6 suites):** **66 / 66 passing** (0 failures, 0 skipped).
- **Production Build (`npm run build` & `compile_applet`):** Succeeded (`dist/` compiled cleanly).
- **Lint (`lint_applet`):** Passed (0 errors).
- **Dependency Audit (`bun audit`):** **0 vulnerabilities found** across 151 packages.

---

## 7. Final Readiness Verdict

### **`READY AFTER REQUIRED FIXES`**

The Phase 3 authentication architecture is fundamentally sound — zero pre-OTP browser sessions, server-only password checking with immediate pre-OTP token revocation, atomic `FOR UPDATE` single-use OTP verification, `service_role`-only verification state updates, memory-only browser sessions, and consistent `is_verified_admin()` RLS/Storage enforcement. However, **3 High findings (`H-01`, `H-02`, `H-03`)** and **4 Medium findings (`M-01`–`M-04`)** directly affect live session-expiry handling, live Gmail SMTP reliability, CORS consistency, and rate-limit fail-closed/concurrency guarantees, and should be fixed before live Supabase provisioning.
