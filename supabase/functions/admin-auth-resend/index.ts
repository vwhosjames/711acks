// =============================================================================
// 711ACKS — SUPABASE EDGE FUNCTION: admin-auth-resend
// =============================================================================
// Phase 3.6 Hardened:
//   - Strict origin allowlist rejection (403 on disallowed Origin).
//   - Fail-closed IP-level rate limit (`resend:ip:<hash>`, 10 / 15 min) BEFORE
//     touching challenge rows.
//   - Atomic row-locked challenge rotation via PostgreSQL
//     `rotate_admin_otp_challenge_for_resend` (FOR UPDATE + constant-time hash
//     check + 30s cooldown + per-admin rolling 5/15m limit in one transaction).
//   - Explicit `challengeInvalidated: true` metadata on all inactive/expired
//     responses without leaking account or challenge ownership.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  OTP_EXPIRY_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  computeServerOtpHash,
  extractAnonymizedIpHash,
  generateChallengeToken,
  generateSecureSixDigitOtp,
  getRequiredAdminAuthEnv,
  handleAdminPreflight,
  jsonAdminResponse,
  rejectIfDisallowedOrigin,
  sha256Hex,
} from '../_shared/adminAuthShared.ts';
import {
  loadSmtpConfigFromEnv,
  sendAdminOtpEmailViaSmtp,
} from '../_shared/smtpClient.ts';

const GENERIC_INACTIVE_CHALLENGE_ERROR =
  'Verification challenge is no longer active. Please sign in again.';

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
  const smtpConfig = loadSmtpConfigFromEnv();
  if (!env || !smtpConfig) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Server-side Email OTP delivery is not fully configured on the backend.',
      },
      503
    );
  }

  let body: { challengeId?: string; challengeToken?: string };
  try {
    body = await req.json();
  } catch {
    return jsonAdminResponse(req, { error: 'Invalid request payload.' }, 400);
  }

  const oldChallengeId = (body.challengeId || '').trim();
  const oldChallengeToken = (body.challengeToken || '').trim();
  if (
    !/^[0-9a-f-]{36}$/i.test(oldChallengeId) ||
    !/^[0-9a-f]{64}$/i.test(oldChallengeToken)
  ) {
    return jsonAdminResponse(
      req,
      {
        error: GENERIC_INACTIVE_CHALLENGE_ERROR,
        code: 'INVALID_REQUEST',
        challengeInvalidated: true,
      },
      400
    );
  }

  const serviceClient = createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const ipHash = await extractAnonymizedIpHash(req, env.otpPepper);

  // 1. M-02: Fail-closed IP rate limit BEFORE querying challenges (max 10 / 15 min)
  const { data: ipLimitData, error: ipLimitErr } = await serviceClient.rpc(
    'check_admin_auth_rate_limit',
    {
      p_bucket_key: `resend:ip:${ipHash}`,
      p_window_seconds: 900,
      p_max_requests: 10,
    }
  );

  const ipLimit = Array.isArray(ipLimitData) ? ipLimitData[0] : ipLimitData;
  if (ipLimitErr || !ipLimit || typeof ipLimit.allowed !== 'boolean') {
    return jsonAdminResponse(
      req,
      { error: 'Authentication service is temporarily unavailable.' },
      503
    );
  }

  if (ipLimit.allowed === false) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Too many verification code resend attempts. Please wait and try again.',
        retryAfterSeconds: Math.max(1, ipLimit.retry_after_seconds || 60),
      },
      429
    );
  }

  // 2. Pre-generate fresh replacement challenge hashes before atomic DB rotation
  const nowMs = Date.now();
  const newChallengeId = crypto.randomUUID();
  const otpCode = generateSecureSixDigitOtp();
  const newChallengeToken = generateChallengeToken();

  const [oldTokenHash, newOtpHash, newChallengeTokenHash] = await Promise.all([
    sha256Hex(oldChallengeToken),
    computeServerOtpHash(env.otpPepper, newChallengeId, otpCode),
    sha256Hex(newChallengeToken),
  ]);

  const expiresAtIso = new Date(nowMs + OTP_EXPIRY_MS).toISOString();
  const resendAvailableAtIso = new Date(
    nowMs + OTP_RESEND_COOLDOWN_MS
  ).toISOString();

  // 3. M-01 & M-03: Atomic FOR UPDATE rotation with constant-time hash verification
  //    and transactional per-admin rolling rate-limit enforcement
  const { data: rotateRows, error: rotateErr } = await serviceClient.rpc(
    'rotate_admin_otp_challenge_for_resend',
    {
      p_old_challenge_id: oldChallengeId,
      p_old_challenge_token_hash: oldTokenHash,
      p_new_challenge_id: newChallengeId,
      p_new_otp_hash: newOtpHash,
      p_new_challenge_token_hash: newChallengeTokenHash,
      p_expires_at: expiresAtIso,
      p_resend_available_at: resendAvailableAtIso,
      p_max_attempts: OTP_MAX_ATTEMPTS,
      p_ip_hash: ipHash,
    }
  );

  if (rotateErr) {
    return jsonAdminResponse(
      req,
      { error: 'Authentication service is temporarily unavailable.' },
      503
    );
  }

  const rotation = Array.isArray(rotateRows) ? rotateRows[0] : rotateRows;
  if (!rotation || rotation.rotated !== true) {
    const code = rotation?.status_code || 'CHALLENGE_INACTIVE';
    const invalidated = rotation?.challenge_invalidated === true;
    const waitSec =
      typeof rotation?.retry_after_seconds === 'number'
        ? Math.max(1, rotation.retry_after_seconds)
        : 30;

    if (code === 'COOLDOWN_ACTIVE') {
      return jsonAdminResponse(
        req,
        {
          error: `Please wait ${waitSec}s before requesting a new verification code.`,
          code,
          retryAfterSeconds: waitSec,
          challengeInvalidated: false,
        },
        429
      );
    }

    if (code === 'RATE_LIMITED') {
      return jsonAdminResponse(
        req,
        {
          error:
            'Too many verification codes requested recently. Please wait before trying again.',
          code,
          retryAfterSeconds: waitSec,
          challengeInvalidated: false,
        },
        429
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

    if (code === 'CHALLENGE_EXPIRED') {
      return jsonAdminResponse(
        req,
        {
          error: 'Verification challenge has expired. Please sign in again.',
          code,
          challengeInvalidated: true,
        },
        401
      );
    }

    // Generic non-leaking 401 for not-found, already-used, invalid-token, or non-owner
    return jsonAdminResponse(
      req,
      {
        error: GENERIC_INACTIVE_CHALLENGE_ERROR,
        code,
        challengeInvalidated: invalidated || true,
      },
      401
    );
  }

  // 4. Dispatch fresh OTP via SMTP; invalidate newly inserted challenge if SMTP fails/times out
  try {
    await sendAdminOtpEmailViaSmtp({
      config: smtpConfig,
      toEmail: rotation.admin_email,
      otpCode,
      expiresInMinutes: Math.round(OTP_EXPIRY_MS / 60000),
    });
  } catch {
    await serviceClient
      .from('admin_otp_challenges')
      .update({ used: true })
      .eq('id', newChallengeId);

    return jsonAdminResponse(
      req,
      {
        error: 'Unable to dispatch verification email right now.',
        challengeInvalidated: true,
      },
      503
    );
  }

  await serviceClient.from('security_events').insert({
    event_type: 'ADMIN_OTP_ISSUED',
    actor: rotation.admin_email,
    details: `Resent 6-digit Email OTP challenge ${newChallengeId}. Previous code invalidated.`,
    ip_hash: ipHash,
  });

  return jsonAdminResponse(
    req,
    {
      challengeId: newChallengeId,
      challengeToken: newChallengeToken,
      email: rotation.admin_email,
      expiresAt: expiresAtIso,
      resendAvailableAt: resendAvailableAtIso,
      maxAttempts: OTP_MAX_ATTEMPTS,
    },
    200
  );
});
