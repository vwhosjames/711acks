# 711acks

An independent, fan-made digital collection of creative drink combinations made exclusively from products available at 7-Eleven Philippines.

---

## Independent Project Disclaimer

**711acks is an independent, fan-made personal portfolio project.** It is **not** affiliated with, sponsored by, operated by, or endorsed by **7-Eleven, Inc.** or **Philippine Seven Corporation**. All product names, packaging, logos, and trademarks belong to their respective owners. Prices shown in the catalog reflect verified in-store snapshots and may vary by branch.

---

## Project Overview

711acks lets visitors browse curated 7-Eleven Philippines drink mixes across three focused categories (**Coffee Mixes**, **Chocolate-Based**, and **Fruity & Soda**), see transparent **full-unit purchase costs** in Philippine Pesos (PHP), save favorites in their browser, and submit their own community drink hacks for moderation.

For the site owner, 711acks includes a protected **Admin Console** (`/admin`) backed by Supabase PostgreSQL Row-Level Security (RLS), Supabase Storage, and server-side **Password + 6-digit Email OTP** authentication.

### Implementation Status: Local vs. Live Validation

- **Implemented & Verified Locally:** All frontend pages, UI components, pricing logic, Local Preview Mode, SQL migrations (`001`–`006`), Storage policies, Edge Functions, and 95 automated unit and security-contract tests have been implemented and verified locally (`tsc --noEmit`, `vite build`, `tsx --test`, and `bun audit`).
- **Not Yet Live-Tested:** Live Supabase provisioning, running migrations `001`–`006` against a live database, deploying Edge Functions to Supabase, live Gmail/SMTP OTP delivery, live Supabase Auth session minting, and production Vercel deployment have **not** been executed or verified against live cloud services yet.

---

## Main Features Currently Implemented

### Public Experience
- **Interactive Dual-Scene Hero (`/`):** Full-width storefront hero with a circular cursor-following flashlight reveal.
  - Default **Night Scene** reveals the Daytime storefront inside the spotlight.
  - **Full Daytime Scene** toggle switches the background to Daytime and reveals the Sunset storefront inside the spotlight.
- **Explore Archive (`/explore`):** Search by drink name or ingredient name, filter by approved category (`Coffee Mixes`, `Chocolate-Based`, `Fruity & Soda`), and sort results (including by lowest full purchase cost).
- **Drink Details (`/drinks/:slug`):**
  - Displays finished drink photo, category, full product purchase cost (charging whole product units rather than fractional amounts), individual product prices, last price verification date, and clickable ingredient photo lightbox.
  - Supports **Likes** (server-persisted via Supabase RPC when configured, or local preview fallback), **Browser Favorites** (`localStorage`), **Share** actions, and **QR Codes** for published drinks.
- **Saved Favorites (`/favorites`):** Browser-stored list of bookmarked drink recipes.
- **Submit a Drink Hack (`/submit`):** Visitors can build a recipe using verified catalog products or suggest new products, upload photos (JPEG, PNG, WebP up to 5 MB), preview their submission, see duplicate-recipe warnings, and submit to the moderation queue.
- **About & Contact/Report (`/about`, `/contact`):** Project disclaimer and structured issue/price reporting form.
- **Appearance & Maintenance Gate:** Light/Dark theme toggle (Midnight Green design system) and a public Maintenance Mode screen that keeps `/admin` accessible to the owner.

### Owner Admin Console (`/admin`)
- **Ten Management Modules:** Overview, Recipes, Community Submissions, Product Catalog, Contact Reports, QR Codes, Recipe Revisions, Backups, Maintenance Mode, and Website Settings.
- **Catalog & Pricing Safeguards:** Barcode validation, price history tracking, and price-review flags when a product's catalog price changes (without silently mutating historical recipe purchase snapshots).
- **Moderated Image Promotion:** Community uploads are stored in a private bucket (`pending-submissions`) and promoted server-side to `published-drinks` only upon verified admin approval.
- **Two Operating Modes:**
  - **Local Preview Mode** (default when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset): Runs with seeded demo data and browser `localStorage` so the UI can be explored offline.
  - **Live Supabase Mode** (when configured): Uses Supabase PostgreSQL, RPCs, Storage, and Edge Functions with explicit loading and error states (no silent fallback to `localStorage`).

---

## Technology Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`)
- **UI & Utilities:** `lucide-react` (icons), `qrcode.react` (QR code generation)
- **Backend & Data (Supabase Free Tier compatible):**
  - `@supabase/supabase-js` client SDK
  - PostgreSQL database with Row-Level Security (RLS) and `SECURITY DEFINER` RPC functions
  - Supabase Storage (public and private buckets with MIME and 5 MB size policies)
  - Supabase Edge Functions (Deno runtime) with direct TLS/STARTTLS SMTP email delivery (zero paid email API dependency)
- **Testing & Tooling:** Node.js built-in test runner executed with `tsx`, TypeScript compiler (`tsc --noEmit`), and Vite production bundler

---

## Project Folder Structure

```text
711acks/
├── docs/                                # Architecture prompt, Phase 3.5 audit & Phase 3.6 hardening report
├── public/                              # Static public assets (including hero storefront artwork)
├── src/
│   ├── assets/                          # Local drink & product image assets
│   ├── components/                      # Navbar, Footer, DrinkCard, HeroFlashlight, heroScene, MaintenanceScreen
│   ├── context/
│   │   └── AppContext.tsx               # Global app state, Supabase/local routing, admin session & heartbeat
│   ├── data/
│   │   └── seedData.ts                  # Seeded demo products and recipes for Local Preview Mode
│   ├── lib/
│   │   ├── adminAuthController.ts       # Edge Function invokers, OTP helpers, heartbeat & recovery logic
│   │   ├── appDataController.ts         # Live/local data coordination helpers
│   │   ├── communityApprovalController.ts # Community submission approval Edge Function invoker
│   │   ├── supabaseClient.ts            # Memory-only Supabase client initialization & image helper
│   │   ├── supabaseRepository.ts        # Typed PostgreSQL queries, RPC calls, and error normalization
│   │   ├── supabaseStorage.ts           # Bucket upload, validation, and signed URL helpers
│   │   └── *.test.ts                    # Unit, integration, storage, and security contract test suites
│   ├── pages/                           # Home, Explore, DrinkDetails, Favorites, SubmitHack, About, Contact, AdminDashboard
│   ├── types/
│   │   └── domain.ts                    # Shared TypeScript domain models and approved categories
│   ├── utils/
│   │   ├── drinkLogic.ts                # Full-unit cost math, duplicate detection, barcode & backup validation
│   │   └── drinkLogic.test.ts           # Core domain logic tests
│   ├── App.tsx                          # Client-side router and maintenance mode gate
│   ├── index.css                        # Tailwind CSS v4 entry and theme tokens
│   └── main.tsx                         # React entry point
├── supabase/
│   ├── config.toml                      # Edge Function verify_jwt configuration
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── adminAuthShared.ts       # Strict CORS allowlist, trusted IP extraction, CSPRNG & HMAC OTP helpers
│   │   │   └── smtpClient.ts            # Direct TLS/STARTTLS SMTP client with socket timeouts & sender parsing
│   │   ├── admin-auth-initiate/         # Step 1 password check, lockout, OTP generation & SMTP send
│   │   ├── admin-auth-resend/           # Atomic OTP rotation, cooldown, and IP/account rate limiting
│   │   ├── admin-auth-verify/           # Step 2 atomic OTP verification & post-OTP session minting
│   │   ├── admin-auth-logout/           # Server-side OTP revocation & global Auth sign-out
│   │   ├── admin-auth-complete-recovery/# Server-side owner password reset without bypassing OTP
│   │   └── approve-community-submission/# Verified image promotion (private -> public) & atomic recipe publish
│   └── migrations/
│       ├── 001_711acks_schema.sql
│       ├── 002_phase2_database_foundation.sql
│       ├── 003_storage_setup.sql
│       ├── 004_phase2d_security_hardening.sql
│       ├── 005_phase3_admin_otp_auth.sql
│       └── 006_phase36_security_hardening.sql
├── .env.example                         # Placeholder template for frontend and server-side env variables
├── .gitignore                           # Excludes node_modules, dist, build, logs, and .env* files
├── index.html                           # HTML entry point
├── package.json                         # Project dependencies and scripts
├── tsconfig.json                        # TypeScript configuration
├── vercel.json                          # Vercel SPA rewrite configuration
└── vite.config.ts                       # Vite bundler and static asset copy configuration
```

---

## Local Development Setup

### Prerequisites
- **Node.js** (v20+ recommended) and **npm** (or **Bun**, if preferred — a `bun.lock` lockfile is present)
- Optional (only needed when connecting to a live Supabase project): **Supabase CLI**

### Install & Run Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Optional — create a local environment file** (skip this step to run in offline **Local Preview Mode**):
   ```bash
   cp .env.example .env.local
   ```
   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only when you are ready to connect to a live Supabase project.

3. **Start the development server** (runs on port `3000`):
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

4. **Other scripts defined in `package.json`:**
   ```bash
   npm run build    # Build production bundle into dist/
   npm run preview  # Preview the built dist/ bundle locally
   npm run lint     # Run TypeScript typechecking (tsc --noEmit)
   npm run clean    # Remove dist/ and server.js if present
   ```

---

## Required Environment Variables

Use **placeholders only** in documentation and templates. Never commit real values.

### Frontend Variables (`.env.local` for local live mode, or Vercel Project Settings)

These variables are bundled into the browser client and must only hold **public** Supabase values:

```env
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_ANON_KEY="your-supabase-anon-public-key"
```

> Note: `.env.example` also contains template placeholders for `GEMINI_API_KEY` and `APP_URL` from the development workspace, though the 711acks application itself does not require Gemini AI calls to run.

### Server-Side Supabase Edge Function Secrets

Configure these **only** inside Supabase Edge Function secrets (never prefix them with `VITE_` and never place them in frontend `.env` files):

```bash
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key" \
  ADMIN_OTP_PEPPER="your-random-64-char-secret-pepper" \
  ADMIN_OTP_VALIDITY_MINUTES="120" \
  ALLOWED_ORIGINS="https://your-domain.vercel.app" \
  ALLOW_LOCALHOST_CORS="false" \
  SMTP_HOST="smtp.gmail.com" \
  SMTP_PORT="465" \
  SMTP_SECURE="true" \
  SMTP_USER="your-smtp-username@gmail.com" \
  SMTP_PASS="your-16-char-app-password" \
  SMTP_FROM="711acks Security <your-smtp-username@gmail.com>"
```

- Set `ALLOW_LOCALHOST_CORS="true"` **only** during local development against a remote Supabase project; keep it `"false"` in production.
- `SMTP_PORT="465"` uses implicit TLS (`SMTP_SECURE="true"`). `SMTP_PORT="587"` uses mandatory `STARTTLS` (`SMTP_SECURE="false"`).

---

## Supabase Configuration Overview

When connected to a live Supabase project, 711acks uses three Supabase services:

1. **PostgreSQL Database & RLS:**
   - All tables enable Row-Level Security.
   - Public visitors can read published recipes, active catalog products, and public website settings, and submit community hacks/reports/likes strictly through validated `SECURITY DEFINER` RPCs (direct public table `INSERT` policies were removed in migration `004`).
   - All privileged admin reads, writes, and RPCs are gated by `public.is_verified_admin()`, which checks the authenticated single owner account, lockout status, `otp_verified_until > now()`, and `last_active_at` within the 30-minute inactivity timeout.
2. **Supabase Storage (4 Buckets created in Migration `003`):**
   - `pending-submissions` (**Private**): Visitor-uploaded community photos awaiting moderation (JPEG, PNG, WebP, max 5 MB).
   - `published-drinks` (**Public read, verified-admin write**): Approved finished drink photos.
   - `verified-products` (**Public read, verified-admin write**): Verified catalog product photos.
   - `private-admin-backups` (**Private, verified-admin only**): Owner backup packages.
3. **Edge Functions Configuration (`supabase/config.toml`):**
   - Pre-authentication functions (`admin-auth-initiate`, `admin-auth-resend`, `admin-auth-verify`, `admin-auth-complete-recovery`) set `verify_jwt = false` so they work before a user session exists.
   - Authenticated admin functions (`admin-auth-logout`, `approve-community-submission`) set `verify_jwt = true` and additionally validate the caller's JWT and `is_verified_admin()` inside the handler.

---

## Admin Authentication & Email OTP Overview

In Live Supabase Mode, `/admin` enforces a strict two-step server-side login for a **single designated owner account** (enforced at the database level via the `uq_admin_profiles_single_owner` unique index):

1. **Step 1 — Server-Side Password Check (`admin-auth-initiate`):**
   - The browser never calls `supabase.auth.signInWithPassword()`.
   - Credentials are verified server-side on a disposable Auth client whose short-lived token is immediately revoked and never sent to the browser.
   - Five failed password attempts atomically trigger a 15-minute lockout (`record_admin_failed_login`).
   - On valid password, the server generates a cryptographically secure 6-digit OTP, stores only its `HMAC-SHA256` hash (`ADMIN_OTP_PEPPER`) and a hashed opaque challenge token, and emails the code via direct TLS/STARTTLS SMTP with strict socket timeouts. If SMTP fails, the challenge is immediately invalidated.
2. **Step 2 — Atomic Single-Use OTP Verification (`admin-auth-verify`):**
   - `verify_admin_otp_challenge` locks the challenge and owner rows (`FOR UPDATE`), compares hashes in constant time, enforces the 5-minute expiry and 5-attempt cap, marks the challenge used, and updates `otp_verified_until` and `last_active_at`.
   - Only after verification succeeds does the server mint and return a Supabase Auth session.
3. **Memory-Only Sessions & Timeouts:**
   - `src/lib/supabaseClient.ts` configures `persistSession: false` and `detectSessionInUrl: false` — live admin tokens are never written to `localStorage` or `sessionStorage`.
   - Activity heartbeats (`touch_admin_activity`) update the local countdown only after server confirmation and immediately clear privileged state if the server rejects the session.
   - Both the 30-minute inactivity timeout and the absolute OTP cap (`ADMIN_OTP_VALIDITY_MINUTES`, default 120 minutes) are enforced on the server.
4. **OTP-Safe Password Recovery (`admin-auth-complete-recovery`):**
   - Opening a recovery email link on `/admin` parses the recovery token strictly in memory, immediately scrubs the URL with `history.replaceState`, updates the owner password server-side, revokes all sessions and OTP states globally, and returns zero tokens — requiring a fresh Password + 6-digit Email OTP login afterwards.

---

## Database Migration Order (`001`–`006`)

Apply migrations in strict numerical order when provisioning a Supabase database:

1. `supabase/migrations/001_711acks_schema.sql` — Core tables, constraints, RLS enablement, and initial `is_verified_admin()` helper.
2. `supabase/migrations/002_phase2_database_foundation.sql` — Hardened `is_verified_admin()`, `touch_admin_activity()`, `website_settings`, public/admin RPCs, and least-privilege grants.
3. `supabase/migrations/003_storage_setup.sql` — Provisions the 4 Storage buckets (`pending-submissions`, `published-drinks`, `verified-products`, `private-admin-backups`), MIME/5 MB limits, and `storage.objects` RLS policies.
4. `supabase/migrations/004_phase2d_security_hardening.sql` — Removes direct public `INSERT` policies in favor of RPCs, adds atomic `submit_community_hack`, `resolve_unique_recipe_slug`, `save_recipe_with_ingredients`, and `approve_community_submission`.
5. `supabase/migrations/005_phase3_admin_otp_auth.sql` — Enforces single-owner constraint, adds OTP challenge columns/indexes, `admin_auth_rate_limits`, `check_admin_auth_rate_limit`, `verify_admin_otp_challenge`, and `revoke_admin_otp_session` (`service_role` only).
6. `supabase/migrations/006_phase36_security_hardening.sql` — Adds `constant_time_text_equal`, requires `last_active_at IS NOT NULL` in `is_verified_admin()`, guards `resolve_unique_recipe_slug` with `is_verified_admin()`, makes rate-limit creation first-insert race-safe, and adds atomic `record_admin_failed_login` and `rotate_admin_otp_challenge_for_resend` RPCs.

---

## Supabase Edge Functions

All Edge Functions enforce strict `ALLOWED_ORIGINS` validation (`403` on disallowed origins, no wildcard `*`) and `Cache-Control: no-store`.

| Edge Function | `verify_jwt` | Purpose |
|---|---|---|
| `admin-auth-initiate` | `false` | Step 1 server-side owner password check, IP/account rate limiting, atomic lockout tracking, OTP creation, and SMTP dispatch. |
| `admin-auth-resend` | `false` | Fail-closed IP rate limit, atomic `FOR UPDATE` OTP challenge rotation with 30-second cooldown, and SMTP resend. |
| `admin-auth-verify` | `false` | Step 2 atomic single-use 6-digit OTP verification, post-OTP session minting, and rollback if minting fails. |
| `admin-auth-logout` | `true` | Validates caller JWT, clears `otp_verified_until` via `revoke_admin_otp_session`, and globally revokes Supabase Auth sessions. |
| `admin-auth-complete-recovery` | `false` | Validates owner recovery token server-side, enforces strong password policy, updates password, revokes all sessions/OTP states, and returns zero tokens. |
| `approve-community-submission` | `true` | Verifies JWT and `is_verified_admin()`, validates and promotes private `pending-submissions` image to `published-drinks`, commits approval atomically, rolls back promoted image on DB failure, and cleans up the pending image on success. |

Shared server-only modules live under `supabase/functions/_shared/` (`adminAuthShared.ts` and `smtpClient.ts`) and are never imported into the production browser bundle.

---

## Testing, Typechecking, Linting, and Build Commands

### Typecheck / Lint
```bash
npm run lint
```
*(Runs `tsc --noEmit`.)*

### Production Build
```bash
npm run build
```
*(Runs `vite build` and copies `src/assets` into `dist/src/assets` via `vite.config.ts`.)*

### Automated Test Suites (95 tests across 8 files)
```bash
npx tsx --test \
  src/components/heroScene.test.ts \
  src/utils/drinkLogic.test.ts \
  src/lib/supabaseRepository.test.ts \
  src/lib/phase2bIntegration.test.ts \
  src/lib/phase2cStorageReadiness.test.ts \
  src/lib/phase2dHardening.test.ts \
  src/lib/phase3AdminOtpAuth.test.ts \
  src/lib/phase36SecurityFixes.test.ts
```

### Dependency Audit
If using Bun:
```bash
bun audit
```

---

## Deployment Preparation for Vercel

The repository already includes `vercel.json` configured for client-side SPA routing:

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

When you are ready to deploy to Vercel (not yet executed):

1. Import the GitHub repository into Vercel.
2. Confirm build settings:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Add **only** the public frontend environment variables in Vercel Project Settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy migrations `001`–`006` and the 6 Edge Functions to your live Supabase project, then set `ALLOWED_ORIGINS` in Supabase Edge Function secrets to your exact Vercel URL (for example, `https://your-app.vercel.app`) with `ALLOW_LOCALHOST_CORS=false`.
5. Run live end-to-end validation (live Gmail SMTP delivery, live OTP verification, 30-minute session expiry, RLS negative tests, and community image approval) before opening public access. See `docs/PHASE_3_6_SECURITY_FIXES_REPORT.md` for the full live-testing checklist.

---

## Security Reminders

- **Never commit `.env`, `.env.local`, or any secret file.** `.gitignore` already ignores `.env*` while keeping `.env.example` tracked.
- **Never expose `SUPABASE_SERVICE_ROLE_KEY`** in frontend code, Vite variables (`VITE_*`), Vercel browser env vars, or client bundles.
- **Keep `SMTP_USER`, `SMTP_PASS`, and `ADMIN_OTP_PEPPER` strictly server-side** inside Supabase Edge Function secrets.
- **Never commit real passwords, App Passwords, bearer tokens, recovery links, or API keys** to Git history, issues, or pull requests.
- Before your first push to GitHub, run `git status` and review staged files to verify no secret files or credentials are included.
