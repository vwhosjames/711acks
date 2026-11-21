-- =============================================================================
-- 711ACKS — MIGRATION 006: PHASE 3.6 SECURITY AUDIT HARDENING
-- =============================================================================
-- MIGRATION ORDER (REQUIRED):
--   1. supabase/migrations/001_711acks_schema.sql
--   2. supabase/migrations/002_phase2_database_foundation.sql
--   3. supabase/migrations/003_storage_setup.sql
--   4. supabase/migrations/004_phase2d_security_hardening.sql
--   5. supabase/migrations/005_phase3_admin_otp_auth.sql
--   6. supabase/migrations/006_phase36_security_hardening.sql
--
-- SAFETY GUARANTEES:
--   - Strictly additive and idempotent; preserves migrations 001–005 unchanged.
--   - Closes Phase 3.5 security audit findings:
--       * L-02: Treat `last_active_at IS NULL` as inactive in `is_verified_admin()`.
--       * L-03: Enforce `is_verified_admin()` inside `resolve_unique_recipe_slug()`.
--       * M-01: Make `check_admin_auth_rate_limit()` concurrent-insert race-safe
--               via `INSERT ... ON CONFLICT DO NOTHING` before `FOR UPDATE`.
--       * M-01: Add atomic `FOR UPDATE` `record_admin_failed_login()` RPC.
--       * M-01/M-03: Add atomic `FOR UPDATE` `rotate_admin_otp_challenge_for_resend()`
--                    RPC with constant-time hash comparison and explicit
--                    `challenge_invalidated` metadata.
--       * M-03: Use constant-time hash comparison inside `verify_admin_otp_challenge()`.
--   - All service-role authentication RPCs pin `set search_path = public, pg_temp`
--     and are strictly revoked from `public, anon, authenticated`.
-- =============================================================================

-- =============================================================================
-- 1. CONSTANT-TIME TEXT COMPARISON HELPER (INTERNAL / SERVICE ROLE ONLY)
-- =============================================================================
create or replace function public.constant_time_text_equal(
  p_a text,
  p_b text
)
returns boolean
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_a bytea := convert_to(p_a, 'UTF8');
  v_b bytea := convert_to(p_b, 'UTF8');
  v_len_a int := octet_length(v_a);
  v_len_b int := octet_length(v_b);
  v_max_len int := greatest(v_len_a, v_len_b);
  v_diff int := v_len_a # v_len_b;
  v_i int;
  v_ba int;
  v_bb int;
begin
  if v_max_len = 0 then
    return true;
  end if;

  for v_i in 0 .. (v_max_len - 1) loop
    v_ba := case when v_i < v_len_a then get_byte(v_a, v_i) else 0 end;
    v_bb := case when v_i < v_len_b then get_byte(v_b, v_i) else 0 end;
    v_diff := v_diff | (v_ba # v_bb);
  end loop;

  return v_diff = 0;
end;
$$;

-- =============================================================================
-- 2. [L-02] TIGHTEN public.is_verified_admin() — REQUIRE last_active_at IS NOT NULL
-- =============================================================================
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
      and ap.last_active_at is not null
      and ap.last_active_at > now() - make_interval(mins => coalesce(ws.session_timeout_minutes, 30))
  );
$$;

-- =============================================================================
-- 3. [L-03] GUARD public.resolve_unique_recipe_slug() WITH is_verified_admin()
-- =============================================================================
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
  if not public.is_verified_admin() then
    raise exception 'UNAUTHORIZED: Verified admin session required to resolve recipe slugs.';
  end if;

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
-- 4. [M-01] RACE-SAFE ATOMIC RATE-LIMIT CHECKER (NO FIRST-INSERT 23505 RACE)
-- =============================================================================
create or replace function public.check_admin_auth_rate_limit(
  p_bucket_key text,
  p_window_seconds int,
  p_max_requests int
)
returns table(
  allowed boolean,
  remaining int,
  retry_after_seconds int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_key text := trim(coalesce(p_bucket_key, ''));
  v_window int := greatest(10, least(coalesce(p_window_seconds, 900), 86400));
  v_max int := greatest(1, least(coalesce(p_max_requests, 10), 1000));
  v_row public.admin_auth_rate_limits%rowtype;
  v_elapsed_sec int;
begin
  if char_length(v_key) < 3 or char_length(v_key) > 256 then
    raise exception 'INVALID_RATE_LIMIT_KEY: Bucket key must be between 3 and 256 characters.';
  end if;

  -- Race-safe first-request creation: concurrent callers for a brand-new bucket
  -- serialize on the PK index without throwing unique_violation (23505).
  insert into public.admin_auth_rate_limits (
    bucket_key,
    window_started_at,
    request_count,
    last_request_at
  )
  values (v_key, v_now, 1, v_now)
  on conflict (bucket_key) do nothing;

  if found then
    return query select true, greatest(0, v_max - 1), 0;
    return;
  end if;

  -- Existing bucket: lock atomically before evaluating or incrementing window
  select *
  into v_row
  from public.admin_auth_rate_limits rl
  where rl.bucket_key = v_key
  for update;

  v_elapsed_sec := floor(extract(epoch from (v_now - v_row.window_started_at)))::int;

  if v_elapsed_sec >= v_window then
    update public.admin_auth_rate_limits
    set window_started_at = v_now,
        request_count = 1,
        last_request_at = v_now
    where bucket_key = v_key;

    return query select true, greatest(0, v_max - 1), 0;
    return;
  end if;

  if v_row.request_count >= v_max then
    update public.admin_auth_rate_limits
    set last_request_at = v_now
    where bucket_key = v_key;

    return query select false, 0, greatest(1, v_window - v_elapsed_sec);
    return;
  end if;

  update public.admin_auth_rate_limits
  set request_count = request_count + 1,
      last_request_at = v_now
  where bucket_key = v_key;

  return query select true, greatest(0, v_max - (v_row.request_count + 1)), 0;
end;
$$;

-- =============================================================================
-- 5. [M-01] ATOMIC FAILED LOGIN COUNTER & LOCKOUT (SERVICE ROLE ONLY)
-- =============================================================================
create or replace function public.record_admin_failed_login(
  p_admin_id uuid,
  p_max_attempts int default 5,
  p_lockout_minutes int default 15,
  p_ip_hash text default null
)
returns table(
  locked boolean,
  failed_attempts int,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_admin public.admin_profiles%rowtype;
  v_max int := greatest(3, least(coalesce(p_max_attempts, 5), 20));
  v_lock_mins int := greatest(5, least(coalesce(p_lockout_minutes, 15), 120));
  v_next_failures int;
  v_should_lock boolean;
  v_locked_until timestamptz;
begin
  if p_admin_id is null then
    return query select false, 0, null::timestamptz;
    return;
  end if;

  select *
  into v_admin
  from public.admin_profiles ap
  where ap.id = p_admin_id
    and ap.role = 'owner'
  for update;

  if not found then
    return query select false, 0, null::timestamptz;
    return;
  end if;

  -- Already locked: preserve existing lockout window without resetting timer
  if v_admin.locked_until is not null and v_admin.locked_until > v_now then
    return query select true, coalesce(v_admin.failed_login_attempts, v_max), v_admin.locked_until;
    return;
  end if;

  -- If a prior lockout expired, start a fresh failure window from 1
  if v_admin.locked_until is not null and v_admin.locked_until <= v_now then
    v_next_failures := 1;
  else
    v_next_failures := coalesce(v_admin.failed_login_attempts, 0) + 1;
  end if;

  v_should_lock := v_next_failures >= v_max;
  v_locked_until := case
    when v_should_lock then v_now + make_interval(mins => v_lock_mins)
    else null
  end;

  update public.admin_profiles
  set failed_login_attempts = v_next_failures,
      locked_until = v_locked_until
  where id = v_admin.id
    and role = 'owner';

  insert into public.security_events (event_type, actor, details, ip_hash)
  values (
    case when v_should_lock then 'ADMIN_LOCKOUT_TRIGGERED' else 'ADMIN_LOGIN_FAILED' end,
    v_admin.email,
    case
      when v_should_lock then format('Temporary %s-minute lockout triggered after %s failed login attempts.', v_lock_mins, v_next_failures)
      else format('Invalid password attempt (%s/%s).', v_next_failures, v_max)
    end,
    p_ip_hash
  );

  return query select v_should_lock, v_next_failures, v_locked_until;
end;
$$;

-- =============================================================================
-- 6. [M-01 & M-03] ATOMIC OTP RESEND ROTATION WITH FOR UPDATE & CONSTANT-TIME CHECK
-- =============================================================================
create or replace function public.rotate_admin_otp_challenge_for_resend(
  p_old_challenge_id uuid,
  p_old_challenge_token_hash text,
  p_new_challenge_id uuid,
  p_new_otp_hash text,
  p_new_challenge_token_hash text,
  p_expires_at timestamptz,
  p_resend_available_at timestamptz,
  p_max_attempts int default 5,
  p_ip_hash text default null
)
returns table(
  rotated boolean,
  status_code text,
  admin_id uuid,
  admin_email text,
  challenge_invalidated boolean,
  retry_after_seconds int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_challenge public.admin_otp_challenges%rowtype;
  v_admin public.admin_profiles%rowtype;
  v_wait_sec int;
  v_limit_allowed boolean;
  v_limit_retry int;
begin
  if p_old_challenge_id is null
     or p_new_challenge_id is null
     or p_old_challenge_token_hash is null
     or char_length(trim(p_old_challenge_token_hash)) <> 64
     or p_new_otp_hash is null
     or char_length(trim(p_new_otp_hash)) <> 64
     or p_new_challenge_token_hash is null
     or char_length(trim(p_new_challenge_token_hash)) <> 64 then
    return query select false, 'INVALID_REQUEST'::text, null::uuid, null::text, true, 0;
    return;
  end if;

  -- Lock the target challenge row so concurrent resends serialize atomically
  select *
  into v_challenge
  from public.admin_otp_challenges c
  where c.id = p_old_challenge_id
  for update;

  if not found then
    return query select false, 'CHALLENGE_NOT_FOUND'::text, null::uuid, null::text, true, 0;
    return;
  end if;

  if v_challenge.used then
    return query select false, 'CHALLENGE_ALREADY_USED'::text, null::uuid, null::text, true, 0;
    return;
  end if;

  if v_challenge.challenge_token_hash is null
     or not public.constant_time_text_equal(
       v_challenge.challenge_token_hash,
       trim(p_old_challenge_token_hash)
     ) then
    return query select false, 'INVALID_CHALLENGE_TOKEN'::text, null::uuid, null::text, true, 0;
    return;
  end if;

  if v_now >= v_challenge.expires_at then
    update public.admin_otp_challenges
    set used = true
    where id = v_challenge.id;

    return query select false, 'CHALLENGE_EXPIRED'::text, null::uuid, null::text, true, 0;
    return;
  end if;

  if v_now < v_challenge.resend_available_at then
    v_wait_sec := greatest(1, ceil(extract(epoch from (v_challenge.resend_available_at - v_now)))::int);
    return query select false, 'COOLDOWN_ACTIVE'::text, null::uuid, null::text, false, v_wait_sec;
    return;
  end if;

  -- Lock and verify single designated owner profile
  select *
  into v_admin
  from public.admin_profiles ap
  where ap.id = v_challenge.admin_id
    and ap.role = 'owner'
  for update;

  if not found then
    update public.admin_otp_challenges
    set used = true
    where id = v_challenge.id;

    return query select false, 'UNAUTHORIZED_ADMIN'::text, null::uuid, null::text, true, 0;
    return;
  end if;

  if v_admin.locked_until is not null and v_admin.locked_until > v_now then
    return query select false, 'ACCOUNT_LOCKED'::text, null::uuid, null::text, true, 0;
    return;
  end if;

  -- Enforce rolling per-admin OTP issuance rate limit (max 5 / 15 min) inside transaction
  select rl.allowed, rl.retry_after_seconds
  into v_limit_allowed, v_limit_retry
  from public.check_admin_auth_rate_limit(
    'otp_issue:' || v_admin.id::text,
    900,
    5
  ) rl;

  if coalesce(v_limit_allowed, false) = false then
    return query select false, 'RATE_LIMITED'::text, null::uuid, null::text, false, greatest(1, coalesce(v_limit_retry, 60));
    return;
  end if;

  -- Atomically invalidate prior active challenge(s) and insert replacement challenge
  update public.admin_otp_challenges
  set used = true
  where admin_id = v_admin.id
    and used = false;

  insert into public.admin_otp_challenges (
    id,
    admin_id,
    otp_hash,
    challenge_token_hash,
    expires_at,
    used,
    attempt_count,
    max_attempts,
    resend_available_at,
    ip_hash
  )
  values (
    p_new_challenge_id,
    v_admin.id,
    trim(p_new_otp_hash),
    trim(p_new_challenge_token_hash),
    p_expires_at,
    false,
    0,
    greatest(1, least(coalesce(p_max_attempts, 5), 10)),
    p_resend_available_at,
    p_ip_hash
  );

  return query select true, 'ROTATED'::text, v_admin.id, v_admin.email, false, 0;
end;
$$;

-- =============================================================================
-- 7. [M-03] HARDEN verify_admin_otp_challenge WITH CONSTANT-TIME HASH CHECKS
-- =============================================================================
create or replace function public.verify_admin_otp_challenge(
  p_challenge_id uuid,
  p_challenge_token_hash text,
  p_candidate_otp_hash text,
  p_otp_validity_minutes int default 120
)
returns table(
  verified boolean,
  status_code text,
  admin_id uuid,
  admin_email text,
  otp_verified_until timestamptz,
  last_active_at timestamptz,
  session_timeout_minutes int,
  remaining_attempts int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_challenge public.admin_otp_challenges%rowtype;
  v_admin public.admin_profiles%rowtype;
  v_timeout_mins int := 30;
  v_validity_mins int := greatest(15, least(coalesce(p_otp_validity_minutes, 120), 480));
  v_verified_until timestamptz;
  v_next_attempts int;
begin
  if p_challenge_id is null
     or p_challenge_token_hash is null
     or char_length(trim(p_challenge_token_hash)) <> 64
     or p_candidate_otp_hash is null
     or char_length(trim(p_candidate_otp_hash)) <> 64 then
    return query select false, 'INVALID_REQUEST'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, 30, 0;
    return;
  end if;

  select *
  into v_challenge
  from public.admin_otp_challenges c
  where c.id = p_challenge_id
  for update;

  if not found then
    return query select false, 'CHALLENGE_NOT_FOUND'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, 30, 0;
    return;
  end if;

  if v_challenge.used then
    return query select false, 'CHALLENGE_ALREADY_USED'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, 30, 0;
    return;
  end if;

  if v_challenge.challenge_token_hash is null
     or not public.constant_time_text_equal(
       v_challenge.challenge_token_hash,
       trim(p_challenge_token_hash)
     ) then
    return query select false, 'INVALID_CHALLENGE_TOKEN'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, 30, 0;
    return;
  end if;

  if v_now >= v_challenge.expires_at then
    update public.admin_otp_challenges
    set used = true
    where id = v_challenge.id;

    return query select false, 'CHALLENGE_EXPIRED'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, 30, 0;
    return;
  end if;

  if v_challenge.attempt_count >= v_challenge.max_attempts then
    update public.admin_otp_challenges
    set used = true
    where id = v_challenge.id;

    return query select false, 'MAX_ATTEMPTS_EXCEEDED'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, 30, 0;
    return;
  end if;

  select *
  into v_admin
  from public.admin_profiles ap
  where ap.id = v_challenge.admin_id
    and ap.role = 'owner'
  for update;

  if not found then
    update public.admin_otp_challenges
    set used = true
    where id = v_challenge.id;

    return query select false, 'UNAUTHORIZED_ADMIN'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, 30, 0;
    return;
  end if;

  if v_admin.locked_until is not null and v_admin.locked_until > v_now then
    return query select false, 'ACCOUNT_LOCKED'::text, null::uuid, null::text, null::timestamptz, null::timestamptz, 30, 0;
    return;
  end if;

  if not public.constant_time_text_equal(
    v_challenge.otp_hash,
    trim(p_candidate_otp_hash)
  ) then
    v_next_attempts := v_challenge.attempt_count + 1;

    update public.admin_otp_challenges
    set attempt_count = v_next_attempts,
        used = (v_next_attempts >= v_challenge.max_attempts)
    where id = v_challenge.id;

    insert into public.security_events (event_type, actor, details, ip_hash)
    values (
      'ADMIN_OTP_FAILED',
      v_admin.email,
      format(
        'Incorrect 6-digit Email OTP attempt (%s/%s).%s',
        v_next_attempts,
        v_challenge.max_attempts,
        case when v_next_attempts >= v_challenge.max_attempts then ' Challenge invalidated.' else '' end
      ),
      v_challenge.ip_hash
    );

    return query select
      false,
      case when v_next_attempts >= v_challenge.max_attempts then 'MAX_ATTEMPTS_EXCEEDED' else 'INVALID_OTP' end::text,
      null::uuid,
      null::text,
      null::timestamptz,
      null::timestamptz,
      30,
      greatest(0, v_challenge.max_attempts - v_next_attempts);
    return;
  end if;

  update public.admin_otp_challenges
  set used = true,
      attempt_count = attempt_count + 1
  where admin_id = v_admin.id
    and used = false;

  select coalesce(ws.session_timeout_minutes, 30)
  into v_timeout_mins
  from public.website_settings ws
  where ws.id = 1;

  v_timeout_mins := greatest(5, least(coalesce(v_timeout_mins, 30), 240));
  v_verified_until := v_now + make_interval(mins => v_validity_mins);

  update public.admin_profiles
  set otp_verified_until = v_verified_until,
      last_active_at = v_now,
      failed_login_attempts = 0,
      locked_until = null
  where id = v_admin.id
    and role = 'owner';

  insert into public.security_events (event_type, actor, details, ip_hash)
  values (
    'ADMIN_OTP_VERIFIED',
    v_admin.email,
    format('Server-side 6-digit Email OTP verified. Valid until %s (inactivity timeout %s min).', v_verified_until::text, v_timeout_mins),
    v_challenge.ip_hash
  );

  return query select
    true,
    'VERIFIED'::text,
    v_admin.id,
    v_admin.email,
    v_verified_until,
    v_now,
    v_timeout_mins,
    0;
end;
$$;

-- =============================================================================
-- 8. STRICT LEAST-PRIVILEGE GRANTS
-- =============================================================================
revoke all on function public.constant_time_text_equal(text, text) from public, anon, authenticated;
grant execute on function public.constant_time_text_equal(text, text) to service_role;

revoke all on function public.check_admin_auth_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_admin_auth_rate_limit(text, int, int) to service_role;

revoke all on function public.record_admin_failed_login(uuid, int, int, text) from public, anon, authenticated;
grant execute on function public.record_admin_failed_login(uuid, int, int, text) to service_role;

revoke all on function public.rotate_admin_otp_challenge_for_resend(uuid, text, uuid, text, text, timestamptz, timestamptz, int, text) from public, anon, authenticated;
grant execute on function public.rotate_admin_otp_challenge_for_resend(uuid, text, uuid, text, text, timestamptz, timestamptz, int, text) to service_role;

revoke all on function public.verify_admin_otp_challenge(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.verify_admin_otp_challenge(uuid, text, text, int) to service_role;

-- Keep resolve_unique_recipe_slug executable only by authenticated users (guarded inside by is_verified_admin())
revoke all on function public.resolve_unique_recipe_slug(text, uuid) from public, anon;
grant execute on function public.resolve_unique_recipe_slug(text, uuid) to authenticated;
