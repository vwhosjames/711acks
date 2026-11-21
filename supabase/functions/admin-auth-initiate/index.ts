// =============================================================================
// 711ACKS — SUPABASE EDGE FUNCTION: admin-auth-initiate
// =============================================================================
// Step 1 of 2: Verifies owner email & password server-side via Supabase Auth,
// discards the pre-OTP token immediately (NEVER returned to the browser),
// generates a CSPRNG 6-digit OTP stored only as HMAC-SHA256, and dispatches
// it via authenticated TLS/STARTTLS SMTP with strict timeouts.
//
// Phase 3.6 Hardening:
//   - Strict origin allowlist rejection (403 on disallowed Origin).
//   - Fail-closed 503 on EVERY rate-limit RPC error or malformed response.
//   - Atomic failed-login counter & lockout via `record_admin_failed_login` RPC.
//   - Minimum response timing floor on 401 failures (narrows L-04 timing diff).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  LOGIN_MAX_FAILED_ATTEMPTS,
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

const GENERIC_AUTH_ERROR = 'Invalid administrator credentials.';
const MIN_AUTH_FAILURE_DURATION_MS = 250;

async function enforceMinimumFailureDuration(startedAtMs: number): Promise<void> {
  const elapsed = Date.now() - startedAtMs;
  if (elapsed < MIN_AUTH_FAILURE_DURATION_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_AUTH_FAILURE_DURATION_MS - elapsed)
    );
  }
}

Deno.serve(async (req: Request) => {
  const startedAtMs = Date.now();

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
          'Server-side Email OTP authentication is not fully configured on the backend.',
      },
      503
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonAdminResponse(req, { error: 'Invalid request payload.' }, 400);
  }

  const cleanEmail = (body.email || '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (
    !cleanEmail ||
    !password ||
    cleanEmail.length > 254 ||
    password.length > 256 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
  ) {
    await enforceMinimumFailureDuration(startedAtMs);
    return jsonAdminResponse(req, { error: GENERIC_AUTH_ERROR }, 401);
  }

  const serviceClient = createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const ipHash = await extractAnonymizedIpHash(req, env.otpPepper);

  // 1. Server-side IP rate limit (max 15 login attempts per 15 minutes) — FAIL CLOSED
  const { data: ipLimitData, error: ipLimitErr } = await serviceClient.rpc(
    'check_admin_auth_rate_limit',
    {
      p_bucket_key: `initiate:ip:${ipHash}`,
      p_window_seconds: 900,
      p_max_requests: 15,
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
        error: `Too many authentication attempts. Please try again in ${Math.max(
          1,
          Math.ceil((ipLimit.retry_after_seconds || 60) / 60)
        )} minute(s).`,
      },
      429
    );
  }

  // 2. Verify caller targets the single designated owner account (no public signup)
  const { data: adminProfile, error: profileError } = await serviceClient
    .from('admin_profiles')
    .select('id, email, role, failed_login_attempts, locked_until')
    .eq('email', cleanEmail)
    .eq('role', 'owner')
    .maybeSingle();

  if (profileError || !adminProfile) {
    await enforceMinimumFailureDuration(startedAtMs);
    return jsonAdminResponse(req, { error: GENERIC_AUTH_ERROR }, 401);
  }

  const nowMs = Date.now();
  if (
    adminProfile.locked_until &&
    new Date(adminProfile.locked_until).getTime() > nowMs
  ) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Too many failed attempts. Administrator sign-in is temporarily locked.',
      },
      429
    );
  }

  // 3. Verify password server-side using a disposable Auth client and IMMEDIATELY discard tokens
  const disposableAuthClient = createClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: signInData, error: signInError } =
    await disposableAuthClient.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

  // Immediately revoke/discard any short-lived pre-OTP session token
  if (signInData?.session?.access_token) {
    await serviceClient.auth.admin
      .signOut(signInData.session.access_token, 'local')
      .catch(() => {});
  }

  if (
    signInError ||
    !signInData?.user ||
    signInData.user.id !== adminProfile.id
  ) {
    // M-01: Atomic server-side failure increment & lockout via FOR UPDATE RPC
    const { data: failRows, error: failErr } = await serviceClient.rpc(
      'record_admin_failed_login',
      {
        p_admin_id: adminProfile.id,
        p_max_attempts: LOGIN_MAX_FAILED_ATTEMPTS,
        p_lockout_minutes: 15,
        p_ip_hash: ipHash,
      }
    );

    if (failErr) {
      return jsonAdminResponse(
        req,
        { error: 'Authentication service is temporarily unavailable.' },
        503
      );
    }

    const failResult = Array.isArray(failRows) ? failRows[0] : failRows;
    const isLocked = failResult?.locked === true;

    if (!isLocked) {
      await enforceMinimumFailureDuration(startedAtMs);
    }

    return jsonAdminResponse(
      req,
      {
        error: isLocked
          ? 'Too many failed attempts. Administrator sign-in is temporarily locked.'
          : GENERIC_AUTH_ERROR,
      },
      isLocked ? 429 : 401
    );
  }

  // 4. Rolling OTP issuance rate limit (max 5 OTP emails per 15 minutes) — FAIL CLOSED
  const { data: issueLimitData, error: issueLimitErr } = await serviceClient.rpc(
    'check_admin_auth_rate_limit',
    {
      p_bucket_key: `otp_issue:${adminProfile.id}`,
      p_window_seconds: 900,
      p_max_requests: 5,
    }
  );
  const issueLimit = Array.isArray(issueLimitData)
    ? issueLimitData[0]
    : issueLimitData;

  if (issueLimitErr || !issueLimit || typeof issueLimit.allowed !== 'boolean') {
    return jsonAdminResponse(
      req,
      { error: 'Authentication service is temporarily unavailable.' },
      503
    );
  }

  if (issueLimit.allowed === false) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Too many verification codes requested recently. Please wait before trying again.',
      },
      429
    );
  }

  // 5. Reset failed login counter & invalidate all previous active challenges
  await serviceClient
    .from('admin_profiles')
    .update({
      failed_login_attempts: 0,
      locked_until: null,
      otp_verified_until: null,
    })
    .eq('id', adminProfile.id)
    .eq('role', 'owner');

  await serviceClient
    .from('admin_otp_challenges')
    .update({ used: true })
    .eq('admin_id', adminProfile.id)
    .eq('used', false);

  // 6. Generate CSPRNG 6-digit OTP + challenge token; persist ONLY secure hashes
  const challengeId = crypto.randomUUID();
  const otpCode = generateSecureSixDigitOtp();
  const challengeToken = generateChallengeToken();
  const [otpHash, challengeTokenHash] = await Promise.all([
    computeServerOtpHash(env.otpPepper, challengeId, otpCode),
    sha256Hex(challengeToken),
  ]);

  const expiresAtIso = new Date(nowMs + OTP_EXPIRY_MS).toISOString();
  const resendAvailableAtIso = new Date(
    nowMs + OTP_RESEND_COOLDOWN_MS
  ).toISOString();

  const { error: insertError } = await serviceClient
    .from('admin_otp_challenges')
    .insert({
      id: challengeId,
      admin_id: adminProfile.id,
      otp_hash: otpHash,
      challenge_token_hash: challengeTokenHash,
      expires_at: expiresAtIso,
      used: false,
      attempt_count: 0,
      max_attempts: OTP_MAX_ATTEMPTS,
      resend_available_at: resendAvailableAtIso,
      ip_hash: ipHash,
    });

  if (insertError) {
    return jsonAdminResponse(
      req,
      { error: 'Unable to create verification challenge. Please try again.' },
      500
    );
  }

  // 7. Dispatch 6-digit OTP via SMTP; invalidate challenge immediately if SMTP fails or times out
  try {
    await sendAdminOtpEmailViaSmtp({
      config: smtpConfig,
      toEmail: adminProfile.email,
      otpCode,
      expiresInMinutes: Math.round(OTP_EXPIRY_MS / 60000),
    });
  } catch {
    await serviceClient
      .from('admin_otp_challenges')
      .update({ used: true })
      .eq('id', challengeId);

    return jsonAdminResponse(
      req,
      {
        error:
          'Unable to dispatch verification email right now. Please verify SMTP configuration and try again.',
      },
      503
    );
  }

  await serviceClient.from('security_events').insert([
    {
      event_type: 'ADMIN_PASSWORD_VERIFIED',
      actor: adminProfile.email,
      details:
        'Primary password verified server-side. No session released prior to Email OTP.',
      ip_hash: ipHash,
    },
    {
      event_type: 'ADMIN_OTP_ISSUED',
      actor: adminProfile.email,
      details: `Server-side 6-digit Email OTP challenge ${challengeId} dispatched (expires in 5 minutes).`,
      ip_hash: ipHash,
    },
  ]);

  // NEVER return access_token, refresh_token, or plaintext OTP!
  return jsonAdminResponse(
    req,
    {
      challengeId,
      challengeToken,
      email: adminProfile.email,
      expiresAt: expiresAtIso,
      resendAvailableAt: resendAvailableAtIso,
      maxAttempts: OTP_MAX_ATTEMPTS,
    },
    200
  );
});
