# 711acks — Phase 4A Live Environment Readiness Audit

- **Audit Type:** Strictly Read-Only Pre-Provisioning Architecture, Configuration & Security Readiness Audit
- **Project State:** Initial project commit pushed to GitHub; `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` remain unset locally (Local Preview Mode active)
- **Cloud Tier Target:** Supabase Free Tier + Vercel Hobby Tier + Gmail SMTP (2-Step Verification App Password) — **zero paid services**
- **Final Verdict:** **`READY FOR PHASE 4B`**

---

## Executive Summary

All source code, SQL migrations (`001`–`006`), Storage bucket definitions & RLS policies, Edge Functions (`6` functions + `_shared` modules), `supabase/config.toml`, Vercel SPA routing (`vercel.json`), `.env.example`, `.gitignore`, and `README.md` were inspected read-only and cross-checked against the Phase 3.5 security audit and Phase 3.6 hardening fixes.

- **Local Code & Test Baseline:** `npx tsc --noEmit` passes (0 errors), all **95 / 95** automated tests across 8 test suites pass, `bun audit` previously reported 0 vulnerabilities across 151 packages, and zero secrets or `.env` files exist in the workspace.
- **No Code or Migration Changes Needed Before Phase 4B:** Every prerequisite file for live Supabase provisioning and Vercel Hobby deployment is present and consistent.
- **What Remains for Phase 4B & Live Validation:** Executing migrations `001`–`006` in order, configuring Supabase Auth (Email provider, signup lockdown, Redirect URLs), setting Edge Function secrets (`ADMIN_OTP_PEPPER`, `ALLOWED_ORIGINS`, Gmail SMTP credentials), deploying the 6 Edge Functions, provisioning the single `owner` user & `public.admin_profiles` row, configuring Vercel public env vars, and running live end-to-end validation.

---

## 1. Supabase Environment Variables & Client Configuration

### Inspected Files
- `src/lib/supabaseClient.ts`
- `.env.example`
- `tsconfig.json`

### Findings
- **Public Browser Variables (`VITE_*`):**
  - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are the **only** application variables consumed by the frontend (`src/lib/supabaseClient.ts`, lines 8–21).
  - `isSupabaseConfigured` safely guards against missing values, non-HTTPS URLs, and template placeholders (`your-project-ref`, `your-supabase-anon-public-key`), cleanly falling back to Local Preview Mode when unset.
  - Because Vite inlines `VITE_*` variables at **build time**, Vercel must have `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured **before** triggering the production Vite build.
- **Memory-Only Auth Session (`src/lib/supabaseClient.ts`, lines 23–33):**
  - `persistSession: false`, `autoRefreshToken: true`, `detectSessionInUrl: false` are all explicitly set.
  - Live admin JWTs and refresh tokens are never persisted to `localStorage` or `sessionStorage`, and URL recovery tokens cannot auto-hydrate sessions.
- **Server-Only Edge Function Secrets (`.env.example`, lines 20–30):**
  - `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_OTP_PEPPER`, `ADMIN_OTP_VALIDITY_MINUTES`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` are properly unprefixed (no `VITE_`) and documented strictly for `supabase secrets set`.
  - `.env.example` also includes workspace template placeholders (`GEMINI_API_KEY`, `APP_URL`); neither is referenced by 711acks runtime code or required in Vercel/Supabase.
  - Confirmed zero references to `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASS`, or `ADMIN_OTP_PEPPER` exist anywhere in `src/`.

---

## 2. Database Migrations (`001`–`006`) & Execution Dependencies

### Required Strict Sequential Order
1. `supabase/migrations/001_711acks_schema.sql`
2. `supabase/migrations/002_phase2_database_foundation.sql`
3. `supabase/migrations/003_storage_setup.sql`
4. `supabase/migrations/004_phase2d_security_hardening.sql`
5. `supabase/migrations/005_phase3_admin_otp_auth.sql`
6. `supabase/migrations/006_phase36_security_hardening.sql`

### Dependency & Compatibility Verification
- **001 → 002:** `002` depends on core tables/enums from `001`, inserts singleton `public.website_settings (id = 1)` idempotently (`ON CONFLICT DO NOTHING`), creates `like_rate_limits` (RLS enabled, zero public policies), hardens `is_verified_admin()` and `handle_product_price_change()` with `set search_path = public, pg_temp`, and establishes `SECURITY DEFINER` RPCs and explicit `GRANT`/`REVOKE` permissions.
- **002 → 003:** `003` depends on `public.is_verified_admin()` (`001`/`002`) for `storage.objects` policies. It intentionally omits `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` so execution from Supabase SQL Editor does **not** fail with `42501` ownership errors.
- **003 → 004:** `004` drops the 4 direct public `INSERT` policies created in `001`/`002` (`community_submissions`, `submission_ingredients`, `product_suggestions`, `contact_reports`), enforces `003` storage path regexes inside `submit_community_hack`, adds `resolve_unique_recipe_slug`, updates `save_recipe_with_ingredients`, and blocks unpromoted `pending-submissions` paths inside `approve_community_submission`.
- **004 → 005:** `005` adds `uq_admin_profiles_single_owner` (unique partial index where `role = 'owner'`), adds `challenge_token_hash` and `ip_hash` to `admin_otp_challenges`, creates `admin_auth_rate_limits`, and installs `service_role`-only OTP RPCs (`check_admin_auth_rate_limit`, `verify_admin_otp_challenge`, `revoke_admin_otp_session`).
- **005 → 006:** `006` depends on `admin_auth_rate_limits` (`005`), `admin_otp_challenges.challenge_token_hash` (`005`), `resolve_unique_recipe_slug` (`004`), and `website_settings` (`002`). It defines `constant_time_text_equal`, tightens `is_verified_admin()` (`last_active_at is not null`), guards `resolve_unique_recipe_slug` with `is_verified_admin()`, makes `check_admin_auth_rate_limit` first-insert race-safe (`INSERT ... ON CONFLICT (bucket_key) DO NOTHING`), adds `record_admin_failed_login` and `rotate_admin_otp_challenge_for_resend`, and upgrades `verify_admin_otp_challenge`.
- **Initial Live Catalog State (Important Note):** Migrations `001`–`006` intentionally do **not** seed demo `products` or `recipes` into PostgreSQL. After Phase 4B provisioning, the live database will start with an empty catalog until the owner adds verified 7-Eleven Philippines products and recipes through `/admin`. (Note: `restoreFromBackupPackage` is intentionally disabled in Live Mode per `src/context/AppContext.tsx` lines 2690–2696.)

---

## 3. Edge Functions & Deployment Requirements

### Inspected Functions (`supabase/functions/`)
| Function | Shared Imports | External Clients / Calls | Required Secrets |
|---|---|---|---|
| `admin-auth-initiate` | `adminAuthShared.ts`, `smtpClient.ts` | `@supabase/supabase-js@2.49.4`, direct TLS/STARTTLS SMTP | `SUPABASE_*`, `ADMIN_OTP_PEPPER`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS`, `SMTP_*` |
| `admin-auth-resend` | `adminAuthShared.ts`, `smtpClient.ts` | `@supabase/supabase-js@2.49.4`, direct TLS/STARTTLS SMTP | `SUPABASE_*`, `ADMIN_OTP_PEPPER`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS`, `SMTP_*` |
| `admin-auth-verify` | `adminAuthShared.ts` | `@supabase/supabase-js@2.49.4` (`generateLink` + `verifyOtp`) | `SUPABASE_*`, `ADMIN_OTP_PEPPER`, `ADMIN_OTP_VALIDITY_MINUTES`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS` |
| `admin-auth-logout` | `adminAuthShared.ts` | `@supabase/supabase-js@2.49.4` (`getUser`, `revoke_admin_otp_session`, `auth.admin.signOut(..., 'global')`) | `SUPABASE_*`, `ADMIN_OTP_PEPPER`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS` |
| `admin-auth-complete-recovery` | `adminAuthShared.ts` | `@supabase/supabase-js@2.49.4` (`verifyOtp('recovery')`/`getUser`, `updateUserById`, `revoke_admin_otp_session`, `signOut`) | `SUPABASE_*`, `ADMIN_OTP_PEPPER`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS` |
| `approve-community-submission` | `adminAuthShared.ts` | `@supabase/supabase-js@2.49.4`, Storage download/upload/delete, `approve_community_submission` RPC | `SUPABASE_*`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS` |

### Key Deployment Requirements
- **Strict Origin Allowlist (`ALLOWED_ORIGINS`):** All 6 Edge Functions enforce `rejectIfDisallowedOrigin(req)` and return HTTP `403` (with `Cache-Control: no-store` and no `Access-Control-Allow-Origin`) if the browser `Origin` is not explicitly listed in `ALLOWED_ORIGINS`. If `ALLOWED_ORIGINS` is left blank in production, **all browser calls to all 6 functions will be rejected with `403`**.
- **Exact Origin Format:** Values must be comma-separated `scheme://host[:port]` without trailing slashes or wildcards (e.g., `https://your-domain.vercel.app`), and `ALLOW_LOCALHOST_CORS` must remain `"false"` in production.
- **Automatic Supabase Platform Secrets:** Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into Edge Function runtime environments automatically; verify they are present in the project's Edge Function environment. Notice `approve-community-submission` reads `Deno.env.get(...)` directly while the 5 auth functions use `getRequiredAdminAuthEnv()` (requiring `ADMIN_OTP_PEPPER` as well).

---

## 4. Edge Function JWT Verification (`supabase/config.toml`)

### Inspected Configuration
```toml
[functions.admin-auth-initiate]
verify_jwt = false

[functions.admin-auth-resend]
verify_jwt = false

[functions.admin-auth-verify]
verify_jwt = false

[functions.admin-auth-complete-recovery]
verify_jwt = false

[functions.admin-auth-logout]
verify_jwt = true

[functions.approve-community-submission]
verify_jwt = true
```

### Readiness Assessment
- **Pre-Auth Endpoints (`verify_jwt = false`):** Correct and necessary. These 4 endpoints are called before a user JWT exists. Disabling gateway JWT verification prevents Supabase's gateway from rejecting calls if the project uses newer opaque `sb_publishable_*` keys instead of legacy JWT `anon` keys. All 4 enforce strict rate limits and server-side credential/token verification in handler code.
- **Authenticated Endpoints (`verify_jwt = true`):** Correct. Both `admin-auth-logout` and `approve-community-submission` require a live post-OTP user Bearer JWT, and both additionally perform explicit `userClient.auth.getUser()` validation (`approve-community-submission` also checks `userClient.rpc('is_verified_admin')`).
- **Deployment Verification Note:** Deploy from the repository root (`supabase functions deploy ...`) so the Supabase CLI applies `supabase/config.toml`. During Phase 4B/live testing, verify in the Supabase Dashboard that each function's JWT toggle matches `supabase/config.toml` and test `admin-auth-logout` and `approve-community-submission` with a freshly minted token (in case the project uses asymmetric ECC/ES256 JWT signing keys, verify gateway `verify_jwt = true` accepts them cleanly).

---

## 5. Storage Buckets & RLS Policies

### Inspected Configuration (`003_storage_setup.sql` & `src/lib/supabaseStorage.ts`)
| Bucket | Visibility | Size Limit | Allowed MIME Types | Public Policy | Admin Policy (`is_verified_admin()`) |
|---|---|---|---|---|---|
| `pending-submissions` | **Private** (`false`) | 5 MB | `image/jpeg`, `image/png`, `image/webp` | `INSERT` only on strict path `^(finished-drink\|suggested-product)/YYYY-MM-DD/<32-hex>\.(jpg\|png\|webp)$` (no `..` or `//`); zero `SELECT`/`UPDATE`/`DELETE` | `SELECT` (for short-lived signed URL review), `UPDATE`, `DELETE` |
| `published-drinks` | **Public** (`true`) | 5 MB | `image/jpeg`, `image/png`, `image/webp` | `SELECT` only | `INSERT`, `UPDATE`, `DELETE` with filename regex & traversal guards |
| `verified-products` | **Public** (`true`) | 5 MB | `image/jpeg`, `image/png`, `image/webp` | `SELECT` only | `INSERT`, `UPDATE`, `DELETE` with filename regex & traversal guards |
| `private-admin-backups` | **Private** (`false`) | 10 MB | `application/json` | **None** (zero anon/unverified access) | `SELECT`, `INSERT`, `UPDATE`, `DELETE` (`.json` filename regex) |

### Readiness Assessment
- Client upload validation (`validateAndOptimizeImageFile`, `uploadPendingSubmissionImage`), database approval guards (`004_phase2d_security_hardening.sql`), and server-side promotion (`approve-community-submission`) align 1:1 with `003_storage_setup.sql`.
- Approved community photos are promoted server-side via `service_role` in `approve-community-submission` into `published-drinks/community/<submissionId>/<filename>`, with compensating rollback if the DB commit fails and pending-object cleanup on success.

---

## 6. Secure Single-Owner Account Provisioning Procedure

To preserve the single-owner security model (`uq_admin_profiles_single_owner`) and ensure zero OTP bypass:

1. **Harden Supabase Auth Settings First:**
   - **Enable Email Provider** (Authentication -> Sign In / Providers -> Email).
   - **Disable Public Signups** (turn OFF "Allow new users to sign up" once the owner user is created, and keep "Confirm email" enabled) so anonymous visitors cannot self-register accounts in `auth.users`.
   - **Configure Redirect URLs** (Authentication -> URL Configuration):
     - Set **Site URL** to `https://your-domain.vercel.app`.
     - Add `https://your-domain.vercel.app/admin*` to **Redirect URLs** (and `http://localhost:3000/admin*` *only* if testing recovery from local dev). Without this, `resetPasswordForEmail` will redirect to `/` and `parsePasswordRecoveryUrl()` (which strictly requires pathname `/admin`) will ignore the recovery link.
2. **Create the Single Owner Auth User:**
   - In Supabase Dashboard -> Authentication -> Users -> **Add user** -> **Create new user**.
   - Enter the owner's lowercase email address and a strong unique password (minimum 12 characters with uppercase, lowercase, number, and symbol to match `validateNewAdminPassword`).
   - Ensure **Auto Confirm User** is enabled so `email_confirmed_at` is populated immediately.
   - Copy the generated user UUID (`id`).
3. **Link the Owner Row in `public.admin_profiles`:**
   - Run a single controlled SQL insert linking the exact Auth `id` and lowercase `email` with `role = 'owner'`, `otp_verified_until = null`, `last_active_at = null`, `failed_login_attempts = 0`, `locked_until = null`.
   - **Critical:** Leave `otp_verified_until = null` and `last_active_at = null` so the owner **must** complete real Password + 6-digit Email OTP verification before accessing any admin data or storage.
4. **Verify Single-Owner Enforcement:**
   - Confirm `uq_admin_profiles_single_owner` is active (`role = 'owner'` limited to 1 row).

---

## 7. Gmail SMTP Configuration Requirements

711acks sends admin OTPs directly over TLS/STARTTLS using Deno sockets (`supabase/functions/_shared/smtpClient.ts`) with **zero paid email APIs**.

- **Google Account Prerequisites:**
  1. Enable **2-Step Verification** on the sender Google/Gmail account.
  2. Create a dedicated **16-character Google App Password** (never use the main Gmail password).
- **Recommended Secret Values (Implicit TLS — Port 465):**
  - `SMTP_HOST="smtp.gmail.com"`
  - `SMTP_PORT="465"`
  - `SMTP_SECURE="true"`
  - `SMTP_USER="owner-sender@gmail.com"`
  - `SMTP_PASS="<16-char-google-app-password>"`
  - `SMTP_FROM="711acks Security <owner-sender@gmail.com>"` *(Keep the email inside `<...>` identical to `SMTP_USER` so Gmail does not rewrite/reject the sender.)*
- **Fallback Option (STARTTLS — Port 587):**
  - `SMTP_PORT="587"` and `SMTP_SECURE="false"` (`smtpClient.ts` requires `EHLO` to advertise `STARTTLS` before sending `AUTH LOGIN`).
- **Operational Notes:**
  - `smtpClient.ts` enforces 8s connect, 8s read/write, and 15s total timeouts, and extracts only the bare email for `MAIL FROM:<addr>`.
  - Outbound connectivity from Supabase Edge Functions to `smtp.gmail.com:465` (or `:587`) **must be tested live** in Phase 4B, as this has not been tested over the network yet.
  - Note: Password recovery emails (`supabase.auth.resetPasswordForEmail`) use Supabase Auth's built-in mailer (subject to Supabase Free Tier's ~2–4 emails/hour cap) unless you also configure custom Gmail SMTP under Supabase Dashboard -> Project Settings -> Authentication -> SMTP Settings.

---

## 8. Vercel Hobby Deployment Configuration & Environment Variables

### Inspected Files
- `vercel.json`
- `vite.config.ts`
- `package.json`
- `bun.lock`

### Findings
- **SPA Routing (`vercel.json`):**
  ```json
  {
    "rewrites": [
      {
        "source": "/((?!assets/|src/assets/).*)",
        "destination": "/index.html"
      }
    ]
  }
  ```
  Correctly serves SPA routes (`/explore`, `/drinks/:slug`, `/favorites`, `/submit`, `/about`, `/contact`, `/admin`) via `/index.html` while exempting Vite's `/assets/*` and copied `/src/assets/*` static files (`vite.config.ts` copies `src/assets` into `dist/src/assets` during `vite build`).
- **Vercel Project Build Settings:**
  - **Framework Preset:** Vite
  - **Build Command:** `npm run build` *(executes `vite build`)*
  - **Output Directory:** `dist`
  - **Install Command:** Default (`bun install` or `npm install` — note the repository includes `bun.lock` and no `package-lock.json`; Vercel auto-detects `bun.lock` cleanly, or `npm install` can be specified explicitly).
- **Vercel Environment Variables (Public Only):**
  - Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel Project Settings -> Environment Variables (Production, and Preview if using Preview deployments).
  - **Never** add `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_OTP_PEPPER`, or `SMTP_*` to Vercel.
- **Asset Size & Hobby Bandwidth Note:**
  - `public/assets/aistudio/` currently holds ~19.8 MB across 4 storefront files (`Hero_Section_Background_Night_2d852a71.jpg` 2.5 MB, `Hero_Section_Background_Day_f3260161.png` 7.6 MB, `Hero_Section_Background_Sunset_face38da.png` 7.2 MB, plus unused legacy `Hero_Section_Background_Day_564af2a6.jpg` 2.5 MB). Total deployment footprint (~21 MB) is well within Vercel Hobby limits, though the two ~7+ MB PNGs will consume more monthly Vercel Hobby Fast Data Transfer (100 GB/month) on uncached homepage loads.

---

## 9. Security & Operational Risks

| Risk / Observation | Severity | Status & Mitigation |
|---|---|---|
| Missing `ALLOWED_ORIGINS` or `ALLOW_LOCALHOST_CORS=true` left in production | Medium | All 6 Edge Functions reject unapproved origins with `403`. Set `ALLOWED_ORIGINS` strictly to the live Vercel URL(s) and verify `ALLOW_LOCALHOST_CORS="false"` in production. Note: if testing Vercel Preview URLs, each preview origin must be explicitly added to `ALLOWED_ORIGINS` or tested only on the primary production domain. |
| Missing `/admin*` Redirect URL in Supabase Auth blocks live password recovery | Medium | Add `https://your-domain.vercel.app/admin*` to Supabase Auth -> URL Configuration -> Redirect URLs so `resetPasswordForEmail` lands on `/admin?recovery=1` (parsed by `parsePasswordRecoveryUrl()`). |
| Outbound SMTP blocked/throttled or wrong `SMTP_FROM` / App Password | Medium | Verify port `465` (`SMTP_SECURE=true`) or `587` (`SMTP_SECURE=false`) in live Phase 4B testing. Changing the Google account password automatically revokes Google App Passwords. |
| Gateway `verify_jwt = true` vs project JWT signing keys | Low–Medium | Pre-auth functions correctly use `verify_jwt = false`. Verify during live testing that `admin-auth-logout` and `approve-community-submission` (`verify_jwt = true`) accept newly minted GoTrue access tokens cleanly. |
| Supabase Free Tier 7-day inactivity pause & audit/rate-limit table growth | Low (Operational) | Free Tier projects pause after 7 days of zero traffic. `admin_otp_challenges` and `admin_auth_rate_limits` grow monotonically; plan periodic SQL cleanup of expired rows >7 days old during operations. |
| Anonymous Likes rate-limited by browser ID (`like_rate_limits`) | Low (Known) | Documented in migration `002`: prevents casual duplicate likes without forcing visitor registration, but determined users clearing cookies/storage can rotate browser IDs. |
| Empty live catalog immediately after migrations | Informational | Migrations `001`–`006` leave `products` and `recipes` empty; owner must populate verified 7-Eleven Philippines catalog items and drink recipes after first login. |
| Legacy unused hero asset & template placeholders | Informational | `public/assets/aistudio/Hero_Section_Background_Day_564af2a6.jpg` (2.5 MB) is unused by `heroScene.ts`; `.env.example` keeps host template keys (`GEMINI_API_KEY`, `APP_URL`). Neither affects runtime or security. |

---

## 10. GitHub Repository State & Required Files Verification

All required project files are present in the workspace:

- **Root Config & Docs:** `package.json`, `tsconfig.json`, `vite.config.ts`, `vercel.json`, `index.html`, `metadata.json`, `.env.example`, `.gitignore`, `bun.lock`, `README.md`.
- **Frontend (`src/`):** `App.tsx`, `main.tsx`, `index.css`, `types/domain.ts`, `data/seedData.ts`, `context/AppContext.tsx`, `utils/drinkLogic.ts`, all 8 pages (`HomePage`, `ExplorePage`, `DrinkDetailsPage`, `FavoritesPage`, `SubmitHackPage`, `AboutPage`, `ContactPage`, `AdminDashboardPage`), all components (`Navbar`, `Footer`, `DrinkCard`, `HeroFlashlight`, `heroScene`, `MaintenanceScreen`), all controllers/clients (`supabaseClient`, `supabaseRepository`, `supabaseStorage`, `adminAuthController`, `appDataController`, `communityApprovalController`), and all 8 test files (`95` passing tests).
- **Supabase Backend (`supabase/`):** `config.toml`, migrations `001` through `006`, `_shared/adminAuthShared.ts`, `_shared/smtpClient.ts`, and all 6 Edge Functions (`admin-auth-initiate`, `admin-auth-resend`, `admin-auth-verify`, `admin-auth-logout`, `admin-auth-complete-recovery`, `approve-community-submission`).
- **Documentation (`docs/`):** `711acks-master-prompt.md`, `PHASE_3_5_SECURITY_AUDIT.md`, `PHASE_3_6_SECURITY_FIXES_REPORT.md`.
- **Secret Hygiene:** `.gitignore` ignores `.env*` while preserving `!.env.example`. Verified zero `.env` or `.env.local` files exist in the workspace.
- **Environment Limitation Note:** Inside the AI Studio sandbox container, `.git/` metadata is not exposed (the GitHub push was performed externally from your local environment), so remote branch/commit logs were not directly queried via `git`. All workspace files listed above were directly verified on disk.

---

## Exact Step-by-Step Preparation & Provisioning Plan (Phase 4B)

Do **not** execute any of these steps until explicitly approved to begin Phase 4B:

1. **Step 1 — Create Free-Tier Supabase Project:**
   - Create a new Supabase project in the nearest Asia-Pacific region (e.g., Singapore `ap-southeast-1`) on the Free plan.
   - Record the Project Reference ID, `Project URL`, public `anon` key, and (strictly locally/temporarily in your password manager) the `service_role` key. Never share keys in chat or commit them to Git.
2. **Step 2 — Run Database & Storage Migrations (`001` → `006`):**
   - Apply migrations strictly in numerical order via Supabase CLI (`supabase link` + `supabase db push`) or Supabase SQL Editor:
     1. `001_711acks_schema.sql`
     2. `002_phase2_database_foundation.sql`
     3. `003_storage_setup.sql`
     4. `004_phase2d_security_hardening.sql`
     5. `005_phase3_admin_otp_auth.sql`
     6. `006_phase36_security_hardening.sql`
   - Verify 4 Storage buckets exist (`pending-submissions` private, `published-drinks` public, `verified-products` public, `private-admin-backups` private) and `website_settings` row `id = 1` exists.
3. **Step 3 — Configure Supabase Auth & Redirect URLs:**
   - Enable **Email** auth provider and keep **Confirm email** ON.
   - Set **Site URL** to `https://your-domain.vercel.app`.
   - Add `https://your-domain.vercel.app/admin*` to **Redirect URLs** (and `http://localhost:3000/admin*` only if testing local dev recovery).
4. **Step 4 — Generate & Set Edge Function Secrets (`supabase secrets set`):**
   - Generate a cryptographically random 64-character `ADMIN_OTP_PEPPER`.
   - Generate a 16-character Google App Password (with 2-Step Verification enabled on the owner Gmail account).
   - Configure all Edge Function secrets via CLI (`ADMIN_OTP_PEPPER`, `ADMIN_OTP_VALIDITY_MINUTES=120`, `ALLOWED_ORIGINS=https://your-domain.vercel.app`, `ALLOW_LOCALHOST_CORS=false`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM="711acks Security <owner@gmail.com>"`).
5. **Step 5 — Deploy All 6 Edge Functions:**
   - Deploy from repo root so `supabase/config.toml` applies automatically:
     - `admin-auth-initiate` (`verify_jwt = false`)
     - `admin-auth-resend` (`verify_jwt = false`)
     - `admin-auth-verify` (`verify_jwt = false`)
     - `admin-auth-complete-recovery` (`verify_jwt = false`)
     - `admin-auth-logout` (`verify_jwt = true`)
     - `approve-community-submission` (`verify_jwt = true`)
   - Verify in Supabase Dashboard -> Edge Functions that JWT verification settings match `supabase/config.toml`.
6. **Step 6 — Provision Single Owner Account & Lock Down Public Signups:**
   - Create the single owner user in Supabase Auth (Auto Confirm ON, strong >= 12-char password) and note the `uuid`.
   - Insert the single matching row in `public.admin_profiles` (`role = 'owner'`, `otp_verified_until = null`, `last_active_at = null`).
   - Disable **Allow new users to sign up** in Supabase Auth settings so no secondary accounts can be registered.
7. **Step 7 — Deploy Frontend to Vercel Hobby:**
   - Import the GitHub repository into Vercel (Vite preset, `npm run build`, output `dist`).
   - Add **only** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel Project Environment Variables.
   - Trigger production deployment and verify the live production URL matches `ALLOWED_ORIGINS` and Supabase Auth **Site URL** / **Redirect URLs** exactly.
8. **Step 8 — Execute Live End-to-End Validation Checklist (Phase 4C):**
   - Confirm public pages load cleanly from live Supabase (even while catalog is initially empty) and verify zero secrets or admin tokens exist in `localStorage`/`sessionStorage`.
   - Test wrong password lockout (`5` attempts -> 15m lock) and rate limits (`429`).
   - Test live Step 1 password -> real Gmail SMTP 6-digit OTP receipt -> Step 2 verification -> Dashboard access.
   - Test `approve-community-submission` (upload pending image -> approve -> verify promotion to `published-drinks` and cleanup from `pending-submissions`).
   - Test inactivity expiry / manual logout (`P0001 UNAUTHORIZED` heartbeat rejection returns UI to login gate; replayed JWT rejected) and live password recovery (`/admin?recovery=1` requires full Password + OTP afterwards).
   - Seed initial verified 7-Eleven Philippines products and drink combinations via `/admin`.

---

## Final Verdict

### **`READY FOR PHASE 4B`**

The codebase, SQL migrations (`001`–`006`), Storage policies, 6 Edge Functions, `supabase/config.toml`, Vercel SPA config, `.gitignore`, `.env.example`, and `README.md` are complete, consistent, and verified locally (`tsc --noEmit` 0 errors, `95 / 95` tests passing, zero secrets committed). Live Supabase provisioning, secret configuration, Edge Function deployment, single-owner provisioning, and Vercel deployment are ready to proceed in Phase 4B upon your explicit approval.
