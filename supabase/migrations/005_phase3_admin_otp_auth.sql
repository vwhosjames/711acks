-- =============================================================================
-- 711ACKS — MIGRATION 005: PHASE 3 SERVER-SIDE EMAIL OTP & ADMIN AUTH HARDENING
-- =============================================================================
-- MIGRATION ORDER (REQUIRED):
--   1. supabase/migrations/001_711acks_schema.sql
--   2. supabase/migrations/002_phase2_database_foundation.sql
--   3. supabase/migrations/003_storage_setup.sql
--   4. supabase/migrations/004_phase2d_security_hardening.sql
--   5. supabase/migrations/005_phase3_admin_otp_auth.sql
--
-- SAFETY GUARANTEES:
--   - Strictly additive and idempotent; preserves migrations 001–004 unchanged.
--   - Does NOT add any client-side write access to admin_profiles,
--     admin_otp_challenges, or admin_auth_rate_limits.
--   - Preserves public.is_verified_admin() as the central RLS & Storage gate.
--   - All OTP verification, session revocation, and rate-limit functions are
--     strictly restricted to `service_role` (revoked from public, anon, authenticated).
-- =============================================================================

-- =============================================================================
-- 1. ENFORCE SINGLE OWNER ADMINISTRATOR INVARIANT
-- =============================================================================
-- Guarantees at most one 'owner' record can exist in public.admin_profiles
-- (no public admin registration or secondary owner escalation).
create unique index if not exists uq_admin_profiles_single_owner
  on public.admin_profiles (role)
  where role = 'owner';

-- =============================================================================
-- 2. EXTEND admin_otp_challenges FOR CHALLENGE TOKEN BINDING & AUDIT
-- =============================================================================
-- Stores only SHA-256 hash of the per-challenge opaque token (never plaintext
-- OTP and never plaintext token) plus optional hashed client IP for rate audit.
alter table public.admin_otp_challenges
  add column if not exists challenge_token_hash text;

alter table public.admin_otp_challenges
  add column if not exists ip_hash text;

create index if not exists idx_admin_otp_challenges_token_active
  on public.admin_otp_challenges (id, challenge_token_hash)
  where used = false;

-- =============================================================================
-- 3. SERVER-SIDE ADMIN AUTH RATE-LIMIT TABLE (SERVICE ROLE ONLY)
-- =============================================================================
create table if not exists public.admin_auth_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count int not null default 1 check (request_count >= 1),
  last_request_at timestamptz not null default now()
);

alter table public.admin_auth_rate_limits enable row level security;
-- Intentionally ZERO policies for anon or authenticated roles.
-- Accessed exclusively by service_role inside Edge Functions.

-- =============================================================================
-- 4. SERVICE-ROLE ATOMIC RATE-LIMIT CHECKER
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

  select *
  into v_row
  from public.admin_auth_rate_limits rl
  where rl.bucket_key = v_key
  for update;

  if not found then
    insert into public.admin_auth_rate_limits (
      bucket_key,
      window_started_at,
      request_count,
      last_request_at
    )
    values (v_key, v_now, 1, v_now);

    return query select true, greatest(0, v_max - 1), 0;
    return;
  end if;

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
-- 5. SERVICE-ROLE ATOMIC SINGLE-USE OTP VERIFICATION & otp_verified_until SETTER
-- =============================================================================
-- Eliminates concurrent / replayed OTP race conditions using row-level FOR UPDATE
-- locking on admin_otp_challenges and admin_profiles within a single transaction.
-- Only sets admin_profiles.otp_verified_until server-side for the single owner.
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

  -- Lock challenge row atomically to prevent concurrent replay
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
     or v_challenge.challenge_token_hash <> trim(p_challenge_token_hash) then
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

  -- Lock and verify designated owner admin profile
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

  -- Verify hashed OTP
  if v_challenge.otp_hash <> trim(p_candidate_otp_hash) then
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

  -- Valid OTP: consume challenge atomically (strictly single-use) and invalidate any siblings
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

  -- Set otp_verified_until and last_active_at server-side for the owner account only
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
-- 6. SERVICE-ROLE SERVER-SIDE SESSION & OTP REVOCATION
-- =============================================================================
-- Immediately invalidates otp_verified_until so public.is_verified_admin()
-- returns false for any in-flight or replayed JWTs after sign-out or timeout.
create or replace function public.revoke_admin_otp_session(
  p_admin_id uuid,
  p_event_type text default 'ADMIN_LOGOUT',
  p_details text default 'Administrator signed out.'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.admin_profiles%rowtype;
  v_event text := case
    when p_event_type in ('ADMIN_LOGOUT', 'ADMIN_SESSION_TIMEOUT') then p_event_type
    else 'ADMIN_LOGOUT'
  end;
begin
  if p_admin_id is null then
    return false;
  end if;

  select *
  into v_admin
  from public.admin_profiles ap
  where ap.id = p_admin_id
    and ap.role = 'owner'
  for update;

  if not found then
    return false;
  end if;

  update public.admin_profiles
  set otp_verified_until = null
  where id = v_admin.id
    and role = 'owner';

  update public.admin_otp_challenges
  set used = true
  where admin_id = v_admin.id
    and used = false;

  insert into public.security_events (event_type, actor, details)
  values (
    v_event,
    v_admin.email,
    left(coalesce(nullif(trim(p_details), ''), 'Administrator session revoked.'), 400)
  );

  return true;
end;
$$;

-- =============================================================================
-- 7. STRICT LEAST-PRIVILEGE GRANTS (SERVICE ROLE ONLY — ZERO CLIENT ACCESS)
-- =============================================================================
revoke all on function public.check_admin_auth_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_admin_auth_rate_limit(text, int, int) to service_role;

revoke all on function public.verify_admin_otp_challenge(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.verify_admin_otp_challenge(uuid, text, text, int) to service_role;

revoke all on function public.revoke_admin_otp_session(uuid, text, text) from public, anon, authenticated;
grant execute on function public.revoke_admin_otp_session(uuid, text, text) to service_role;
