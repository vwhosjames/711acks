// =============================================================================
// 711ACKS — SUPABASE EDGE FUNCTION: admin-auth-complete-recovery (M-04)
// =============================================================================
// Completes live-mode owner password recovery server-side while preserving
// `detectSessionInUrl: false` and `persistSession: false` in the browser.
//
// SECURITY GUARANTEES:
//   1. Strict origin allowlist validation (403 on disallowed Origin) + no-store.
//   2. Fail-closed IP rate limiting (`recovery:ip:<hash>`, 10 / 15 min).
//   3. Validates the recovery proof (`tokenHash` via `verifyOtp({ type: 'recovery' })`
//      OR recovery `accessToken` via `getUser()`) strictly on a disposable
//      server-side client — NEVER releases an authenticated session to the browser.
//   4. Confirms the recovered account is the single designated `owner` in
//      `public.admin_profiles` (never creates accounts; never permits non-owners).
//   5. Enforces strong password policy before calling `auth.admin.updateUserById`.
//   6. Immediately revokes `otp_verified_until`, invalidates all active OTP
//      challenges, resets lockout counters, and globally revokes the recovery
//      session (`auth.admin.signOut(token, 'global')`) so the owner MUST perform
//      a fresh Step 1 (new password) + Step 2 (6-digit Email OTP) login.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  extractAnonymizedIpHash,
  getRequiredAdminAuthEnv,
  handleAdminPreflight,
  jsonAdminResponse,
  rejectIfDisallowedOrigin,
} from '../_shared/adminAuthShared.ts';

function validateStrongAdminPassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < 12) {
    return 'New password must be at least 12 characters long.';
  }
  if (password.length > 256) {
    return 'New password must not exceed 256 characters.';
  }
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return 'New password must include uppercase, lowercase, a number, and a symbol.';
  }
  return null;
}

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
      { error: 'Password recovery backend is not configured.' },
      503
    );
  }

  let body: {
    tokenHash?: string;
    accessToken?: string;
    newPassword?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonAdminResponse(req, { error: 'Invalid request payload.' }, 400);
  }

  const tokenHash = typeof body.tokenHash === 'string' ? body.tokenHash.trim() : '';
  const accessToken =
    typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const newPassword =
    typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!tokenHash && !accessToken) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Recovery link token is missing or invalid. Please request a new password recovery email.',
      },
      400
    );
  }

  const passwordError = validateStrongAdminPassword(newPassword);
  if (passwordError) {
    return jsonAdminResponse(req, { error: passwordError }, 400);
  }

  const serviceClient = createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const ipHash = await extractAnonymizedIpHash(req, env.otpPepper);

  // 1. Fail-closed IP rate limit (max 10 recovery completions per 15 minutes)
  const { data: limitData, error: limitErr } = await serviceClient.rpc(
    'check_admin_auth_rate_limit',
    {
      p_bucket_key: `recovery:ip:${ipHash}`,
      p_window_seconds: 900,
      p_max_requests: 10,
    }
  );

  const limitRow = Array.isArray(limitData) ? limitData[0] : limitData;
  if (limitErr || !limitRow || typeof limitRow.allowed !== 'boolean') {
    return jsonAdminResponse(
      req,
      { error: 'Authentication service is temporarily unavailable.' },
      503
    );
  }

  if (limitRow.allowed === false) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Too many password recovery attempts. Please wait before trying again.',
      },
      429
    );
  }

  // 2. Validate the recovery token strictly on a disposable server-side client
  const disposableClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let verifiedUserId: string | null = null;
  let disposableSessionToken: string | null = null;

  if (tokenHash) {
    const { data, error } = await disposableClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'recovery',
    });
    if (error || !data?.user?.id) {
      return jsonAdminResponse(
        req,
        {
          error:
            'This password recovery link is invalid or has expired. Please request a new recovery email.',
        },
        401
      );
    }
    verifiedUserId = data.user.id;
    disposableSessionToken = data.session?.access_token ?? null;
  } else {
    const { data, error } = await disposableClient.auth.getUser(accessToken);
    if (error || !data?.user?.id) {
      return jsonAdminResponse(
        req,
        {
          error:
            'This password recovery link is invalid or has expired. Please request a new recovery email.',
        },
        401
      );
    }
    verifiedUserId = data.user.id;
    disposableSessionToken = accessToken;
  }

  // Helper to guarantee any disposable recovery token is revoked globally
  const revokeDisposableToken = async () => {
    if (disposableSessionToken) {
      await serviceClient.auth.admin
        .signOut(disposableSessionToken, 'global')
        .catch(() => {});
    }
  };

  // 3. Verify the recovered account is the single designated owner administrator
  const { data: ownerProfile, error: ownerErr } = await serviceClient
    .from('admin_profiles')
    .select('id, email, role')
    .eq('id', verifiedUserId)
    .eq('role', 'owner')
    .maybeSingle();

  if (ownerErr || !ownerProfile) {
    await revokeDisposableToken();
    return jsonAdminResponse(
      req,
      { error: 'Unauthorized password recovery request.' },
      403
    );
  }

  // 4. Update owner password via Supabase Admin API
  const { error: updateErr } = await serviceClient.auth.admin.updateUserById(
    ownerProfile.id,
    { password: newPassword }
  );

  if (updateErr) {
    await revokeDisposableToken();
    return jsonAdminResponse(
      req,
      { error: 'Unable to update administrator password. Please try again.' },
      500
    );
  }

  // 5. Revoke all OTP sessions, invalidate pending OTP challenges, reset lockout,
  //    and globally revoke the recovery token so mandatory Password + 6-digit OTP
  //    sign-in is strictly required before entering the Admin Console.
  await serviceClient.rpc('revoke_admin_otp_session', {
    p_admin_id: ownerProfile.id,
    p_event_type: 'ADMIN_LOGOUT',
    p_details:
      'Owner password updated via verified recovery flow. All sessions and OTP states revoked; fresh login + Email OTP required.',
  });

  await serviceClient
    .from('admin_profiles')
    .update({
      failed_login_attempts: 0,
      locked_until: null,
      otp_verified_until: null,
    })
    .eq('id', ownerProfile.id)
    .eq('role', 'owner');

  await revokeDisposableToken();

  // NEVER return access_token, refresh_token, or any authenticated session!
  return jsonAdminResponse(
    req,
    {
      success: true,
      message:
        'Password updated successfully. Sign in with your new password and complete 6-digit Email OTP verification.',
    },
    200
  );
});
