-- =============================================================================
-- 711ACKS — MIGRATION 002: PHASE 2 DATABASE FOUNDATION
-- =============================================================================
-- MIGRATION ORDER (REQUIRED):
--   1. supabase/migrations/001_711acks_schema.sql
--   2. supabase/migrations/002_phase2_database_foundation.sql
--
-- SAFETY GUARANTEES:
--   - Strictly additive and idempotent; preserves migration 001 unchanged.
--   - No destructive DDL (no DROP TABLE, DROP COLUMN, or TRUNCATE).
--   - Does not weaken any RLS policy.
--   - Every SECURITY DEFINER function pins `search_path = public, pg_temp`,
--     validates inputs, and restricts EXECUTE grants explicitly.
-- =============================================================================

-- =============================================================================
-- 1. WEBSITE SETTINGS SINGLETON INITIALIZATION
-- =============================================================================
insert into public.website_settings (id)
values (1)
on conflict (id) do nothing;

-- =============================================================================
-- 2. DATA INTEGRITY CONSTRAINTS (ADDITIVE, IDEMPOTENT)
-- =============================================================================

-- Published recipes MUST have verified pricing and a non-negative purchase cost
do $$ begin
  alter table public.recipes
    add constraint chk_recipes_published_requires_verified_price
    check (
      status <> 'Published'
      or (
        price_verified = true
        and total_purchase_cost is not null
        and total_purchase_cost >= 0
      )
    );
exception when duplicate_object then null; end $$;

-- Enforce non-empty trimmed product name/photo and optional 8-14 digit EAN/UPC barcode
do $$ begin
  alter table public.products
    add constraint chk_products_name_nonempty
    check (char_length(trim(name)) >= 1);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.products
    add constraint chk_products_photo_nonempty
    check (char_length(trim(photo_url)) >= 1);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.products
    add constraint chk_products_barcode_format
    check (barcode is null or barcode ~ '^[0-9]{8,14}$');
exception when duplicate_object then null; end $$;

-- Enforce meaningful drink names on community submissions
do $$ begin
  alter table public.community_submissions
    add constraint chk_community_submissions_drink_name_len
    check (char_length(trim(drink_name)) >= 3);
exception when duplicate_object then null; end $$;

-- Enforce unique sequential version numbers per recipe
do $$ begin
  alter table public.recipe_revisions
    add constraint uq_recipe_revisions_recipe_version
    unique (recipe_id, version_number);
exception when duplicate_object then null; end $$;

-- Enforce sane browser identifier format on likes
do $$ begin
  alter table public.likes
    add constraint chk_likes_anonymous_browser_id_format
    check (
      char_length(anonymous_browser_id) between 12 and 128
      and anonymous_browser_id ~ '^[A-Za-z0-9_-]+$'
    );
exception when duplicate_object then null; end $$;

-- Enforce reasonable admin inactivity timeout range (5 to 240 minutes)
do $$ begin
  alter table public.website_settings
    add constraint chk_website_settings_session_timeout_range
    check (session_timeout_minutes between 5 and 240);
exception when duplicate_object then null; end $$;

-- =============================================================================
-- 3. MISSING PERFORMANCE & QUERY INDEXES
-- =============================================================================
create index if not exists idx_products_archived_name
  on public.products (is_archived, name);

create index if not exists idx_product_price_history_product_changed
  on public.product_price_history (product_id, changed_at desc);

create index if not exists idx_recipes_published_at
  on public.recipes (published_at desc)
  where status = 'Published';

create index if not exists idx_recipes_likes_count
  on public.recipes (likes_count desc)
  where status = 'Published';

create index if not exists idx_recipes_needs_price_review
  on public.recipes (needs_price_review)
  where needs_price_review = true;

create index if not exists idx_recipe_ingredients_recipe_sort
  on public.recipe_ingredients (recipe_id, sort_order);

create index if not exists idx_recipe_price_snapshots_recipe_verified
  on public.recipe_price_snapshots (recipe_id, verified_at desc);

create index if not exists idx_community_submissions_status_submitted
  on public.community_submissions (status, submitted_at desc);

create index if not exists idx_submission_ingredients_submission
  on public.submission_ingredients (submission_id);

create index if not exists idx_product_suggestions_submission_status
  on public.product_suggestions (submission_id, status);

create index if not exists idx_recipe_revisions_recipe_version
  on public.recipe_revisions (recipe_id, version_number desc);

create index if not exists idx_likes_browser_created
  on public.likes (anonymous_browser_id, created_at desc);

create index if not exists idx_contact_reports_status_created
  on public.contact_reports (status, created_at desc);

create index if not exists idx_security_events_created
  on public.security_events (created_at desc);

create index if not exists idx_backup_records_created
  on public.backup_records (created_at desc);

create index if not exists idx_admin_otp_challenges_admin_active
  on public.admin_otp_challenges (admin_id, expires_at desc)
  where used = false;

-- =============================================================================
-- 4. SERVER-SIDE RATE-LIMIT TRACKING TABLE FOR ANONYMOUS LIKES
-- =============================================================================
-- NOTE ON ANONYMOUS LIKE LIMITATIONS:
--   Browser identifiers prevent casual duplicate likes from the same browser
--   and allow database-level rate limiting per browser ID, but browser IDs can
--   be cleared, rotated, or spoofed. This does NOT guarantee strict one-like-
--   per-real-person protection. Stronger IP/bot throttling requires an Edge
--   Function, CDN/WAF rule, or authenticated voter accounts.
create table if not exists public.like_rate_limits (
  anonymous_browser_id text primary key,
  last_action_at timestamptz not null default now(),
  window_started_at timestamptz not null default now(),
  window_action_count int not null default 1 check (window_action_count >= 1)
);

alter table public.like_rate_limits enable row level security;
-- Intentionally NO public policies on like_rate_limits; accessed only inside
-- hardened SECURITY DEFINER RPCs.

-- =============================================================================
-- 5. HARDEN EXISTING SECURITY DEFINER FUNCTIONS (FIXED search_path)
-- =============================================================================

-- Verify authenticated admin with active OTP second factor and inactivity check
create or replace function public.is_verified_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_profiles ap
    left join public.website_settings ws on ws.id = 1
    where ap.id = auth.uid()
      and ap.role = 'owner'
      and (ap.locked_until is null or ap.locked_until <= now())
      and ap.otp_verified_until is not null
      and ap.otp_verified_until > now()
      and (
        ap.last_active_at is null
        or ap.last_active_at > now() - make_interval(mins => coalesce(ws.session_timeout_minutes, 30))
      )
  );
$$;

-- Trigger: record price history (including changed_by when admin profile exists)
-- and flag affected recipes for price review WITHOUT altering historical totals
create or replace function public.handle_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed_by uuid;
begin
  if new.purchase_price is distinct from old.purchase_price then
    select ap.id
    into v_changed_by
    from public.admin_profiles ap
    where ap.id = auth.uid();

    insert into public.product_price_history (
      product_id,
      previous_price,
      new_price,
      changed_by
    )
    values (
      new.id,
      old.purchase_price,
      new.purchase_price,
      v_changed_by
    );

    update public.recipes
    set needs_price_review = true,
        updated_at = now()
    where id in (
      select distinct recipe_id
      from public.recipe_ingredients
      where product_id = new.id
    );
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 6. HARDENED & MISSING RLS POLICIES
-- =============================================================================

-- admin_profiles: authenticated owner can read ONLY their own row; no direct client writes
drop policy if exists "Admin can read own profile" on public.admin_profiles;
create policy "Admin can read own profile"
  on public.admin_profiles for select
  to authenticated
  using (id = auth.uid());

-- admin_otp_challenges: remains strictly inaccessible to anon/authenticated clients (server-side only)

-- submission_ingredients: tighten public insert to Pending parent submissions only,
-- and grant verified admin full management access
drop policy if exists "Public can insert submission ingredients" on public.submission_ingredients;
create policy "Public can insert submission ingredients"
  on public.submission_ingredients for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.community_submissions cs
      where cs.id = submission_ingredients.submission_id
        and cs.status = 'Pending'
    )
  );

drop policy if exists "Only verified admin can read submission ingredients" on public.submission_ingredients;
drop policy if exists "Only verified admin can manage submission ingredients" on public.submission_ingredients;
create policy "Only verified admin can manage submission ingredients"
  on public.submission_ingredients for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

-- product_suggestions: tighten public insert & explicit admin WITH CHECK
drop policy if exists "Public can insert product suggestions" on public.product_suggestions;
create policy "Public can insert product suggestions"
  on public.product_suggestions for insert
  to anon, authenticated
  with check (
    status = 'Pending'
    and (
      submission_id is null
      or exists (
        select 1
        from public.community_submissions cs
        where cs.id = product_suggestions.submission_id
          and cs.status = 'Pending'
      )
    )
  );

drop policy if exists "Only verified admin can manage product suggestions" on public.product_suggestions;
create policy "Only verified admin can manage product suggestions"
  on public.product_suggestions for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

-- likes: protect visitor anonymous_browser_id privacy and force public mutations
-- through the rate-limited toggle_recipe_like RPC
drop policy if exists "Public can read likes" on public.likes;
drop policy if exists "Public can insert anonymous likes" on public.likes;
drop policy if exists "Only verified admin can manage likes" on public.likes;
create policy "Only verified admin can manage likes"
  on public.likes for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

-- contact_reports: ensure explicit WITH CHECK for admin
drop policy if exists "Only verified admin can read and manage contact reports" on public.contact_reports;
create policy "Only verified admin can read and manage contact reports"
  on public.contact_reports for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

-- website_settings: add missing admin INSERT policy for singleton row and explicit WITH CHECK
drop policy if exists "Only verified admin can update website settings" on public.website_settings;
create policy "Only verified admin can update website settings"
  on public.website_settings for update
  to authenticated
  using (public.is_verified_admin())
  with check (id = 1 and public.is_verified_admin());

drop policy if exists "Only verified admin can insert website settings" on public.website_settings;
create policy "Only verified admin can insert website settings"
  on public.website_settings for insert
  to authenticated
  with check (id = 1 and public.is_verified_admin());

-- Admin-only tables: enforce explicit WITH CHECK alongside USING
drop policy if exists "Admin only recipe revisions" on public.recipe_revisions;
create policy "Admin only recipe revisions"
  on public.recipe_revisions for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

drop policy if exists "Admin only price history" on public.product_price_history;
create policy "Admin only price history"
  on public.product_price_history for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

drop policy if exists "Admin only price snapshots" on public.recipe_price_snapshots;
create policy "Admin only price snapshots"
  on public.recipe_price_snapshots for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

drop policy if exists "Admin only security events" on public.security_events;
create policy "Admin only security events"
  on public.security_events for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

drop policy if exists "Admin only backup records" on public.backup_records;
create policy "Admin only backup records"
  on public.backup_records for all
  to authenticated
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

-- =============================================================================
-- 7. PUBLIC CONTROLLED SECURITY DEFINER RPCs
-- =============================================================================

-- 7A. Fetch only the caller's own liked recipe IDs without exposing other visitors' IDs
create or replace function public.get_liked_recipe_ids(
  p_anonymous_browser_id text
)
returns table(recipe_id uuid)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if p_anonymous_browser_id is null
     or char_length(p_anonymous_browser_id) not between 12 and 128
     or p_anonymous_browser_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'INVALID_BROWSER_ID: Anonymous browser identifier format is invalid.';
  end if;

  return query
    select l.recipe_id
    from public.likes l
    inner join public.recipes r on r.id = l.recipe_id
    where l.anonymous_browser_id = p_anonymous_browser_id
      and r.status = 'Published';
end;
$$;

-- 7B. Atomically toggle an anonymous like with server-side validation and rate limiting
-- Rate limits enforced per anonymous_browser_id:
--   - Minimum 1 second cooldown between consecutive like actions
--   - Maximum 25 like actions per 10-minute rolling window
-- Limitation: Browser IDs can still be cleared or spoofed by determined actors.
create or replace function public.toggle_recipe_like(
  p_recipe_id uuid,
  p_anonymous_browser_id text
)
returns table(liked boolean, likes_count int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_maintenance boolean := false;
  v_rate_row public.like_rate_limits%rowtype;
  v_recipe_exists boolean := false;
  v_already_liked boolean := false;
  v_new_count int := 0;
begin
  if p_recipe_id is null then
    raise exception 'INVALID_RECIPE_ID: Recipe ID is required.';
  end if;

  if p_anonymous_browser_id is null
     or char_length(p_anonymous_browser_id) not between 12 and 128
     or p_anonymous_browser_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'INVALID_BROWSER_ID: Anonymous browser identifier format is invalid.';
  end if;

  select coalesce(ws.maintenance_mode, false)
  into v_maintenance
  from public.website_settings ws
  where ws.id = 1;

  if v_maintenance and not public.is_verified_admin() then
    raise exception 'MAINTENANCE_MODE: Public interactions are temporarily paused.';
  end if;

  -- Lock and verify target recipe is Published
  select true
  into v_recipe_exists
  from public.recipes r
  where r.id = p_recipe_id
    and r.status = 'Published'
  for update;

  if not coalesce(v_recipe_exists, false) then
    raise exception 'RECIPE_NOT_FOUND: Published recipe not found.';
  end if;

  -- Enforce per-browser-ID server-side rate limiting
  select *
  into v_rate_row
  from public.like_rate_limits rl
  where rl.anonymous_browser_id = p_anonymous_browser_id
  for update;

  if found then
    if v_now - v_rate_row.last_action_at < interval '1 second' then
      raise exception 'RATE_LIMIT_EXCEEDED: Please wait a moment before toggling likes again.';
    end if;

    if v_now - v_rate_row.window_started_at < interval '10 minutes' then
      if v_rate_row.window_action_count >= 25 then
        raise exception 'RATE_LIMIT_EXCEEDED: Like rate limit reached. Please try again later.';
      end if;

      update public.like_rate_limits
      set last_action_at = v_now,
          window_action_count = window_action_count + 1
      where anonymous_browser_id = p_anonymous_browser_id;
    else
      update public.like_rate_limits
      set last_action_at = v_now,
          window_started_at = v_now,
          window_action_count = 1
      where anonymous_browser_id = p_anonymous_browser_id;
    end if;
  else
    insert into public.like_rate_limits (
      anonymous_browser_id,
      last_action_at,
      window_started_at,
      window_action_count
    )
    values (p_anonymous_browser_id, v_now, v_now, 1);
  end if;

  -- Toggle like row atomically
  select exists (
    select 1
    from public.likes l
    where l.recipe_id = p_recipe_id
      and l.anonymous_browser_id = p_anonymous_browser_id
  )
  into v_already_liked;

  if v_already_liked then
    delete from public.likes
    where recipe_id = p_recipe_id
      and anonymous_browser_id = p_anonymous_browser_id;
  else
    insert into public.likes (recipe_id, anonymous_browser_id)
    values (p_recipe_id, p_anonymous_browser_id)
    on conflict (recipe_id, anonymous_browser_id) do nothing;
  end if;

  select count(*)::int
  into v_new_count
  from public.likes
  where recipe_id = p_recipe_id;

  update public.recipes
  set likes_count = v_new_count
  where id = p_recipe_id;

  return query select (not v_already_liked) as liked, v_new_count as likes_count;
end;
$$;

-- 7C. Atomically submit a community drink hack (strictly Pending, never auto-published)
create or replace function public.submit_community_hack(
  p_drink_name text,
  p_category public.drink_category,
  p_submitter_name text default null,
  p_taste_notes text default null,
  p_finished_photo_storage_path text default null,
  p_duplicate_warning_notes text default null,
  p_ingredients jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_maintenance boolean := false;
  v_submission_id uuid;
  v_clean_name text := trim(coalesce(p_drink_name, ''));
  v_clean_submitter text := coalesce(nullif(trim(coalesce(p_submitter_name, '')), ''), 'Anonymous Creator');
  v_ing jsonb;
  v_product_id uuid;
  v_suggested_name text;
  v_suggested_price numeric(10, 2);
  v_suggested_photo text;
  v_quantity_used text;
  v_units int;
  v_product_exists boolean;
begin
  select coalesce(ws.maintenance_mode, false)
  into v_maintenance
  from public.website_settings ws
  where ws.id = 1;

  if v_maintenance and not public.is_verified_admin() then
    raise exception 'MAINTENANCE_MODE: Community submissions are temporarily paused.';
  end if;

  if char_length(v_clean_name) < 3 or char_length(v_clean_name) > 160 then
    raise exception 'INVALID_DRINK_NAME: Drink name must be between 3 and 160 characters.';
  end if;

  if p_ingredients is null
     or jsonb_typeof(p_ingredients) <> 'array'
     or jsonb_array_length(p_ingredients) < 1
     or jsonb_array_length(p_ingredients) > 25 then
    raise exception 'INVALID_INGREDIENTS: Provide between 1 and 25 ingredients.';
  end if;

  insert into public.community_submissions (
    drink_name,
    category,
    submitter_name,
    taste_notes,
    finished_photo_storage_path,
    status,
    duplicate_warning_notes
  )
  values (
    v_clean_name,
    p_category,
    left(v_clean_submitter, 100),
    nullif(trim(coalesce(p_taste_notes, '')), ''),
    nullif(trim(coalesce(p_finished_photo_storage_path, '')), ''),
    'Pending',
    nullif(trim(coalesce(p_duplicate_warning_notes, '')), '')
  )
  returning id into v_submission_id;

  for v_ing in select * from jsonb_array_elements(p_ingredients)
  loop
    v_product_id := nullif(trim(coalesce(v_ing->>'product_id', '')), '')::uuid;
    v_suggested_name := nullif(trim(coalesce(v_ing->>'suggested_product_name', '')), '');
    v_suggested_photo := nullif(trim(coalesce(v_ing->>'suggested_product_photo_path', '')), '');
    v_quantity_used := trim(coalesce(v_ing->>'quantity_used', ''));
    v_units := coalesce((v_ing->>'units_to_purchase')::int, 1);

    if v_ing ? 'suggested_product_price'
       and jsonb_typeof(v_ing->'suggested_product_price') <> 'null'
       and trim(coalesce(v_ing->>'suggested_product_price', '')) <> '' then
      v_suggested_price := (v_ing->>'suggested_product_price')::numeric(10, 2);
      if v_suggested_price < 0 then
        raise exception 'INVALID_SUGGESTED_PRICE: Suggested product price cannot be negative.';
      end if;
    else
      v_suggested_price := null;
    end if;

    if char_length(v_quantity_used) < 1 or char_length(v_quantity_used) > 120 then
      raise exception 'INVALID_QUANTITY: Each ingredient must specify a valid quantity used.';
    end if;

    if v_units < 1 or v_units > 99 then
      raise exception 'INVALID_UNITS: Units to purchase must be between 1 and 99.';
    end if;

    if v_product_id is not null then
      select exists (
        select 1 from public.products p
        where p.id = v_product_id
          and p.is_archived = false
      ) into v_product_exists;

      if not v_product_exists then
        raise exception 'INVALID_PRODUCT: Referenced catalog product is unavailable.';
      end if;
    elsif v_suggested_name is null or char_length(v_suggested_name) < 2 then
      raise exception 'INVALID_INGREDIENT: Each ingredient requires either a catalog product or a suggested product name.';
    end if;

    insert into public.submission_ingredients (
      submission_id,
      product_id,
      suggested_product_name,
      suggested_product_price,
      suggested_product_photo_path,
      quantity_used,
      units_to_purchase
    )
    values (
      v_submission_id,
      v_product_id,
      v_suggested_name,
      v_suggested_price,
      v_suggested_photo,
      v_quantity_used,
      v_units
    );

    -- Queue new product suggestion for admin review without modifying public.products
    if v_product_id is null and v_suggested_name is not null then
      insert into public.product_suggestions (
        submission_id,
        suggested_name,
        suggested_price,
        photo_storage_path,
        status
      )
      values (
        v_submission_id,
        left(v_suggested_name, 160),
        v_suggested_price,
        v_suggested_photo,
        'Pending'
      );
    end if;
  end loop;

  return v_submission_id;
end;
$$;

-- 7D. Atomically submit a visitor contact report (strictly Open)
create or replace function public.submit_contact_report(
  p_category public.report_category,
  p_message text,
  p_reporter_name text default null,
  p_reporter_email text default null,
  p_related_recipe_slug text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report_id uuid;
  v_clean_message text := trim(coalesce(p_message, ''));
  v_clean_email text := nullif(trim(coalesce(p_reporter_email, '')), '');
begin
  if char_length(v_clean_message) < 10 or char_length(v_clean_message) > 4000 then
    raise exception 'INVALID_MESSAGE: Message must be between 10 and 4000 characters.';
  end if;

  if v_clean_email is not null and v_clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_EMAIL: Please provide a valid email address or leave it blank.';
  end if;

  insert into public.contact_reports (
    reporter_name,
    reporter_email,
    category,
    message,
    related_recipe_slug,
    status
  )
  values (
    nullif(left(trim(coalesce(p_reporter_name, '')), 120), ''),
    v_clean_email,
    p_category,
    v_clean_message,
    nullif(left(trim(coalesce(p_related_recipe_slug, '')), 160), ''),
    'Open'
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;

-- =============================================================================
-- 8. VERIFIED-ADMIN TRANSACTIONAL RPCs (STRICT is_verified_admin() ENFORCEMENT)
-- =============================================================================

-- 8A. Refresh admin inactivity timestamp
create or replace function public.touch_admin_activity()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
begin
  if not public.is_verified_admin() then
    raise exception 'UNAUTHORIZED: Verified admin session required.';
  end if;

  update public.admin_profiles
  set last_active_at = v_now
  where id = auth.uid();

  return v_now;
end;
$$;

-- 8B. Create or update a recipe, its ingredients, verified price snapshot, and revision atomically
create or replace function public.save_recipe_with_ingredients(
  p_recipe_id uuid,
  p_slug text,
  p_name text,
  p_category public.drink_category,
  p_status public.recipe_status,
  p_photo_url text,
  p_submitter_name text,
  p_taste_notes text,
  p_is_editors_pick boolean,
  p_is_trending boolean,
  p_ingredients jsonb,
  p_change_summary text default null,
  p_actor_email text default null
)
returns table(
  recipe_id uuid,
  slug text,
  total_purchase_cost numeric(10, 2),
  price_verified boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_clean_name text := trim(coalesce(p_name, ''));
  v_clean_slug text := trim(coalesce(p_slug, ''));
  v_clean_photo text := trim(coalesce(p_photo_url, ''));
  v_actor text := coalesce(nullif(trim(coalesce(p_actor_email, '')), ''), 'Admin');
  v_existing public.recipes%rowtype;
  v_existing_ingredients jsonb := '[]'::jsonb;
  v_recipe_id uuid;
  v_all_verified boolean := true;
  v_total numeric(10, 2) := 0;
  v_snapshot_breakdown jsonb := '[]'::jsonb;
  v_ing jsonb;
  v_idx int := 0;
  v_ing_product_id uuid;
  v_ing_name text;
  v_ing_photo text;
  v_ing_qty text;
  v_ing_units int;
  v_ing_price numeric(10, 2);
  v_ing_verified boolean;
  v_next_version int;
  v_changed_fields text[] := array[]::text[];
  v_prev_values jsonb := '{}'::jsonb;
  v_new_values jsonb := '{}'::jsonb;
begin
  if not public.is_verified_admin() then
    raise exception 'UNAUTHORIZED: Verified admin session required.';
  end if;

  if char_length(v_clean_name) < 2 or char_length(v_clean_name) > 160 then
    raise exception 'INVALID_NAME: Recipe name must be between 2 and 160 characters.';
  end if;

  if char_length(v_clean_slug) < 2 or v_clean_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'INVALID_SLUG: Recipe slug must be lowercase alphanumeric with hyphens.';
  end if;

  if char_length(v_clean_photo) < 1 then
    raise exception 'INVALID_PHOTO: Recipe photo URL is required.';
  end if;

  if p_ingredients is null
     or jsonb_typeof(p_ingredients) <> 'array'
     or jsonb_array_length(p_ingredients) < 1 then
    raise exception 'INVALID_INGREDIENTS: At least one ingredient is required.';
  end if;

  -- Compute full product purchase cost server-side (whole units * unit price snapshot)
  for v_ing in select * from jsonb_array_elements(p_ingredients)
  loop
    v_ing_name := trim(coalesce(v_ing->>'product_name_snapshot', ''));
    v_ing_qty := trim(coalesce(v_ing->>'quantity_used', ''));
    v_ing_units := greatest(1, coalesce((v_ing->>'units_to_purchase')::int, 1));
    v_ing_verified := coalesce((v_ing->>'price_verified')::boolean, false);

    if v_ing ? 'price_snapshot'
       and jsonb_typeof(v_ing->'price_snapshot') <> 'null'
       and trim(coalesce(v_ing->>'price_snapshot', '')) <> '' then
      v_ing_price := (v_ing->>'price_snapshot')::numeric(10, 2);
    else
      v_ing_price := null;
    end if;

    if char_length(v_ing_name) < 1 or char_length(v_ing_qty) < 1 then
      raise exception 'INVALID_INGREDIENT: Ingredient name and quantity are required.';
    end if;

    if v_ing_verified and v_ing_price is not null and v_ing_price >= 0 then
      v_total := round(v_total + (v_ing_price * v_ing_units), 2);
      v_snapshot_breakdown := v_snapshot_breakdown || jsonb_build_array(
        jsonb_build_object(
          'productId', nullif(trim(coalesce(v_ing->>'product_id', '')), ''),
          'productNameSnapshot', v_ing_name,
          'quantityUsed', v_ing_qty,
          'unitsToPurchase', v_ing_units,
          'priceSnapshot', v_ing_price,
          'lineTotal', round(v_ing_price * v_ing_units, 2)
        )
      );
    else
      v_all_verified := false;
    end if;
  end loop;

  if not v_all_verified then
    v_total := null;
  end if;

  if p_status = 'Published' and not v_all_verified then
    raise exception 'UNVERIFIED_PRICES: Cannot publish recipe with missing or unverified ingredient prices.';
  end if;

  if p_recipe_id is not null then
    select *
    into v_existing
    from public.recipes
    where id = p_recipe_id
    for update;

    if not found then
      raise exception 'RECIPE_NOT_FOUND: Target recipe does not exist.';
    end if;

    select coalesce(jsonb_agg(to_jsonb(ri) order by ri.sort_order), '[]'::jsonb)
    into v_existing_ingredients
    from public.recipe_ingredients ri
    where ri.recipe_id = v_existing.id;

    if v_existing.name is distinct from v_clean_name then
      v_changed_fields := array_append(v_changed_fields, 'name');
      v_prev_values := v_prev_values || jsonb_build_object('name', v_existing.name);
      v_new_values := v_new_values || jsonb_build_object('name', v_clean_name);
    end if;
    if v_existing.category is distinct from p_category then
      v_changed_fields := array_append(v_changed_fields, 'category');
      v_prev_values := v_prev_values || jsonb_build_object('category', v_existing.category);
      v_new_values := v_new_values || jsonb_build_object('category', p_category);
    end if;
    if v_existing.status is distinct from p_status then
      v_changed_fields := array_append(v_changed_fields, 'status');
      v_prev_values := v_prev_values || jsonb_build_object('status', v_existing.status);
      v_new_values := v_new_values || jsonb_build_object('status', p_status);
    end if;
    if v_existing.total_purchase_cost is distinct from v_total then
      v_changed_fields := array_append(v_changed_fields, 'totalPurchaseCost');
      v_prev_values := v_prev_values || jsonb_build_object('totalPurchaseCost', v_existing.total_purchase_cost);
      v_new_values := v_new_values || jsonb_build_object('totalPurchaseCost', v_total);
    end if;

    v_changed_fields := array_append(v_changed_fields, 'ingredients');
    v_prev_values := v_prev_values || jsonb_build_object('ingredients', v_existing_ingredients);
    v_new_values := v_new_values || jsonb_build_object('ingredients', p_ingredients);

    update public.recipes
    set slug = v_clean_slug,
        name = v_clean_name,
        category = p_category,
        status = p_status,
        photo_url = v_clean_photo,
        submitter_name = coalesce(nullif(trim(coalesce(p_submitter_name, '')), ''), v_existing.submitter_name),
        taste_notes = nullif(trim(coalesce(p_taste_notes, '')), ''),
        total_purchase_cost = v_total,
        price_verified = v_all_verified,
        needs_price_review = false,
        last_price_verified_at = case when v_all_verified then v_now else last_price_verified_at end,
        is_editors_pick = coalesce(p_is_editors_pick, false),
        is_trending = coalesce(p_is_trending, false),
        pending_draft_json = null,
        published_at = case
          when p_status = 'Published' and published_at is null then v_now
          else published_at
        end,
        updated_at = v_now
    where id = v_existing.id
    returning id into v_recipe_id;

    delete from public.recipe_ingredients where recipe_id = v_recipe_id;
  else
    insert into public.recipes (
      slug,
      name,
      category,
      status,
      photo_url,
      submitter_name,
      taste_notes,
      total_purchase_cost,
      price_verified,
      needs_price_review,
      last_price_verified_at,
      is_editors_pick,
      is_trending,
      published_at,
      created_at,
      updated_at
    )
    values (
      v_clean_slug,
      v_clean_name,
      p_category,
      p_status,
      v_clean_photo,
      coalesce(nullif(trim(coalesce(p_submitter_name, '')), ''), 'Admin'),
      nullif(trim(coalesce(p_taste_notes, '')), ''),
      v_total,
      v_all_verified,
      false,
      case when v_all_verified then v_now else null end,
      coalesce(p_is_editors_pick, false),
      coalesce(p_is_trending, false),
      case when p_status = 'Published' then v_now else null end,
      v_now,
      v_now
    )
    returning id into v_recipe_id;

    v_changed_fields := array['created', 'status', 'totalPurchaseCost'];
    v_prev_values := '{}'::jsonb;
    v_new_values := jsonb_build_object(
      'name', v_clean_name,
      'category', p_category,
      'status', p_status,
      'totalPurchaseCost', v_total,
      'ingredients', p_ingredients
    );
  end if;

  -- Insert ordered ingredients
  v_idx := 0;
  for v_ing in select * from jsonb_array_elements(p_ingredients)
  loop
    v_ing_product_id := nullif(trim(coalesce(v_ing->>'product_id', '')), '')::uuid;
    v_ing_name := trim(coalesce(v_ing->>'product_name_snapshot', ''));
    v_ing_photo := trim(coalesce(v_ing->>'product_photo_snapshot', ''));
    v_ing_qty := trim(coalesce(v_ing->>'quantity_used', ''));
    v_ing_units := greatest(1, coalesce((v_ing->>'units_to_purchase')::int, 1));
    v_ing_verified := coalesce((v_ing->>'price_verified')::boolean, false);

    if v_ing ? 'price_snapshot'
       and jsonb_typeof(v_ing->'price_snapshot') <> 'null'
       and trim(coalesce(v_ing->>'price_snapshot', '')) <> '' then
      v_ing_price := (v_ing->>'price_snapshot')::numeric(10, 2);
    else
      v_ing_price := null;
    end if;

    insert into public.recipe_ingredients (
      recipe_id,
      product_id,
      product_name_snapshot,
      product_photo_snapshot,
      quantity_used,
      units_to_purchase,
      price_snapshot,
      price_verified,
      sort_order
    )
    values (
      v_recipe_id,
      v_ing_product_id,
      v_ing_name,
      v_ing_photo,
      v_ing_qty,
      v_ing_units,
      v_ing_price,
      v_ing_verified,
      v_idx
    );

    v_idx := v_idx + 1;
  end loop;

  -- Record historical verified recipe price snapshot when all ingredient prices are verified
  if v_all_verified and v_total is not null then
    insert into public.recipe_price_snapshots (
      recipe_id,
      total_purchase_cost,
      ingredient_breakdown,
      verified_by,
      verified_at
    )
    values (
      v_recipe_id,
      v_total,
      v_snapshot_breakdown,
      auth.uid(),
      v_now
    );
  end if;

  -- Append sequential revision record
  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.recipe_revisions
  where recipe_id = v_recipe_id;

  insert into public.recipe_revisions (
    recipe_id,
    version_number,
    changed_fields,
    previous_values,
    new_values,
    change_summary,
    created_by,
    created_at
  )
  values (
    v_recipe_id,
    v_next_version,
    v_changed_fields,
    v_prev_values,
    v_new_values,
    coalesce(
      nullif(trim(coalesce(p_change_summary, '')), ''),
      case
        when p_recipe_id is null then format('Created recipe "%s" (%s).', v_clean_name, p_status)
        else format('Updated recipe "%s".', v_clean_name)
      end
    ),
    v_actor,
    v_now
  );

  return query
    select v_recipe_id, v_clean_slug, v_total, v_all_verified;
end;
$$;

-- 8C. Re-verify a flagged recipe against current Product Catalog prices atomically
create or replace function public.verify_recipe_catalog_prices(
  p_recipe_id uuid,
  p_actor_email text default null
)
returns table(
  recipe_id uuid,
  total_purchase_cost numeric(10, 2),
  price_verified boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_recipe public.recipes%rowtype;
  v_prev_ingredients jsonb;
  v_new_ingredients jsonb;
  v_breakdown jsonb;
  v_all_verified boolean;
  v_total numeric(10, 2);
  v_next_version int;
  v_actor text := coalesce(nullif(trim(coalesce(p_actor_email, '')), ''), 'Admin');
begin
  if not public.is_verified_admin() then
    raise exception 'UNAUTHORIZED: Verified admin session required.';
  end if;

  select *
  into v_recipe
  from public.recipes
  where id = p_recipe_id
  for update;

  if not found then
    raise exception 'RECIPE_NOT_FOUND: Recipe not found.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ri) order by ri.sort_order), '[]'::jsonb)
  into v_prev_ingredients
  from public.recipe_ingredients ri
  where ri.recipe_id = p_recipe_id;

  -- Refresh catalog-linked ingredient snapshots from current products table
  update public.recipe_ingredients ri
  set product_name_snapshot = p.name,
      product_photo_snapshot = p.photo_url,
      price_snapshot = p.purchase_price,
      price_verified = true
  from public.products p
  where ri.recipe_id = p_recipe_id
    and ri.product_id = p.id;

  select
    bool_and(ri.price_verified and ri.price_snapshot is not null and ri.price_snapshot >= 0),
    case
      when bool_and(ri.price_verified and ri.price_snapshot is not null and ri.price_snapshot >= 0)
        then round(sum(ri.price_snapshot * ri.units_to_purchase), 2)
      else null
    end,
    coalesce(jsonb_agg(to_jsonb(ri) order by ri.sort_order), '[]'::jsonb),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'productId', ri.product_id,
          'productNameSnapshot', ri.product_name_snapshot,
          'quantityUsed', ri.quantity_used,
          'unitsToPurchase', ri.units_to_purchase,
          'priceSnapshot', ri.price_snapshot,
          'lineTotal', round(coalesce(ri.price_snapshot, 0) * ri.units_to_purchase, 2)
        )
        order by ri.sort_order
      ),
      '[]'::jsonb
    )
  into v_all_verified, v_total, v_new_ingredients, v_breakdown
  from public.recipe_ingredients ri
  where ri.recipe_id = p_recipe_id;

  v_all_verified := coalesce(v_all_verified, false);

  update public.recipes
  set total_purchase_cost = v_total,
      price_verified = v_all_verified,
      needs_price_review = false,
      last_price_verified_at = case when v_all_verified then v_now else last_price_verified_at end,
      updated_at = v_now
  where id = p_recipe_id;

  if v_all_verified and v_total is not null then
    insert into public.recipe_price_snapshots (
      recipe_id,
      total_purchase_cost,
      ingredient_breakdown,
      verified_by,
      verified_at
    )
    values (
      p_recipe_id,
      v_total,
      v_breakdown,
      auth.uid(),
      v_now
    );
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.recipe_revisions
  where recipe_id = p_recipe_id;

  insert into public.recipe_revisions (
    recipe_id,
    version_number,
    changed_fields,
    previous_values,
    new_values,
    change_summary,
    created_by,
    created_at
  )
  values (
    p_recipe_id,
    v_next_version,
    array['totalPurchaseCost', 'ingredients_price_snapshot'],
    jsonb_build_object(
      'totalPurchaseCost', v_recipe.total_purchase_cost,
      'ingredients', v_prev_ingredients
    ),
    jsonb_build_object(
      'totalPurchaseCost', v_total,
      'ingredients', v_new_ingredients
    ),
    format(
      'Reviewed and updated price snapshot from %s to %s.',
      coalesce(v_recipe.total_purchase_cost::text, 'N/A'),
      coalesce(v_total::text, 'N/A')
    ),
    v_actor,
    v_now
  );

  return query select p_recipe_id, v_total, v_all_verified;
end;
$$;

-- 8D. Atomically approve a pending community submission and publish verified recipe
create or replace function public.approve_community_submission(
  p_submission_id uuid,
  p_name text,
  p_slug text,
  p_category public.drink_category,
  p_photo_url text,
  p_taste_notes text,
  p_ingredients jsonb,
  p_admin_notes text default null,
  p_actor_email text default null
)
returns table(
  recipe_id uuid,
  slug text,
  total_purchase_cost numeric(10, 2)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_sub public.community_submissions%rowtype;
  v_saved record;
begin
  if not public.is_verified_admin() then
    raise exception 'UNAUTHORIZED: Verified admin session required.';
  end if;

  select *
  into v_sub
  from public.community_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'SUBMISSION_NOT_FOUND: Community submission not found.';
  end if;

  if v_sub.status <> 'Pending' then
    raise exception 'SUBMISSION_ALREADY_REVIEWED: Only Pending submissions can be approved.';
  end if;

  select *
  into v_saved
  from public.save_recipe_with_ingredients(
    null,
    p_slug,
    p_name,
    p_category,
    'Published'::public.recipe_status,
    p_photo_url,
    v_sub.submitter_name,
    p_taste_notes,
    false,
    false,
    p_ingredients,
    format('Approved community submission by %s.', v_sub.submitter_name),
    p_actor_email
  );

  update public.community_submissions
  set status = 'Published',
      admin_review_notes = coalesce(nullif(trim(coalesce(p_admin_notes, '')), ''), 'Approved and verified by Admin.'),
      approved_recipe_id = v_saved.recipe_id,
      reviewed_at = v_now
  where id = p_submission_id;

  return query
    select v_saved.recipe_id, v_saved.slug, v_saved.total_purchase_cost;
end;
$$;

-- 8E. Non-destructively restore a prior recipe revision (appends a new revision)
create or replace function public.restore_recipe_revision(
  p_revision_id uuid,
  p_actor_email text default null
)
returns table(
  recipe_id uuid,
  new_version_number int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_rev public.recipe_revisions%rowtype;
  v_recipe public.recipes%rowtype;
  v_snapshot jsonb;
  v_restored_name text;
  v_restored_category public.drink_category;
  v_restored_ingredients jsonb;
  v_current_ingredients jsonb;
  v_saved record;
  v_latest_rev_id uuid;
  v_latest_version int;
begin
  if not public.is_verified_admin() then
    raise exception 'UNAUTHORIZED: Verified admin session required.';
  end if;

  select *
  into v_rev
  from public.recipe_revisions
  where id = p_revision_id;

  if not found then
    raise exception 'REVISION_NOT_FOUND: Revision record not found.';
  end if;

  select *
  into v_recipe
  from public.recipes
  where id = v_rev.recipe_id
  for update;

  if not found then
    raise exception 'RECIPE_NOT_FOUND: Associated recipe not found.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ri) order by ri.sort_order), '[]'::jsonb)
  into v_current_ingredients
  from public.recipe_ingredients ri
  where ri.recipe_id = v_recipe.id;

  v_snapshot := case
    when v_rev.previous_values is not null and v_rev.previous_values <> '{}'::jsonb
      then v_rev.previous_values
    else v_rev.new_values
  end;

  v_restored_name := coalesce(nullif(v_snapshot->>'name', ''), v_recipe.name);
  v_restored_category := coalesce(
    nullif(v_snapshot->>'category', '')::public.drink_category,
    v_recipe.category
  );
  v_restored_ingredients := case
    when v_snapshot ? 'ingredients' and jsonb_typeof(v_snapshot->'ingredients') = 'array'
      and jsonb_array_length(v_snapshot->'ingredients') > 0
      then v_snapshot->'ingredients'
    else v_current_ingredients
  end;

  select *
  into v_saved
  from public.save_recipe_with_ingredients(
    v_recipe.id,
    v_recipe.slug,
    v_restored_name,
    v_restored_category,
    v_recipe.status,
    v_recipe.photo_url,
    v_recipe.submitter_name,
    v_recipe.taste_notes,
    v_recipe.is_editors_pick,
    v_recipe.is_trending,
    v_restored_ingredients,
    format('Restored state from Revision v%s (non-destructive).', v_rev.version_number),
    p_actor_email
  );

  select id, version_number
  into v_latest_rev_id, v_latest_version
  from public.recipe_revisions
  where recipe_id = v_recipe.id
  order by version_number desc
  limit 1;

  update public.recipe_revisions
  set restored_from_revision_id = p_revision_id,
      changed_fields = array['restored_version']
  where id = v_latest_rev_id;

  return query select v_recipe.id, v_latest_version;
end;
$$;

-- =============================================================================
-- 9. EXPLICIT EXECUTION PERMISSIONS (LEAST PRIVILEGE)
-- =============================================================================
revoke all on function public.is_verified_admin() from public;
grant execute on function public.is_verified_admin() to anon, authenticated;

revoke all on function public.handle_product_price_change() from public;

-- Public-callable RPCs (strictly validated & rate-limited / Pending-only)
revoke all on function public.get_liked_recipe_ids(text) from public;
grant execute on function public.get_liked_recipe_ids(text) to anon, authenticated;

revoke all on function public.toggle_recipe_like(uuid, text) from public;
grant execute on function public.toggle_recipe_like(uuid, text) to anon, authenticated;

revoke all on function public.submit_community_hack(
  text, public.drink_category, text, text, text, text, jsonb
) from public;
grant execute on function public.submit_community_hack(
  text, public.drink_category, text, text, text, text, jsonb
) to anon, authenticated;

revoke all on function public.submit_contact_report(
  public.report_category, text, text, text, text
) from public;
grant execute on function public.submit_contact_report(
  public.report_category, text, text, text, text
) to anon, authenticated;

-- Admin-only RPCs (authenticated only; runtime additionally enforces is_verified_admin())
revoke all on function public.touch_admin_activity() from public;
grant execute on function public.touch_admin_activity() to authenticated;

revoke all on function public.save_recipe_with_ingredients(
  uuid, text, text, public.drink_category, public.recipe_status,
  text, text, text, boolean, boolean, jsonb, text, text
) from public;
grant execute on function public.save_recipe_with_ingredients(
  uuid, text, text, public.drink_category, public.recipe_status,
  text, text, text, boolean, boolean, jsonb, text, text
) to authenticated;

revoke all on function public.verify_recipe_catalog_prices(uuid, text) from public;
grant execute on function public.verify_recipe_catalog_prices(uuid, text) to authenticated;

revoke all on function public.approve_community_submission(
  uuid, text, text, public.drink_category, text, text, jsonb, text, text
) from public;
grant execute on function public.approve_community_submission(
  uuid, text, text, public.drink_category, text, text, jsonb, text, text
) to authenticated;

revoke all on function public.restore_recipe_revision(uuid, text) from public;
grant execute on function public.restore_recipe_revision(uuid, text) to authenticated;
