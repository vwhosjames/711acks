# 711acks — Phase 4B-2: Live Database Migration Preflight Report

- **Phase:** 4B-2 (Strictly Read-Only Live Migration Preflight)
- **Target Project:** `711acks` — Supabase Free Plan, Southeast Asia (Singapore)
- **Database State:** Fresh project (no application tables in `public`)
- **Inspected Files:** `supabase/migrations/001_711acks_schema.sql` through `supabase/migrations/006_phase36_security_hardening.sql`, `supabase/config.toml`
- **Final Verdict:** **`READY TO APPLY`**

---

## Executive Summary

All six repository SQL migrations (`001`–`006`) were inspected line-by-line in exact execution order for a fresh Supabase Free-tier PostgreSQL database.

- **Execution Order Valid for a Fresh Database:** Migrations `001` → `002` → `003` → `004` → `005` → `006` form a valid, strictly sequential dependency chain with zero references to pre-existing custom tables or seed data.
- **Zero Data-Destructive DDL:** There are **no** `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `DROP TYPE`, or `TRUNCATE` statements anywhere in `001`–`006`.
- **Supabase Schema & Permission Safety:** Migration `003` intentionally omits `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` to prevent SQL Editor ownership errors (`42501`), and `001` guards `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` cleanly.
- **Key Preflight Finding (`001` Re-Run Behavior):** Unlike `002`–`006` (which are fully idempotent via `DROP POLICY IF EXISTS`, `IF NOT EXISTS`, and `CREATE OR REPLACE`), `001_711acks_schema.sql` issues 23 `CREATE POLICY` statements without `DROP POLICY IF EXISTS`. It executes cleanly once on a fresh database, **but** would fail with `42710 (policy already exists)` if run a second time after a partial failure without cleanup.
- **Security Continuity Precaution:** `001` temporarily creates public `INSERT` and `likes` `SELECT` policies that are intentionally removed in `002` and `004`. All six scripts must be executed completely in one contiguous session before connecting the frontend or Edge Functions.

---

## 1. Migration-by-Migration Summary (`001`–`006`)

### 1.1 `001_711acks_schema.sql` (425 lines)
- **Purpose:** Core schema, custom PostgreSQL enums, initial triggers, RLS enablement, and baseline RLS policies.
- **Objects Created:**
  - Extension: `pgcrypto` (`IF NOT EXISTS`).
  - Enums (`public`): `drink_category`, `recipe_status`, `report_category` (wrapped in `duplicate_object` exception blocks).
  - 16 Tables (`IF NOT EXISTS`): `admin_profiles` (FK to `auth.users(id)`), `admin_otp_challenges`, `products`, `product_price_history`, `recipes`, `recipe_ingredients`, `recipe_price_snapshots`, `community_submissions`, `submission_ingredients`, `product_suggestions`, `recipe_revisions`, `likes`, `contact_reports`, `website_settings`, `security_events`, `backup_records`.
  - 5 Indexes (`IF NOT EXISTS`): `idx_products_name`, `idx_recipes_status_category`, `idx_recipes_slug`, `idx_recipe_ingredients_recipe`, `idx_recipe_ingredients_product`.
  - 2 Functions: `public.handle_product_price_change()`, `public.is_verified_admin()`.
  - 1 Trigger: `trg_product_price_change` on `public.products` (after update of `purchase_price`).
  - RLS enabled on all 16 tables + 23 baseline policies.
- **Idempotency Note:** Partially idempotent only. Tables, enums, indexes, and the trigger are guarded, **but lines 309–415 create 23 RLS policies without `DROP POLICY IF EXISTS`**. Safe on a fresh database; not safe to re-run blind if interrupted after line 309.

### 1.2 `002_phase2_database_foundation.sql` (1,462 lines)
- **Purpose:** Seeds the `website_settings` singleton, adds data-integrity constraints and indexes, locks down `likes` privacy via rate-limited RPCs, hardens `SECURITY DEFINER` `search_path`, and installs transactional public/admin RPCs.
- **Objects Created / Modified:**
  - Row seed: `public.website_settings (id = 1)` via `ON CONFLICT (id) DO NOTHING`.
  - 8 Constraints (`chk_recipes_published_requires_verified_price`, `chk_products_name_nonempty`, `chk_products_photo_nonempty`, `chk_products_barcode_format`, `chk_community_submissions_drink_name_len`, `uq_recipe_revisions_recipe_version`, `chk_likes_anonymous_browser_id_format`, `chk_website_settings_session_timeout_range`).
  - 16 Indexes (`IF NOT EXISTS`).
  - 1 Table: `public.like_rate_limits` (RLS enabled, zero public policies).
  - Replaces `public.is_verified_admin()` and `public.handle_product_price_change()` with `set search_path = public, pg_temp`.
  - Drops 17 baseline policies (`DROP POLICY IF EXISTS`) — removing open `likes` `SELECT`/`INSERT` policies — and creates 12 explicit `to authenticated` / `WITH CHECK` policies.
  - Creates 9 `SECURITY DEFINER` RPCs: `get_liked_recipe_ids`, `toggle_recipe_like`, `submit_community_hack`, `submit_contact_report`, `touch_admin_activity`, `save_recipe_with_ingredients`, `verify_recipe_catalog_prices`, `approve_community_submission`, `restore_recipe_revision`.
  - Applies explicit `REVOKE ALL ... FROM public` and targeted `GRANT EXECUTE` permissions.
- **Idempotency:** Fully idempotent.

### 1.3 `003_storage_setup.sql` (336 lines)
- **Purpose:** Provisions the 4 separated Supabase Storage buckets and creates 16 bucket-scoped `storage.objects` RLS policies.
- **Objects Created / Modified:**
  - 4 Storage Buckets (`INSERT ... ON CONFLICT (id) DO UPDATE`):
    1. `pending-submissions` (`public = false`, 5 MB, JPEG/PNG/WebP)
    2. `published-drinks` (`public = true`, 5 MB, JPEG/PNG/WebP)
    3. `verified-products` (`public = true`, 5 MB, JPEG/PNG/WebP)
    4. `private-admin-backups` (`public = false`, 10 MB, `application/json`)
  - 16 `storage.objects` Policies (4 per bucket, each guarded by `DROP POLICY IF EXISTS`), enforcing path/traversal validation and `public.is_verified_admin()`.
- **Supabase Ownership Precaution:** Deliberately omits `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` to avoid `42501` ownership errors in SQL Editor (Supabase enables RLS on `storage.objects` by default).
- **Idempotency:** Fully idempotent.

### 1.4 `004_phase2d_security_hardening.sql` (796 lines)
- **Purpose:** Eliminates direct public table inserts in favor of `SECURITY DEFINER` RPCs, validates `pending-submissions` paths on submit, enforces promoted public image checks on approval, and adds advisory-locked recipe slug collision resolution.
- **Objects Created / Modified:**
  - Drops 4 direct public `INSERT` policies (`community_submissions`, `submission_ingredients`, `product_suggestions`, `contact_reports`) via `DROP POLICY IF EXISTS`.
  - Creates `public.resolve_unique_recipe_slug(text, uuid)` (uses transaction-scoped `pg_advisory_xact_lock`).
  - Replaces `public.submit_community_hack`, `public.save_recipe_with_ingredients`, and `public.approve_community_submission` preserving identical parameter/return signatures from `002`.
  - Reaffirms least-privilege `REVOKE`/`GRANT` rules on the 5 RPCs.
- **Idempotency:** Fully idempotent.

### 1.5 `005_phase3_admin_otp_auth.sql` (391 lines)
- **Purpose:** Enforces the single-owner database invariant, extends OTP challenges with token hashes/IP audit hashes, and installs `service_role`-only OTP verification, session revocation, and rate-limiting functions.
- **Objects Created / Modified:**
  - Unique Partial Index: `uq_admin_profiles_single_owner` on `public.admin_profiles (role) where role = 'owner'`.
  - Columns (`ADD COLUMN IF NOT EXISTS`): `challenge_token_hash` and `ip_hash` on `public.admin_otp_challenges` + partial index `idx_admin_otp_challenges_token_active`.
  - 1 Table: `public.admin_auth_rate_limits` (RLS enabled, zero client policies).
  - 3 Functions (`service_role` only): `check_admin_auth_rate_limit`, `verify_admin_otp_challenge`, `revoke_admin_otp_session`.
  - Strict `REVOKE ALL ... FROM public, anon, authenticated` + `GRANT EXECUTE ... TO service_role`.
- **Idempotency:** Fully idempotent on a fresh DB (would only fail if `admin_profiles` somehow held multiple `'owner'` rows beforehand).

### 1.6 `006_phase36_security_hardening.sql` (673 lines)
- **Purpose:** Implements Phase 3.6 database security hardening: constant-time hash checks, non-null `last_active_at` enforcement in `is_verified_admin()`, admin guard on `resolve_unique_recipe_slug`, race-safe rate-limit creation, atomic failed-login lockout, and atomic OTP resend rotation.
- **Objects Created / Modified:**
  - Creates 3 Functions (`service_role` only): `constant_time_text_equal`, `record_admin_failed_login`, `rotate_admin_otp_challenge_for_resend`.
  - Replaces 4 Functions (all keeping identical signatures/return types): `is_verified_admin`, `resolve_unique_recipe_slug`, `check_admin_auth_rate_limit` (`INSERT ... ON CONFLICT DO NOTHING`), `verify_admin_otp_challenge` (uses `constant_time_text_equal`).
  - Sets strict `REVOKE`/`GRANT` permissions (`service_role` for auth RPCs; `authenticated` for `resolve_unique_recipe_slug`).
- **Idempotency:** Fully idempotent.

---

## 2. Dependency Graph & Strict Execution Order

The required execution sequence is strictly **`001` → `002` → `003` → `004` → `005` → `006`**:

1. **`001` (Baseline Schema & Supabase `auth` Link)**
   - Depends on built-in PostgreSQL 13+ `gen_random_uuid()`, Supabase `auth.users(id)` and `auth.uid()`, and `pgcrypto`.
   - Establishes enums (`drink_category`, `recipe_status`, `report_category`), 16 core tables, and `public.is_verified_admin()`.
2. **`002` (Constraints, Triggers, RLS Refinement, Core RPCs)**
   - Depends on all tables, enums, `trg_product_price_change`, and policies created in `001`.
   - Seeds `website_settings (id = 1)`, used by `is_verified_admin()` (`002`/`006`) and public RPC maintenance checks (`002`/`004`).
3. **`003` (Storage Buckets & `storage.objects` RLS)**
   - Depends on Supabase's managed `storage` schema (`storage.buckets`, `storage.objects`) and `public.is_verified_admin()` (`001`/`002`).
4. **`004` (Public Insert Removal & Slug/Photo Hardening)**
   - Depends on policies created in `001` & `002`, storage path contracts established in `003`, and RPC signatures from `002`.
5. **`005` (Server-Side OTP & Single-Owner Invariant)**
   - Depends on `public.admin_profiles`, `public.admin_otp_challenges`, `public.website_settings`, and `public.security_events` from `001`–`002`.
6. **`006` (Phase 3.6 Security Audit Hardening)**
   - Depends on `public.admin_auth_rate_limits` (`005`), `public.resolve_unique_recipe_slug` (`004`), `public.check_admin_auth_rate_limit` (`005`), `public.verify_admin_otp_challenge` (`005`), and `public.website_settings` (`001`–`002`).

> **Empty Catalog Expectation:** None of `001`–`006` insert demo `products` or `recipes`. After applying all six migrations, the database contains 18 `public` tables, 4 Storage buckets, and 1 `website_settings` row (`id = 1`), with `0` products and `0` recipes until populated by the owner via `/admin`.

---

## 3. Risks, Conflicts & Required Precautions

### 3.1 Non-Idempotent Policies in `001`
- **Risk:** Lines 309–415 of `001_711acks_schema.sql` contain 23 `CREATE POLICY` statements without `DROP POLICY IF EXISTS`.
- **Precaution:** Paste and execute the **entire** contents of `001_711acks_schema.sql` in one SQL Editor run on the completely fresh database. Do not execute `001` in fragmented line chunks or run it twice without cleaning up partial policies/tables first.

### 3.2 Supabase-Managed Schema Interactions
- **`storage.objects` Ownership (`003`):** `supabase_storage_admin` owns `storage.objects` on Supabase. `003` deliberately skips `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` to avoid `42501` ownership errors. Confirm in the Supabase Dashboard that **Storage** is already initialized (open Storage once in Dashboard if untouched) and verify `rowsecurity = true` on `storage.objects` after `003`.
- **`pgcrypto` Extension (`001`):** Supabase preinstalls `pgcrypto` in the `extensions` schema on fresh projects. `create extension if not exists "pgcrypto";` will emit a harmless notice and succeed; none of `001`–`006` depend on `public.digest()` or schema-qualified `pgcrypto` calls.
- **`supabase_migrations` vs Dashboard SQL Editor:** Applying migrations via the Dashboard SQL Editor does not populate `supabase_migrations.schema_migrations` automatically. Conversely, the files use 3-digit prefixes (`001_`–`006_`) rather than 14-digit CLI timestamps (`YYYYMMDDHHMMSS_`). Do **not** mix Dashboard SQL Editor runs with ad-hoc `supabase db push` later without repairing migration history.

### 3.3 Destructive Statements & Object Replacement Inventory
An exhaustive check across all 4,083 SQL lines found **zero data-destructive statements**:
- **`DROP TABLE` / `DROP COLUMN` / `DROP SCHEMA` / `DROP TYPE` / `TRUNCATE`:** **None (`0`)**.
- **Migration-Time `DELETE`:** **None (`0`)**.
- **Migration-Time `DROP TRIGGER` / `DROP POLICY` (Safe/Expected):**
  - `001` line 265: `drop trigger if exists trg_product_price_change on public.products;` (idempotent trigger recreation).
  - `002` lines 242–360 (17 statements): `drop policy if exists ...` (tightens policies to `to authenticated` with `with check`, and removes open `public.likes` `SELECT`/`INSERT` policies in favor of RPCs).
  - `003` lines 143–328 (16 statements): `drop policy if exists ... on storage.objects;` (idempotent storage policy setup).
  - `004` lines 48–58 (4 statements): `drop policy if exists ...` (intentionally removes the 4 direct public `INSERT` policies on `community_submissions`, `submission_ingredients`, `product_suggestions`, `contact_reports`).
- **Object Replacements (`CREATE OR REPLACE FUNCTION` / `ON CONFLICT DO UPDATE`):**
  - `002`, `004`, and `006` replace functions while preserving **exact input parameter lists and `RETURNS` table signatures**, preventing PostgreSQL `42P13` ("cannot change return type of existing function") errors.
  - `003` uses `INSERT INTO storage.buckets ... ON CONFLICT (id) DO UPDATE`, safely normalizing bucket visibility, MIME restrictions, and size caps.
- **Runtime `DELETE` Inside Function Bodies (Not Executed During Migration):**
  - `002` line 498 inside `toggle_recipe_like` (removes a row from `public.likes` when toggled off).
  - `002` line 929 and `004` line 509 inside `save_recipe_with_ingredients` (replaces ordered `recipe_ingredients` rows atomically on recipe update).

### 3.4 Post-`006` Auth Behavior Note
- `006` updates `public.is_verified_admin()` to require `ap.last_active_at IS NOT NULL`. When creating the single owner row in `public.admin_profiles` during a later provisioning step, both `otp_verified_until` and `last_active_at` **must remain `NULL`** so admin access is blocked until the owner completes real Step 1 Password + Step 2 Email OTP login (`verify_admin_otp_challenge` sets both timestamps).

---

## 4. Exact Recommended Execution Method

**Recommended Method:** **Supabase Dashboard SQL Editor — One Migration File per Execution (`001` → `006`)**

Why this is the safest method for this repository and project state:
1. Requires **zero** local Docker containers, database passwords in local shells, or renaming of `001_`–`006_` files to 14-digit CLI timestamps.
2. Runs directly as `postgres` inside the Supabase Dashboard for `711acks` (Singapore), matching the exact assumption documented in `003_storage_setup.sql`.
3. Allows running the read-only verification query immediately after each file before moving to the next.

*(Note: The Supabase CLI will still be used in a later, separate Phase 4B step for `supabase secrets set` and `supabase functions deploy` without touching `supabase/migrations`.)*

### Pre-Migration Checklist (Before Running `001`)
1. Confirm the active Supabase Dashboard project is **`711acks`** (Free tier, Southeast Asia / Singapore).
2. Open **Table Editor** (`public` schema) and confirm `0` tables exist.
3. Open **Storage** in the Dashboard once to verify the Storage service is initialized on the project.
4. Open **SQL Editor** -> New query tab.

### Execution Workflow
For each file in exact order (`001` → `002` → `003` → `004` → `005` → `006`):
1. Open the full `.sql` file from `supabase/migrations/` and copy its **entire** contents (do not split a file into partial runs).
2. Paste into a clean SQL Editor tab and click **Run**.
3. Confirm status `Success. No rows returned` (or harmless `notice` messages such as `extension "pgcrypto" already exists`).
4. Run the corresponding read-only verification query from Section 5 before proceeding to the next file.

### Required Manual Configuration After `006` (Subsequent Phase 4B Steps — Do Not Perform Yet)
1. **Edge Function Secrets & Deployment (`4B-3`):** Set `ADMIN_OTP_PEPPER`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS="false"`, and Gmail SMTP secrets via `supabase secrets set`, then deploy all 6 Edge Functions from repo root so `supabase/config.toml` applies.
2. **Auth & Single-Owner Provisioning (`4B-4`):** Configure Email provider, set **Site URL** and **`/admin*` Redirect URL**, create the single `auth.users` owner (`Auto Confirm = ON`), insert the matching `public.admin_profiles` row (`role = 'owner'`, `otp_verified_until = null`, `last_active_at = null`), and disable public signups.
3. **Frontend Deployment (`4B-5`):** Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel Hobby and deploy.

---

## 5. Read-Only Verification Queries (Run After Each Migration)

### After `001_711acks_schema.sql`
Expected: `3` enums, `16` tables in `public` all with `rowsecurity = true`, `23` policies on `public` tables, and `1` trigger (`trg_product_price_change`).

```sql
select
  (select count(*) from pg_type t
   join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype = 'e'
     and t.typname in ('drink_category', 'recipe_status', 'report_category')) as enum_count,
  (select count(*) from pg_tables
   where schemaname = 'public' and rowsecurity = true) as rls_table_count,
  (select count(*) from pg_policies
   where schemaname = 'public') as public_policy_count,
  (select count(*) from information_schema.triggers
   where trigger_schema = 'public' and trigger_name = 'trg_product_price_change') as trigger_count;
```

### After `002_phase2_database_foundation.sql`
Expected: `website_settings` row `id = 1` exists, `17` `public` tables with RLS enabled (including `like_rate_limits`), `public.likes` has **only** `"Only verified admin can manage likes"`, and all `11` functions (`is_verified_admin`, `handle_product_price_change`, plus `9` RPCs) exist with `prosecdef = true`.

```sql
select
  (select count(*) from public.website_settings where id = 1) as settings_singleton_count,
  (select count(*) from pg_tables
   where schemaname = 'public' and rowsecurity = true) as rls_table_count,
  (select array_agg(policyname order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'likes') as likes_policies,
  (select count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef = true
     and p.proname in (
       'is_verified_admin', 'handle_product_price_change',
       'get_liked_recipe_ids', 'toggle_recipe_like',
       'submit_community_hack', 'submit_contact_report',
       'touch_admin_activity', 'save_recipe_with_ingredients',
       'verify_recipe_catalog_prices', 'approve_community_submission',
       'restore_recipe_revision'
     )) as secdef_function_count;
```

### After `003_storage_setup.sql`
Expected: `4` buckets matching exact `public` flags, `storage.objects` has `rowsecurity = true`, and `16` policies exist on `storage.objects` for our 4 buckets.

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('pending-submissions', 'published-drinks', 'verified-products', 'private-admin-backups')
order by id;

select
  (select rowsecurity from pg_tables
   where schemaname = 'storage' and tablename = 'objects') as storage_objects_rls_enabled,
  (select count(*) from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (
       policyname like 'Pending submissions:%'
       or policyname like 'Published drinks:%'
       or policyname like 'Verified products:%'
       or policyname like 'Private admin backups:%'
     )) as storage_policy_count;
```

### After `004_phase2d_security_hardening.sql`
Expected: `0` residual public insert policies from `001`/`002` (`policy_count = 0`), `resolve_unique_recipe_slug` exists, and `save_recipe_with_ingredients` + `approve_community_submission` have only `1` overload each (`proargtypes` unchanged).

```sql
select count(*) as residual_direct_public_insert_policies
from pg_policies
where schemaname = 'public'
  and policyname in (
    'Public can insert pending community submissions',
    'Public can insert submission ingredients',
    'Public can insert product suggestions',
    'Public can submit contact reports'
  );

select p.proname, count(*) as overload_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'resolve_unique_recipe_slug',
    'submit_community_hack',
    'save_recipe_with_ingredients',
    'approve_community_submission'
  )
group by p.proname
order by p.proname;
```

### After `005_phase3_admin_otp_auth.sql`
Expected: `18` `public` tables with RLS enabled (including `admin_auth_rate_limits`), `uq_admin_profiles_single_owner` exists, `2` new columns (`challenge_token_hash`, `ip_hash`) on `admin_otp_challenges`, and `anon`/`authenticated` have **zero** `EXECUTE` grants on the 3 auth functions.

```sql
select
  (select count(*) from pg_tables
   where schemaname = 'public' and rowsecurity = true) as rls_table_count,
  (select count(*) from pg_indexes
   where schemaname = 'public' and indexname = 'uq_admin_profiles_single_owner') as single_owner_idx,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'admin_otp_challenges'
     and column_name in ('challenge_token_hash', 'ip_hash')) as otp_new_columns,
  (select count(*) from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name in (
       'check_admin_auth_rate_limit',
       'verify_admin_otp_challenge',
       'revoke_admin_otp_session'
     )
     and grantee in ('PUBLIC', 'anon', 'authenticated')) as unexpected_client_grants;
```

### After `006_phase36_security_hardening.sql` (Final Schema Verification)
Expected: All `6` new/hardened Phase 3.6 functions exist, `unexpected_client_grants = 0` on all 5 `service_role`-only functions (`constant_time_text_equal`, `check_admin_auth_rate_limit`, `record_admin_failed_login`, `rotate_admin_otp_challenge_for_resend`, `verify_admin_otp_challenge`), `resolve_unique_recipe_slug` granted to `authenticated` only (not `anon` or `PUBLIC`), and `pg_get_functiondef('public.is_verified_admin()'::regprocedure)` contains `ap.last_active_at is not null`.

```sql
select
  (select count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'constant_time_text_equal',
       'is_verified_admin',
       'resolve_unique_recipe_slug',
       'check_admin_auth_rate_limit',
       'record_admin_failed_login',
       'rotate_admin_otp_challenge_for_resend',
       'verify_admin_otp_challenge'
     )) as phase36_function_count,
  (select pg_get_functiondef('public.is_verified_admin()'::regprocedure) ilike '%last_active_at is not null%') as requires_non_null_activity,
  (select count(*) from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name in (
       'constant_time_text_equal',
       'check_admin_auth_rate_limit',
       'record_admin_failed_login',
       'rotate_admin_otp_challenge_for_resend',
       'verify_admin_otp_challenge'
     )
     and grantee in ('PUBLIC', 'anon', 'authenticated')) as unexpected_client_grants,
  (select array_agg(distinct grantee order by grantee)
   from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name = 'resolve_unique_recipe_slug'
     and privilege_type = 'EXECUTE') as slug_exec_grantees;
```

---

## 6. Rollback & Recovery Guidance

1. **If `001_711acks_schema.sql` fails mid-execution:**
   - Do **not** blindly re-run `001` as-is if any policies were already created (it will fail with `42710`).
   - Because the database is completely fresh with zero user data, either drop only the partially created `public` objects (`trg_product_price_change`, `public.*` tables/functions/enums created so far) or reset the fresh `public` schema cleanly before re-running `001` from line 1.
2. **If `002`, `003`, `004`, `005`, or `006` fails mid-execution:**
   - Fix the underlying environment condition (for example, initializing Storage before `003`), then re-run that exact migration file cleanly — `002` through `006` are all idempotent.
   - If `003` ever encounters a hosted `storage.objects` policy permission issue in a specific environment, verify Storage initialization first; policies can otherwise be created using the exact expressions from `003` inside Supabase Dashboard -> **Storage -> Policies**.
3. **If a previously deployed change needs reverting later (post-launch):**
   - **Never** re-run `001` or drop tables once live recipes/products/submissions exist. Instead, write a targeted additive rollback migration (using `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, etc.) to preserve all rows in `public.*` and files in `storage.*`.

---

## 7. Final Verdict

### **`READY TO APPLY`**

Migrations `001` through `006` are structurally sound, free of destructive schema/data DDL, compatible with Supabase Free Tier (`storage.objects` ownership, `pgcrypto`, `auth.users`), and ready for sequential execution via the Supabase Dashboard SQL Editor upon your approval.
