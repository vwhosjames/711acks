-- =============================================================================
-- 711ACKS — MIGRATION 003: SUPABASE STORAGE BUCKETS & RLS POLICIES
-- =============================================================================
-- MIGRATION ORDER (REQUIRED):
--   1. supabase/migrations/001_711acks_schema.sql
--   2. supabase/migrations/002_phase2_database_foundation.sql
--   3. supabase/migrations/003_storage_setup.sql
--
-- SAFETY GUARANTEES:
--   - Strictly additive and idempotent; preserves migrations 001 and 002 unchanged.
--   - Provisions all 4 separated Storage buckets with explicit visibility,
--     file-size limits, and allowed MIME-type restrictions.
--   - Enforces bucket-scoped RLS policies on storage.objects using
--     public.is_verified_admin() (defined in 001 and hardened in 002).
--   - Never grants unrestricted public bucket access or anonymous read/update/delete
--     on private buckets.
--
-- NOTE ON storage.objects RLS:
--   Supabase enables Row Level Security on storage.objects by default and owns
--   the storage.objects table under supabase_storage_admin. This migration
--   intentionally omits `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`
--   to avoid ownership errors (42501) when executed from the Supabase SQL Editor.
-- =============================================================================

-- =============================================================================
-- 1. PROVISION & CONFIGURE STORAGE BUCKETS (IDEMPOTENT UPSERT)
-- =============================================================================

-- 1A. pending-submissions (PRIVATE)
--     Temporary holding bucket for visitor-uploaded community drink photos and
--     suggested product photos prior to admin review.
--     - Private (public = false): never served via public URLs.
--     - Max 5 MB (5,242,880 bytes); JPEG, PNG, WebP only.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'pending-submissions',
  'pending-submissions',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 1B. published-drinks (PUBLIC READ, VERIFIED-ADMIN WRITE ONLY)
--     Approved finished drink photos displayed on Home, Explore, and Details pages.
--     - Public read (public = true); strictly admin-only insert/update/delete.
--     - Max 5 MB (5,242,880 bytes); JPEG, PNG, WebP only.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'published-drinks',
  'published-drinks',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 1C. verified-products (PUBLIC READ, VERIFIED-ADMIN WRITE ONLY)
--     Official 7-Eleven Philippines catalog product photos managed by Admin.
--     - Public read (public = true); strictly admin-only insert/update/delete.
--     - Max 5 MB (5,242,880 bytes); JPEG, PNG, WebP only.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'verified-products',
  'verified-products',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 1D. private-admin-backups (PRIVATE, VERIFIED-ADMIN ONLY)
--     Private JSON archive exports and backup packages.
--     - Private (public = false): zero anonymous or unverified access.
--     - Max 10 MB (10,485,760 bytes); application/json only.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'private-admin-backups',
  'private-admin-backups',
  false,
  10485760,
  array['application/json']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- =============================================================================
-- 2. STORAGE.OBJECTS RLS POLICIES — PENDING-SUBMISSIONS (PRIVATE)
-- =============================================================================
-- Upload path contract enforced by src/lib/supabaseStorage.ts:
--   buildPendingSubmissionStoragePath(kind, mimeType) produces:
--     ^(finished-drink|suggested-product)/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{32}\.(jpg|png|webp)$
--
-- Security boundaries:
--   - Anonymous/public visitors may ONLY INSERT new objects (upsert: false)
--     matching the strict random-token path pattern above.
--   - Bucket-level file_size_limit (5 MB) and allowed_mime_types (JPEG/PNG/WebP)
--     are enforced by Supabase Storage prior to row insertion.
--   - Anonymous/public visitors have NO SELECT, UPDATE, or DELETE permissions:
--     they cannot list, read, download, overwrite, or delete any pending file.
--   - Verified admins (public.is_verified_admin()) have SELECT (for short-lived
--     signed URL preview), UPDATE, and DELETE (for cleanup/moderation).

drop policy if exists "Pending submissions: public insert validated path" on storage.objects;
create policy "Pending submissions: public insert validated path"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'pending-submissions'
    and name ~ '^(finished-drink|suggested-product)/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{32}\.(jpg|png|webp)$'
    and position('..' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "Pending submissions: verified admin select" on storage.objects;
create policy "Pending submissions: verified admin select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pending-submissions'
    and public.is_verified_admin()
  );

drop policy if exists "Pending submissions: verified admin update" on storage.objects;
create policy "Pending submissions: verified admin update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'pending-submissions'
    and public.is_verified_admin()
  )
  with check (
    bucket_id = 'pending-submissions'
    and public.is_verified_admin()
    and name ~ '^(finished-drink|suggested-product)/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{32}\.(jpg|png|webp)$'
    and position('..' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "Pending submissions: verified admin delete" on storage.objects;
create policy "Pending submissions: verified admin delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pending-submissions'
    and public.is_verified_admin()
  );

-- =============================================================================
-- 3. STORAGE.OBJECTS RLS POLICIES — PUBLISHED-DRINKS (PUBLIC READ, ADMIN WRITE)
-- =============================================================================

drop policy if exists "Published drinks: public select" on storage.objects;
create policy "Published drinks: public select"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'published-drinks'
  );

drop policy if exists "Published drinks: verified admin insert" on storage.objects;
create policy "Published drinks: verified admin insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'published-drinks'
    and public.is_verified_admin()
    and name ~ '^[a-z0-9][a-z0-9/_-]*\.(jpg|jpeg|png|webp)$'
    and position('..' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "Published drinks: verified admin update" on storage.objects;
create policy "Published drinks: verified admin update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'published-drinks'
    and public.is_verified_admin()
  )
  with check (
    bucket_id = 'published-drinks'
    and public.is_verified_admin()
    and name ~ '^[a-z0-9][a-z0-9/_-]*\.(jpg|jpeg|png|webp)$'
    and position('..' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "Published drinks: verified admin delete" on storage.objects;
create policy "Published drinks: verified admin delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'published-drinks'
    and public.is_verified_admin()
  );

-- =============================================================================
-- 4. STORAGE.OBJECTS RLS POLICIES — VERIFIED-PRODUCTS (PUBLIC READ, ADMIN WRITE)
-- =============================================================================

drop policy if exists "Verified products: public select" on storage.objects;
create policy "Verified products: public select"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'verified-products'
  );

drop policy if exists "Verified products: verified admin insert" on storage.objects;
create policy "Verified products: verified admin insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'verified-products'
    and public.is_verified_admin()
    and name ~ '^[a-z0-9][a-z0-9/_-]*\.(jpg|jpeg|png|webp)$'
    and position('..' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "Verified products: verified admin update" on storage.objects;
create policy "Verified products: verified admin update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'verified-products'
    and public.is_verified_admin()
  )
  with check (
    bucket_id = 'verified-products'
    and public.is_verified_admin()
    and name ~ '^[a-z0-9][a-z0-9/_-]*\.(jpg|jpeg|png|webp)$'
    and position('..' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "Verified products: verified admin delete" on storage.objects;
create policy "Verified products: verified admin delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'verified-products'
    and public.is_verified_admin()
  );

-- =============================================================================
-- 5. STORAGE.OBJECTS RLS POLICIES — PRIVATE-ADMIN-BACKUPS (ADMIN ONLY)
-- =============================================================================
-- Zero anonymous or unverified-authenticated permissions.

drop policy if exists "Private admin backups: verified admin select" on storage.objects;
create policy "Private admin backups: verified admin select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'private-admin-backups'
    and public.is_verified_admin()
  );

drop policy if exists "Private admin backups: verified admin insert" on storage.objects;
create policy "Private admin backups: verified admin insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'private-admin-backups'
    and public.is_verified_admin()
    and name ~ '^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.json$'
    and position('..' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "Private admin backups: verified admin update" on storage.objects;
create policy "Private admin backups: verified admin update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'private-admin-backups'
    and public.is_verified_admin()
  )
  with check (
    bucket_id = 'private-admin-backups'
    and public.is_verified_admin()
    and name ~ '^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.json$'
    and position('..' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "Private admin backups: verified admin delete" on storage.objects;
create policy "Private admin backups: verified admin delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'private-admin-backups'
    and public.is_verified_admin()
  );
