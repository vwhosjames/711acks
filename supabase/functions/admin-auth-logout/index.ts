// =============================================================================
// 711ACKS — SUPABASE EDGE FUNCTION: admin-auth-logout
// =============================================================================
// Revokes an administrator's verified OTP state server-side (`otp_verified_until
// = null`), invalidates any active OTP challenges, and revokes the Supabase Auth
// session globally so replayed JWTs are immediately rejected by
// `public.is_verified_admin()`.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  getRequiredAdminAuthEnv,
  handleAdminPreflight,
  jsonAdminResponse,
  rejectIfDisallowedOrigin,
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
      { error: 'Authentication backend is not configured.' },
      503
    );
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonAdminResponse(
      req,
      { error: 'Unauthorized: Missing bearer token.' },
      401
    );
  }

  const jwt = authHeader.slice('Bearer '.length).trim();
  const userClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonAdminResponse(
      req,
      { error: 'Unauthorized: Invalid or expired session.' },
      401
    );
  }

  let body: { eventType?: string; reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const eventType =
    body.eventType === 'ADMIN_SESSION_TIMEOUT'
      ? 'ADMIN_SESSION_TIMEOUT'
      : 'ADMIN_LOGOUT';
  const details =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : 'Administrator signed out.';

  const serviceClient = createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Immediately clear otp_verified_until & invalidate active OTP challenges
  await serviceClient.rpc('revoke_admin_otp_session', {
    p_admin_id: user.id,
    p_event_type: eventType,
    p_details: details,
  });

  // Globally revoke Supabase Auth refresh/access tokens for this session
  await serviceClient.auth.admin.signOut(jwt, 'global').catch(() => {});

  return jsonAdminResponse(req, { success: true }, 200);
});
