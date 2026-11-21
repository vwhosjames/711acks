// =============================================================================
// 711ACKS — SUPABASE EDGE FUNCTION: admin-auth-verify
// =============================================================================
// Step 2 of 2: Atomically verifies the single-use 6-digit Email OTP using
// PostgreSQL row-level locking (`verify_admin_otp_challenge` with constant-time
// hash checks), updates `admin_profiles.otp_verified_until` & `last_active_at`
// server-side for the designated owner only, and ONLY THEN mints and releases
// a Supabase Auth session (`access_token` + `refresh_token`) to the browser.
//
// Phase 3.6 Hardening:
//   - Strict origin allowlist rejection (403 on disallowed Origin).
//   - Fail-closed 503 on rate-limit RPC error or malformed response.
//   - Complete defensive rollback revoking any mismatched minted access token.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  computeServerOtpHash,
  extractAnonymizedIpHash,
  getRequiredAdminAuthEnv,
  handleAdminPreflight,
  jsonAdminResponse,
  rejectIfDisallowedOrigin,
  sha256Hex,
} from '../_shared/adminAuthShared.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleAdminPreflight(req);
  }

  const originRejection = rejectIfDisallowedOrigin(req);
  if (originRejection) {
    return originRejection;
  }

  if (req.method !== 'POST') {
    return jsonAdminResponse(req, { error: 'Method not allowed.' }, 405);
  }

  const env = getRequiredAdminAuthEnv();
  if (!env) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Server-side Email OTP verification is not configured on the backend.',
      },
      503
    );
  }

  let body: {
    challengeId?: string;
    challengeToken?: string;
    otpCode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonAdminResponse(req, { error: 'Invalid request payload.' }, 400);
  }

  const challengeId = (body.challengeId || '').trim();
  const challengeToken = (body.challengeToken || '').trim();
  const otpCode = (body.otpCode || '').trim();

  if (
    !/^[0-9a-f-]{36}$/i.test(challengeId) ||
    !/^[0-9a-f]{64}$/i.test(challengeToken)
  ) {
    return jsonAdminResponse(
      req,
      {
        error: 'No active verification challenge found. Please sign in again.',
        challengeInvalidated: true,
      },
      400
    );
  }

  if (!/^\d{6}$/.test(otpCode)) {
    return jsonAdminResponse(
      req,
      { error: 'Enter the 6-digit numeric verification code from your email.' },
      400
    );
  }

  const serviceClient = createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const ipHash = await extractAnonymizedIpHash(req, env.otpPepper);

  // 1. M-01: Server-side IP verification rate limit (max 20 attempts per 15 min) — FAIL CLOSED
  const { data: verifyLimitData, error: verifyLimitErr } =
    await serviceClient.rpc('check_admin_auth_rate_limit', {
      p_bucket_key: `verify:ip:${ipHash}`,
      p_window_seconds: 900,
      p_max_requests: 20,
    });

  const verifyLimit = Array.isArray(verifyLimitData)
    ? verifyLimitData[0]
    : verifyLimitData;

  if (verifyLimitErr || !verifyLimit || typeof verifyLimit.allowed !== 'boolean') {
    return jsonAdminResponse(
      req,
      { error: 'Authentication service is temporarily unavailable.' },
      503
    );
  }

  if (verifyLimit.allowed === false) {
    return jsonAdminResponse(
      req,
      { error: 'Too many verification attempts. Please wait and try again.' },
      429
    );
  }

  // 2. Compute server-side hashes and invoke atomic PostgreSQL FOR UPDATE verification
  const [challengeTokenHash, candidateOtpHash] = await Promise.all([
    sha256Hex(challengeToken),
    computeServerOtpHash(env.otpPepper, challengeId, otpCode),
  ]);

  const { data: verifyRows, error: verifyErr } = await serviceClient.rpc(
    'verify_admin_otp_challenge',
    {
      p_challenge_id: challengeId,
      p_challenge_token_hash: challengeTokenHash,
      p_candidate_otp_hash: candidateOtpHash,
      p_otp_validity_minutes: env.otpValidityMinutes,
    }
  );

  if (verifyErr) {
    return jsonAdminResponse(
      req,
      { error: 'Unable to verify code right now. Please try again.' },
      500
    );
  }

  const result = Array.isArray(verifyRows) ? verifyRows[0] : verifyRows;
  if (!result || result.verified !== true) {
    const code = result?.status_code || 'INVALID_OTP';
    const remaining =
      typeof result?.remaining_attempts === 'number'
        ? result.remaining_attempts
        : 0;

    if (code === 'CHALLENGE_EXPIRED') {
      return jsonAdminResponse(
        req,
        {
          error: 'This one-time verification code has expired. Please sign in again.',
          code,
          challengeInvalidated: true,
        },
        401
      );
    }

    if (code === 'MAX_ATTEMPTS_EXCEEDED') {
      return jsonAdminResponse(
        req,
        {
          error: 'Maximum verification attempts exceeded. Please sign in again.',
          code,
          challengeInvalidated: true,
        },
        401
      );
    }

    if (
      code === 'CHALLENGE_ALREADY_USED' ||
      code === 'CHALLENGE_NOT_FOUND' ||
      code === 'INVALID_CHALLENGE_TOKEN' ||
      code === 'UNAUTHORIZED_ADMIN'
    ) {
      return jsonAdminResponse(
        req,
        {
          error:
            'This verification challenge is invalid or has already been used. Please sign in again.',
          code,
          challengeInvalidated: true,
        },
        401
      );
    }

    if (code === 'ACCOUNT_LOCKED') {
      return jsonAdminResponse(
        req,
        {
          error: 'Administrator sign-in is temporarily locked.',
          code,
          challengeInvalidated: true,
        },
        429
      );
    }

    return jsonAdminResponse(
      req,
      {
        error: `Invalid verification code. ${remaining} attempt(s) remaining.`,
        code,
        remainingAttempts: remaining,
        challengeInvalidated: remaining <= 0,
      },
      401
    );
  }

  // 3. ONLY AFTER atomic OTP verification succeeded: mint a fresh Supabase Auth session
  const { data: linkData, error: linkError } =
    await serviceClient.auth.admin.generateLink({
      type: 'magiclink',
      email: result.admin_email,
    });

  const hashedToken = linkData?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    await serviceClient.rpc('revoke_admin_otp_session', {
      p_admin_id: result.admin_id,
      p_event_type: 'ADMIN_LOGOUT',
      p_details: 'Revoked OTP verification because session minting failed.',
    });
    return jsonAdminResponse(
      req,
      { error: 'Unable to establish verified administrator session.' },
      500
    );
  }

  const exchangeClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sessionData, error: sessionErr } =
    await exchangeClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'magiclink',
    });

  if (
    sessionErr ||
    !sessionData?.session?.access_token ||
    !sessionData?.session?.refresh_token ||
    sessionData.user?.id !== result.admin_id
  ) {
    // Defensive rollback: revoke any mismatched minted token AND clear otp_verified_until
    if (sessionData?.session?.access_token) {
      await serviceClient.auth.admin
        .signOut(sessionData.session.access_token, 'local')
        .catch(() => {});
    }
    await serviceClient.rpc('revoke_admin_otp_session', {
      p_admin_id: result.admin_id,
      p_event_type: 'ADMIN_LOGOUT',
      p_details: 'Revoked OTP verification because session exchange failed.',
    });
    return jsonAdminResponse(
      req,
      { error: 'Unable to establish verified administrator session.' },
      500
    );
  }

  return jsonAdminResponse(
    req,
    {
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_at: sessionData.session.expires_at,
      },
      admin: {
        email: result.admin_email,
        otpVerifiedUntil: result.otp_verified_until,
        lastActiveAt: result.last_active_at,
        sessionTimeoutMinutes: result.session_timeout_minutes,
      },
    },
    200
  );
});
