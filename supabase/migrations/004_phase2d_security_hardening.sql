-- =============================================================================
-- 711ACKS — MIGRATION 004: PHASE 2D SECURITY HARDENING, IMAGE PROMOTION GUARD
--                          & DETERMINISTIC RECIPE SLUG COLLISION HANDLING
-- =============================================================================
-- MIGRATION ORDER (REQUIRED):
--   1. supabase/migrations/001_711acks_schema.sql
--   2. supabase/migrations/002_phase2_database_foundation.sql
--   3. supabase/migrations/003_storage_setup.sql
--   4. supabase/migrations/004_phase2d_security_hardening.sql
--
-- SAFETY GUARANTEES:
--   - Strictly additive and idempotent; preserves migrations 001, 002, and 003 unchanged.
--   - Removes residual direct public INSERT policies that bypassed RPC validation
--     and Maintenance Mode checks.
--   - Preserves all required public SELECT policies, admin RLS policies, and
--     approved public SECURITY DEFINER RPC permissions.
--   - Enforces promoted-image validation in approve_community_submission so
--     private pending-submissions paths or inline data URLs cannot be published.
--   - Enforces deterministic, race-safe recipe slug allocation while preserving
--     existing published URLs and using the UNIQUE constraint on recipes(slug)
--     as the final database integrity guard.
-- =============================================================================

-- =============================================================================
-- 1. DROP UNNECESSARY DIRECT PUBLIC INSERT POLICIES
-- =============================================================================
-- All public visitor submissions now route exclusively through the hardened
-- SECURITY DEFINER RPCs:
--   - public.submit_community_hack(...)
--   - public.submit_contact_report(...)
-- Retaining direct table-level INSERT policies for anon/authenticated allowed
-- raw PostgREST clients to bypass Maintenance Mode, ingredient bounds, active
-- catalog checks, and photo path validation.
--
-- Exact policy names verified against 001_711acks_schema.sql and
-- 002_phase2_database_foundation.sql:
--   - public.community_submissions: "Public can insert pending community submissions" (001)
--   - public.submission_ingredients: "Public can insert submission ingredients" (001, 002)
--   - public.product_suggestions: "Public can insert product suggestions" (001, 002)
--   - public.contact_reports: "Public can submit contact reports" (001)
--
-- Preserved admin policies (unchanged):
--   - public.community_submissions: "Only verified admin can read or manage community submissions"
--   - public.submission_ingredients: "Only verified admin can manage submission ingredients"
--   - public.product_suggestions: "Only verified admin can manage product suggestions"
--   - public.contact_reports: "Only verified admin can read and manage contact reports"

drop policy if exists "Public can insert pending community submissions"
  on public.community_submissions;

drop policy if exists "Public can insert submission ingredients"
  on public.submission_ingredients;

drop policy if exists "Public can insert product suggestions"
  on public.product_suggestions;

drop policy if exists "Public can submit contact reports"
  on public.contact_reports;

-- =============================================================================
-- 2. HARDEN submit_community_hack PHOTO PATH VALIDATION (DEFENSE IN DEPTH)
-- =============================================================================
-- Preserves exact 7-parameter signature, Maintenance Mode check, ingredient
-- validation, Pending-only enforcement, and anon/authenticated EXECUTE grant.
-- Adds strict server-side validation that any provided photo path matches the
-- private pending-submissions path contract from 003_storage_setup.sql and
-- rejects inline base64 data URLs or path traversal strings.

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
  v_clean_finished_photo text := nullif(trim(coalesce(p_finished_photo_storage_path, '')), '');
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

  if v_clean_finished_photo is not null then
    if v_clean_finished_photo ~* '^data:'
       or position('..' in v_clean_finished_photo) > 0
       or position('//' in v_clean_finished_photo) > 0
       or v_clean_finished_photo !~ '^finished-drink/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{32}\.(jpg|png|webp)$' then
      raise exception 'INVALID_PHOTO_PATH: Finished drink photo must be a valid private pending-submissions storage path.';
    end if;
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
    v_clean_finished_photo,
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

    if v_suggested_photo is not null then
      if v_suggested_photo ~* '^data:'
         or position('..' in v_suggested_photo) > 0
         or position('//' in v_suggested_photo) > 0
         or v_suggested_photo !~ '^suggested-product/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{32}\.(jpg|png|webp)$' then
        raise exception 'INVALID_SUGGESTED_PHOTO_PATH: Suggested product photo must be a valid private pending-submissions storage path.';
      end if;
    end if;

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

-- =============================================================================
-- 3. DETERMINISTIC, RACE-SAFE RECIPE SLUG ALLOCATOR
-- =============================================================================
-- Uses a transaction-scoped advisory lock keyed on the base slug so concurrent
-- admin creates/approvals deterministically allocate base, base-2, base-3, ...
-- while public.recipes(slug) UNIQUE remains the final database integrity guard.

create or replace function public.resolve_unique_recipe_slug(
  p_base_slug text,
  p_exclude_recipe_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text := lower(trim(coalesce(p_base_slug, '')));
  v_candidate text;
  v_suffix int := 2;
  v_exists boolean;
begin
  if char_length(v_base) < 2 or v_base !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'INVALID_SLUG: Recipe slug must be lowercase alphanumeric with hyphens.';
  end if;

  -- Serialize allocation for this base slug within the current transaction
  perform pg_advisory_xact_lock(hashtext('711acks:recipe_slug:' || v_base));

  v_candidate := v_base;

  loop
    select exists (
      select 1
      from public.recipes r
      where r.slug = v_candidate
        and (p_exclude_recipe_id is null or r.id <> p_exclude_recipe_id)
    )
    into v_exists;

    if not v_exists then
      return v_candidate;
    end if;

    if v_suffix > 1000 then
      raise exception 'SLUG_ALLOCATION_EXHAUSTED: Unable to allocate a unique recipe slug for "%".', v_base;
    end if;

    v_candidate := v_base || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;
end;
$$;

-- =============================================================================
-- 4. UPDATE save_recipe_with_ingredients WITH SAFE SLUG COLLISION HANDLING
-- =============================================================================
-- Behavior:
--   - Editing an existing Published recipe ALWAYS preserves its existing slug
--     so public URLs (/drinks/<slug>) and printed QR codes never break.
--   - Editing a non-Published recipe preserves its existing slug by default; if
--     an explicit different slug is supplied and owned by another recipe, raises
--     SLUG_COLLISION instead of silently overwriting another recipe.
--   - Creating a new recipe deterministically allocates a unique slug via
--     public.resolve_unique_recipe_slug(v_clean_slug, null) (base, base-2, ...).
--   - Preserves exact 13-parameter signature and verified-admin enforcement.

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
  v_clean_slug text := lower(trim(coalesce(p_slug, '')));
  v_target_slug text;
  v_clean_photo text := trim(coalesce(p_photo_url, ''));
  v_actor text := coalesce(nullif(trim(coalesce(p_actor_email, '')), ''), 'Admin');
  v_existing public.recipes%rowtype;
  v_existing_ingredients jsonb := '[]'::jsonb;
  v_recipe_id uuid;
  v_slug_conflict boolean := false;
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

    -- Preserve existing published URLs so shared links and QR codes remain stable
    if v_existing.status = 'Published' or v_existing.published_at is not null then
      v_target_slug := v_existing.slug;
    else
      v_target_slug := coalesce(nullif(v_clean_slug, ''), v_existing.slug);
      if char_length(v_target_slug) < 2 or v_target_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
        raise exception 'INVALID_SLUG: Recipe slug must be lowercase alphanumeric with hyphens.';
      end if;

      if v_target_slug is distinct from v_existing.slug then
        select exists (
          select 1
          from public.recipes r
          where r.slug = v_target_slug
            and r.id <> v_existing.id
        )
        into v_slug_conflict;

        if v_slug_conflict then
          raise exception 'SLUG_COLLISION: Slug "%" is already assigned to another recipe.', v_target_slug;
        end if;
      end if;
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
    set slug = v_target_slug,
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
    -- New recipe: deterministically resolve any slug collision (base, base-2, base-3, ...)
    v_target_slug := public.resolve_unique_recipe_slug(v_clean_slug, null);

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
      v_target_slug,
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
    select v_recipe_id, v_target_slug, v_total, v_all_verified;
end;
$$;

-- =============================================================================
-- 5. HARDEN approve_community_submission AGAINST UNPROMOTED PRIVATE PHOTOS
-- =============================================================================
-- Guarantees that even a direct RPC call by a verified admin cannot publish a
-- recipe pointing to a private `pending-submissions` relative path or inline
-- data URL. Images must be promoted to `published-drinks` by the trusted
-- server-side Edge Function (`approve-community-submission`) first.

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
  v_clean_photo text := trim(coalesce(p_photo_url, ''));
  v_saved record;
begin
  if not public.is_verified_admin() then
    raise exception 'UNAUTHORIZED: Verified admin session required.';
  end if;

  if char_length(v_clean_photo) < 1 then
    raise exception 'INVALID_PHOTO: Approved recipe requires a promoted public image URL.';
  end if;

  if v_clean_photo ~* '^data:'
     or v_clean_photo ~ '^(finished-drink|suggested-product)/'
     or position('pending-submissions' in lower(v_clean_photo)) > 0
     or position('..' in v_clean_photo) > 0 then
    raise exception 'UNPROMOTED_PENDING_PHOTO: Community submission photo must be promoted to published-drinks before publishing.';
  end if;

  if not (v_clean_photo ~* '^https://' or v_clean_photo ~ '^/') then
    raise exception 'INVALID_PUBLIC_PHOTO_URL: Published recipe photo must be an approved HTTPS URL or verified app asset path.';
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
    v_clean_photo,
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

-- =============================================================================
-- 6. REAFFIRM EXPLICIT LEAST-PRIVILEGE FUNCTION GRANTS
-- =============================================================================
revoke all on function public.resolve_unique_recipe_slug(text, uuid) from public;
grant execute on function public.resolve_unique_recipe_slug(text, uuid) to authenticated;

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

revoke all on function public.save_recipe_with_ingredients(
  uuid, text, text, public.drink_category, public.recipe_status,
  text, text, text, boolean, boolean, jsonb, text, text
) from public;
grant execute on function public.save_recipe_with_ingredients(
  uuid, text, text, public.drink_category, public.recipe_status,
  text, text, text, boolean, boolean, jsonb, text, text
) to authenticated;

revoke all on function public.approve_community_submission(
  uuid, text, text, public.drink_category, text, text, jsonb, text, text
) from public;
grant execute on function public.approve_community_submission(
  uuid, text, text, public.drink_category, text, text, jsonb, text, text
) to authenticated;
