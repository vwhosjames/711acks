# 711acks — Phase 3.6 Security Fixes & Hardening Report

- **Phase:** Phase 3.6 — Security Fixes & Hardening (Offline / Local Implementation Milestone)
- **Baseline Audit:** `docs/PHASE_3_5_SECURITY_AUDIT.md`
- **Live Provisioning / Deployment Performed:** None (strictly local implementation and verification; migrations, Edge Functions, Vercel deployment, live owner provisioning, and real SMTP delivery were NOT executed)
- **Final Verdict:** **`ALL REQUIRED FIXES IMPLEMENTED — READY FOR LIVE VALIDATION`**

---

## 1. Audit Findings & Resolution Status

All High, Medium, and Low findings — plus actionable Informational items (`I-02`, `I-03`) — from `docs/PHASE_3_5_SECURITY_AUDIT.md` have been resolved:

| ID | Severity | Finding Summary | Final Status | Verification |
|---|---|---|---|---|
| **H-01** | High | Server-side `touch_admin_activity()` expiration (`P0001` with `UNAUTHORIZED:`) was missed by frontend; local countdown was optimistically extended prior to server confirmation. | **Fixed** | `isUnauthorizedSupabaseError()` + non-optimistic `performAdminActivityHeartbeat()` tested across `P0001`, `PGRST301`, `42501`, and HTTP `401`/`403`. |
| **H-02** | High | Custom SMTP client lacked connect/read/write/total timeouts, produced invalid double-bracketed `MAIL FROM` / `From` headers when `SMTP_FROM` contained a display name, lacked buffer/line caps, and skipped `EHLO` capability checks. | **Fixed** | `smtpClient.ts` enforces connect (`8s`), I/O (`8s`), and total (`15s`) timeouts with guaranteed socket cleanup; `parseSmtpSender()` extracts bare email for `MAIL FROM:<addr>` and clean display header; caps responses at 64 KB / 100 lines; verifies `STARTTLS` and `AUTH LOGIN`. |
| **H-03** | High | Wildcard `Access-Control-Allow-Origin: '*'` and missing `Cache-Control: no-store` remained on `approve-community-submission`. | **Fixed** | `approve-community-submission/index.ts` now uses `handleAdminPreflight`, `rejectIfDisallowedOrigin`, and `jsonAdminResponse` (`Cache-Control: no-store`, strict origin allowlist). Zero wildcard CORS exists across all Edge Functions. |
| **M-01** | Medium | Fail-open rate-limit RPC calls, first-insert `23505` race in `check_admin_auth_rate_limit`, non-atomic failed-login increments, and non-atomic resend rotation. | **Fixed** | All rate-limit RPC calls fail closed (`503`) across `initiate`, `resend`, `verify`, and `complete-recovery`. Migration `006` introduces race-safe `INSERT ... ON CONFLICT DO NOTHING` in `check_admin_auth_rate_limit`, atomic `FOR UPDATE` `record_admin_failed_login`, and atomic `FOR UPDATE` `rotate_admin_otp_challenge_for_resend`. |
| **M-02** | Medium | IP rate limiting trusted spoofable leftmost `X-Forwarded-For` ahead of `cf-connecting-ip`, and `admin-auth-resend` lacked IP rate limiting. | **Fixed** | `extractTrustedClientIp()` prioritizes `cf-connecting-ip`, `x-real-ip`, `x-envoy-external-address`, then rightmost valid public `x-forwarded-for` hop (never leftmost), falling back to `'untrusted-ip-fallback'`. `admin-auth-resend` now enforces fail-closed `resend:ip:<hash>` (10 / 15m) before querying challenges. |
| **M-03** | Medium | `admin-auth-resend` used non-constant-time `!==` on `challenge_token_hash` and omitted `challengeInvalidated: true` on inactive/expired challenges. | **Fixed** | Added `constantTimeEqual()` (TS) and `public.constant_time_text_equal()` (SQL, used in both `verify_admin_otp_challenge` and `rotate_admin_otp_challenge_for_resend`). Resend returns `challengeInvalidated: true` on inactive/expired/locked responses, and `AppContext` clears Step 2 state cleanly. |
| **M-04** | Medium | Live password recovery link could not complete inside the SPA because `detectSessionInUrl: false` ignores URL tokens. | **Fixed** | Added `parsePasswordRecoveryUrl()` (strictly `/admin`, immediate `history.replaceState` scrubbing, zero session hydration), `admin-auth-complete-recovery` Edge Function (server-side validation, strong password policy, owner-only check, password update, global session/OTP revocation, zero tokens returned), and Admin Console recovery completion form requiring fresh Password + 6-digit Email OTP login afterwards. |
| **L-01** | Low | `localhost:3000` / `127.0.0.1:3000` were unconditionally merged into production CORS defaults. | **Fixed** | Removed hardcoded localhost defaults from production CORS. Localhost origins are permitted only if explicitly listed in `ALLOWED_ORIGINS` or opted in via `ALLOW_LOCALHOST_CORS=true`. |
| **L-02** | Low | `public.is_verified_admin()` treated `last_active_at IS NULL` as active. | **Fixed** | Migration `006` tightens `public.is_verified_admin()` to require `ap.last_active_at is not null` in addition to the rolling inactivity check; `evaluateIsVerifiedAdmin()` updated to match. |
| **L-03** | Low | `public.resolve_unique_recipe_slug()` lacked an `is_verified_admin()` authorization check. | **Fixed** | Migration `006` guards `public.resolve_unique_recipe_slug()` with `if not public.is_verified_admin() then raise exception 'UNAUTHORIZED: ...'; end if;` and restricts `EXECUTE` strictly to `authenticated`. |
| **L-04** | Low | Minor timing difference between unknown email and real owner email during Step 1 password check. | **Mitigated** | Added a 250ms minimum response duration floor (`enforceMinimumFailureDuration`) on `401` authentication failures in `admin-auth-initiate` while preserving the 5-failure 15-minute lockout and generic error text. |
| **I-02** | Info | Defensive rollback on mismatched user ID during session minting in `admin-auth-verify`. | **Fixed** | `admin-auth-verify/index.ts` now revokes any mismatched minted `sessionData.session.access_token` via `auth.admin.signOut(..., 'local')` in addition to `revoke_admin_otp_session`. |
| **I-03** | Info | Missing `supabase/config.toml` specifying `verify_jwt` flags for pre-auth vs. authenticated Edge Functions. | **Fixed** | Added `supabase/config.toml` with `verify_jwt = false` on pre-auth endpoints (`admin-auth-initiate`, `admin-auth-resend`, `admin-auth-verify`, `admin-auth-complete-recovery`) and `verify_jwt = true` on authenticated endpoints (`admin-auth-logout`, `approve-community-submission`). |

---

## 2. Files Modified and Added

### New Files
1. **`supabase/migrations/006_phase36_security_hardening.sql`** — Additive, idempotent PostgreSQL hardening migration (`L-02`, `L-03`, `M-01`, `M-03`, strict `service_role` grants).
2. **`supabase/config.toml`** — Edge Function `verify_jwt` configuration for pre-auth vs. authenticated admin endpoints (`I-03`).
3. **`supabase/functions/admin-auth-complete-recovery/index.ts`** — Server-side owner password recovery completion Edge Function that updates the password, revokes all OTP/auth sessions, and returns zero tokens (`M-04`).
4. **`src/lib/phase36SecurityFixes.test.ts`** — Dedicated 22-test security & regression test suite validating all Phase 3.6 fixes.
5. **`docs/PHASE_3_6_SECURITY_FIXES_REPORT.md`** — This report.

### Modified Files
1. **`supabase/functions/_shared/adminAuthShared.ts`** — Strict CORS allowlist with `rejectIfDisallowedOrigin`/`handleAdminPreflight`, no default localhost (`L-01`), trusted IP extraction (`M-02`), and constant-time comparison (`M-03`).
2. **`supabase/functions/_shared/smtpClient.ts`** — Connect/read/write/total timeouts (`SmtpTimeoutError`), late-connect socket close, `parseSmtpSender()` for display-name & bare `SMTP_FROM`, CR/LF/NUL validation, 64 KB / 100-line response caps, and `EHLO` `STARTTLS`/`AUTH LOGIN` verification (`H-02`).
3. **`supabase/functions/approve-community-submission/index.ts`** — Replaced wildcard CORS with shared `handleAdminPreflight`, `rejectIfDisallowedOrigin`, and `jsonAdminResponse` (`H-03`).
4. **`supabase/functions/admin-auth-initiate/index.ts`** — Strict origin enforcement, fail-closed `503` on all rate-limit RPC failures, atomic `record_admin_failed_login` RPC, and 250ms minimum `401` failure duration floor (`M-01`, `L-01`, `L-04`).
5. **`supabase/functions/admin-auth-resend/index.ts`** — Strict origin enforcement, fail-closed `resend:ip:<hash>` rate limit, atomic `rotate_admin_otp_challenge_for_resend` RPC with constant-time check, and explicit `challengeInvalidated: true` metadata (`M-01`, `M-02`, `M-03`, `L-01`).
6. **`supabase/functions/admin-auth-verify/index.ts`** — Strict origin enforcement, fail-closed `503` on `verify:ip` rate-limit errors, and local revocation of any mismatched minted token (`M-01`, `L-01`, `I-02`).
7. **`supabase/functions/admin-auth-logout/index.ts`** — Strict origin enforcement via `handleAdminPreflight` and `rejectIfDisallowedOrigin` (`L-01`).
8. **`src/lib/supabaseRepository.ts`** — Added optional `status` field on `SupabaseRepositoryError` and exported normalized `isUnauthorizedSupabaseError()` (`H-01`).
9. **`src/lib/adminAuthController.ts`** — Added `performAdminActivityHeartbeat()`, `parsePasswordRecoveryUrl()`, `validateNewAdminPassword()`, `invokeAdminAuthCompleteRecovery()`, `executeAdminPasswordRecovery()`, updated `evaluateIsVerifiedAdmin()` (`L-02`), `constantTimeHexEqual()`, `invokeAdminAuthResend()`, and fail-closed/atomic server orchestration mirrors (`H-01`, `M-01`–`M-04`, `L-02`).
10. **`src/context/AppContext.tsx`** — Replaced optimistic `touchAdminActivity()` extension with non-optimistic `performAdminActivityHeartbeat()` and added live-mode password recovery state/scrubbing/completion without enabling `detectSessionInUrl` (`H-01`, `M-04`).
11. **`src/pages/AdminDashboardPage.tsx`** — Added "Complete Owner Password Reset" form when a recovery link is opened on `/admin`, returning strictly to Step 1 (Password + 6-digit Email OTP) after completion (`M-04`).
12. **`.env.example`** — Updated `ALLOWED_ORIGINS` (production-only without localhost), documented opt-in `ALLOW_LOCALHOST_CORS=false`, and updated `SMTP_FROM` example to `711acks Security <owner@gmail.com>` (`H-02`, `L-01`).

---

## 3. New Database Migration (`006_phase36_security_hardening.sql`)

Migrations `001` through `005` were preserved completely unchanged. The required execution order is now:

1. `supabase/migrations/001_711acks_schema.sql`
2. `supabase/migrations/002_phase2_database_foundation.sql`
3. `supabase/migrations/003_storage_setup.sql`
4. `supabase/migrations/004_phase2d_security_hardening.sql`
5. `supabase/migrations/005_phase3_admin_otp_auth.sql`
6. `supabase/migrations/006_phase36_security_hardening.sql`

### Objects Created / Replaced in Migration `006`
- **`public.constant_time_text_equal(text, text)`** (`immutable strict`, `service_role` only): Byte-level XOR comparison across full byte length without short-circuiting.
- **`public.is_verified_admin()`** (`security definer`, `stable`): Now explicitly requires `ap.last_active_at is not null` alongside `ap.last_active_at > now() - make_interval(mins => coalesce(ws.session_timeout_minutes, 30))` and `ap.otp_verified_until > now()`.
- **`public.resolve_unique_recipe_slug(text, uuid)`** (`security definer`, `authenticated` only): Enforces `if not public.is_verified_admin() then raise exception 'UNAUTHORIZED: ...'; end if;` before querying `public.recipes`.
- **`public.check_admin_auth_rate_limit(text, int, int)`** (`security definer`, `service_role` only): Uses `INSERT ... VALUES (v_key, v_now, 1, v_now) ON CONFLICT (bucket_key) DO NOTHING` (honoring `check (request_count >= 1)`) before `SELECT ... FOR UPDATE`, eliminating first-insert `23505` races.
- **`public.record_admin_failed_login(uuid, int, int, text)`** (`security definer`, `service_role` only): Row-locks `admin_profiles` (`FOR UPDATE`), resets expired lockouts cleanly, atomically increments `failed_login_attempts`, triggers 15-minute `locked_until` on reaching the threshold, and writes `ADMIN_LOGIN_FAILED`/`ADMIN_LOCKOUT_TRIGGERED`.
- **`public.rotate_admin_otp_challenge_for_resend(...)`** (`security definer`, `service_role` only): Row-locks the active challenge and owner profile (`FOR UPDATE`), compares `challenge_token_hash` via `constant_time_text_equal`, enforces 30s cooldown, lockout, and rolling `otp_issue` rate limit (`5 / 15m`), atomically invalidates prior challenges, inserts the replacement challenge, and returns explicit `challenge_invalidated` metadata.
- **`public.verify_admin_otp_challenge(...)`** (`security definer`, `service_role` only): Upgraded to compare both `challenge_token_hash` and `otp_hash` using `constant_time_text_equal`.
- All `service_role` functions pin `set search_path = public, pg_temp` and explicitly `REVOKE ALL ... FROM public, anon, authenticated`.

---

## 4. Security Design Decisions

1. **Trusted Proxy IP Header Assumption (`M-02`):** Supabase Edge Functions run behind Cloudflare / Supabase Edge Gateway, which overwrites `cf-connecting-ip` (and compatible proxies set `x-real-ip` / `x-envoy-external-address`) with the verified TCP peer IP. Because clients can forge arbitrary leftmost entries in `X-Forwarded-For`, `extractTrustedClientIp()` prioritizes trusted single-IP edge headers first and only falls back to scanning `X-Forwarded-For` from **right to left** for the rightmost valid public (non-private/loopback/link-local) IP. When no trustworthy IP is available, it falls back to a constant bucket (`untrusted-ip-fallback`) rather than trusting client-supplied values. All IPs remain SHA-256 hashed with `ADMIN_OTP_PEPPER` before storage.
2. **Password Recovery Without OTP Bypass (`M-04`):** `src/lib/supabaseClient.ts` preserves `persistSession: false` and `detectSessionInUrl: false` so recovery links can never auto-hydrate a browser session. When the owner opens a recovery link at `/admin`, `parsePasswordRecoveryUrl()` extracts the recovery proof strictly in memory and immediately scrubs the address bar via `window.history.replaceState({}, '', '/admin')`. Submitting the new password invokes `admin-auth-complete-recovery`, which validates the recovery proof on a disposable server client, confirms `admin_profiles.role = 'owner'`, enforces the strong password policy (`>= 12` chars with upper/lower/digit/symbol), updates the password, calls `revoke_admin_otp_session`, resets lockout counters, globally signs out the recovery token, and returns **zero** session tokens — strictly requiring a fresh Step 1 (new password) + Step 2 (6-digit Email OTP) login before entering the dashboard.
3. **Timing & Lockout Trade-Off (`L-04`):** For a single-owner admin console, preventing brute-force password guessing via deterministic 5-failure 15-minute lockout is prioritized over suppressing `429` lockout feedback. To narrow timing differences between unknown emails and valid owner password checks on `401` responses, `admin-auth-initiate` enforces a 250ms minimum failure duration floor while returning identical generic error messages.
4. **Explicit CORS Allowlist (`H-03`, `L-01`):** Every admin Edge Function rejects unapproved `Origin` headers with HTTP `403`, `Vary: Origin`, `Cache-Control: no-store`, and no `Access-Control-Allow-Origin` header. Wildcard `*` entries are stripped even if accidentally configured in `ALLOWED_ORIGINS`, and `localhost` origins are disabled unless explicitly added or opted in via `ALLOW_LOCALHOST_CORS=true`.

---

## 5. Tests Added and Exact Results

Added **`src/lib/phase36SecurityFixes.test.ts`** (22 new test cases) alongside all 7 existing suites:

- `H-01`: `P0001` (`UNAUTHORIZED:`), `PGRST301`, `42501`, HTTP `401`/`403` detection (and non-auth error exclusion); non-optimistic heartbeat verification; automatic expiration on `P0001` rejection; server-confirmed extension capped by `otpVerifiedUntilMs`.
- `H-02`: `parseSmtpSender` with bare email, display-name mailbox (`711acks Security <owner@gmail.com>`), nested-bracket rejection, CR/LF header injection rejection; real scripted SMTP socket transcript confirming bare `MAIL FROM:<owner@gmail.com>` and clean `From:` header; connect, read, and write `SmtpTimeoutError` tests with verified socket `.close()`; `EHLO` `STARTTLS` and `AUTH LOGIN` enforcement; SMTP failure challenge invalidation rollback.
- `H-03` & `L-01`: Disallowed origin `403` rejection without `Access-Control-Allow-Origin`; wildcard `*` stripping across all 6 Edge Functions; `Cache-Control: no-store`; localhost exclusion by default and opt-in via `ALLOW_LOCALHOST_CORS=true`.
- `M-01`: Fail-closed `503` on rate-limit RPC outages across `initiate` (`ip` + `otp_issue`), `resend`, `verify`, and `complete-recovery`; concurrent first-insert rate-limit serialization; concurrent wrong-password atomic failure counting and exact 5th-attempt lockout; concurrent resend race ensuring strictly one rotation and one `401` `challengeInvalidated: true` rejection.
- `M-02`: `cf-connecting-ip` priority over spoofed leftmost `X-Forwarded-For`; rightmost public XFF hop fallback ignoring private hops; `'untrusted-ip-fallback'` safety; `resend:ip:<hash>` 10/15m rate limit enforcement.
- `M-03`: `constantTimeEqual` / `constantTimeHexEqual`; expired resend returning `challengeInvalidated: true` and `invokeAdminAuthResend` mapping to `CHALLENGE_INVALIDATED`.
- `M-04`: `parsePasswordRecoveryUrl` for `?token_hash=...&type=recovery` and `#access_token=...&type=recovery` strictly on `/admin`; weak-password rejection; full recovery completion updating password, revoking OTP/auth sessions, minting zero tokens, and requiring fresh Password + 6-digit Email OTP login before `evaluateIsVerifiedAdmin()` returns `true`.
- `L-02`, `L-03`, `006`, & `config.toml`: `evaluateIsVerifiedAdmin()` rejecting `lastActiveAtMs: null`; SQL contract verification for `006_phase36_security_hardening.sql`, `supabase/config.toml`, and `supabaseClient.ts`.

### Full Test Suite Execution Summary
- **Command:** `npx --yes tsx --test src/components/heroScene.test.ts src/utils/drinkLogic.test.ts src/lib/supabaseRepository.test.ts src/lib/phase2bIntegration.test.ts src/lib/phase2cStorageReadiness.test.ts src/lib/phase2dHardening.test.ts src/lib/phase3AdminOtpAuth.test.ts src/lib/phase36SecurityFixes.test.ts`
- **Result:** **95 / 95 passed** (0 failures, 0 skipped, 0 cancelled).

---

## 6. Build, Typecheck, Lint, and Dependency Audit Results

- **TypeScript (`npx tsc --noEmit`):** Passed (0 errors).
- **Production Build (`npm run build` / `vite build`):** Passed (`dist/` built cleanly in ~1.00s).
- **Applet Compilation (`compile_applet`):** Verified passing.
- **Linter (`lint_applet`):** Verified passing (0 errors).
- **Dependency Audit (`bun audit`):** **0 vulnerabilities found** across 151 packages.
- **Secret & Policy Scan (`grep`):** Zero wildcard CORS (`*`), zero server secrets in `src/`, zero browser `signInWithPassword` calls, and migrations `001`–`005` untouched.

---

## 7. Remaining Limitations

Because this milestone is strictly offline/local (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` remain unset):
- Migration `006_phase36_security_hardening.sql` has not yet been executed against a live PostgreSQL instance.
- The 6 Edge Functions (`admin-auth-initiate`, `admin-auth-resend`, `admin-auth-verify`, `admin-auth-logout`, `admin-auth-complete-recovery`, `approve-community-submission`) have not yet been deployed to live Supabase Deno Deploy.
- Live Gmail SMTP (`smtp.gmail.com` ports `465`/`587`) and live Supabase GoTrue (`generateLink` + `verifyOtp`, `resetPasswordForEmail`) have not yet been tested over the network.

---

## 8. Live Testing Requirements Before Production Launch

Once explicitly approved for live provisioning and deployment, execute these live verification tests before opening public access:

1. **Migrations `001`–`006` Apply & Smoke Check:** Apply migrations in strict order `001` → `006` and verify all functions, grants (`service_role` vs `authenticated`), and `is_verified_admin()` behavior (`last_active_at IS NULL` denied; `resolve_unique_recipe_slug` denied without verified admin session).
2. **Edge Function Deployment & CORS Validation:** Deploy all 6 Edge Functions using `supabase/config.toml`, configure `ALLOWED_ORIGINS` strictly to the live Vercel production origin (with `ALLOW_LOCALHOST_CORS=false`), and verify unapproved origins receive HTTP `403` without `Access-Control-Allow-Origin` and `Cache-Control: no-store`.
3. **Live Gmail SMTP Test (`H-02`):** Configure `SMTP_FROM="711acks Security <owner@gmail.com>"` and test both happy-path delivery (inbox receipt, clean `From:` header) and intentional failure (wrong password -> `503` + challenge marked `used = true`).
4. **Live GoTrue OTP & Session Expiry Test (`H-01`, `I-02`):** Complete full Step 1 + Step 2 login, confirm zero tokens in `localStorage`/`sessionStorage`, manually clear `otp_verified_until` or wait >30 minutes in SQL, interact with the dashboard, and confirm the heartbeat `P0001` rejection immediately locks the UI and returns to the OTP login gate.
5. **Live Recovery Flow Test (`M-04`):** Trigger "Forgot password?", open the email link at `/admin`, verify URL parameters are scrubbed immediately and zero authenticated session exists, set a new strong password, confirm `admin-auth-complete-recovery` returns zero tokens and invalidates prior sessions, and sign in cleanly with the new password + 6-digit Email OTP.
6. **Live Concurrency & Storage Promotion Check (`H-03`, `M-01`):** Send concurrent resends and verify only one succeeds; approve a pending community submission with a private photo and verify promotion to `published-drinks` and cleanup from `pending-submissions`.

---

## 9. Findings That Could Not Be Safely Fixed

*None.* Every High, Medium, Low, and actionable Informational finding from `docs/PHASE_3_5_SECURITY_AUDIT.md` has been cleanly implemented and verified offline without weakening RLS, TLS verification, OTP enforcement, or existing functionality.

---

## Final Verdict

### **`ALL REQUIRED FIXES IMPLEMENTED — READY FOR LIVE VALIDATION`**
