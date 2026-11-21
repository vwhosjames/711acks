import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseRepositoryError,
  isUnauthorizedSupabaseError,
  requireSupabaseClient,
} from './supabaseRepository';

export const ADMIN_AUTH_EDGE_FUNCTIONS = {
  INITIATE: 'admin-auth-initiate',
  RESEND: 'admin-auth-resend',
  VERIFY: 'admin-auth-verify',
  LOGOUT: 'admin-auth-logout',
  COMPLETE_RECOVERY: 'admin-auth-complete-recovery',
} as const;

export const ADMIN_OTP_EXPIRY_MS = 5 * 60 * 1000;
export const ADMIN_OTP_RESEND_COOLDOWN_MS = 30 * 1000;
export const ADMIN_OTP_MAX_ATTEMPTS = 5;
export const ADMIN_LOGIN_MAX_FAILURES = 5;
export const ADMIN_LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
export const ADMIN_OTP_DEFAULT_VALIDITY_MINUTES = 120;

export interface LiveOtpChallengeResponse {
  challengeId: string;
  challengeToken: string;
  email: string;
  expiresAt: string;
  resendAvailableAt: string;
  maxAttempts: number;
}

export interface LiveVerifiedSessionResponse {
  session: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
  };
  admin: {
    email: string;
    otpVerifiedUntil: string;
    lastActiveAt: string;
    sessionTimeoutMinutes: number;
  };
}

export interface PendingPasswordRecovery {
  tokenHash?: string;
  accessToken?: string;
  detectedAt: number;
}

// =============================================================================
// CRYPTOGRAPHIC OTP HELPERS (MIRRORING EDGE FUNCTION _shared/adminAuthShared.ts)
// =============================================================================

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Cryptographically secure 6-digit numeric OTP using rejection sampling
 * (zero modulo bias, Web Crypto CSPRNG).
 */
export function generateSecureSixDigitOtp(): string {
  const MAX_UNBIASED = 4_294_000_000;
  const buf = new Uint32Array(1);
  while (true) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < MAX_UNBIASED) {
      return (buf[0] % 1_000_000).toString().padStart(6, '0');
    }
  }
}

export function generateOpaqueChallengeToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function computeServerOtpHash(
  pepper: string,
  challengeId: string,
  otpCode: string
): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${challengeId}:${otpCode}`)
  );
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Constant-time string comparison without short-circuiting on content mismatch.
 */
export function constantTimeHexEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a);
  const bytesB = new TextEncoder().encode(b);
  const maxLen = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < maxLen; i++) {
    const ba = i < bytesA.length ? bytesA[i] : 0;
    const bb = i < bytesB.length ? bytesB[i] : 0;
    diff |= ba ^ bb;
  }
  return diff === 0;
}

/**
 * Exact TypeScript equivalent of hardened PostgreSQL `public.is_verified_admin()`
 * from migrations 001 + 002 + 006 (L-02: treats `last_active_at IS NULL` as inactive).
 */
export function evaluateIsVerifiedAdmin(params: {
  callerAuthUid: string | null;
  profile: {
    id: string;
    role: string;
    otpVerifiedUntilMs: number | null;
    lastActiveAtMs: number | null;
    lockedUntilMs: number | null;
  } | null;
  sessionTimeoutMinutes: number;
  nowMs: number;
}): boolean {
  const { callerAuthUid, profile, sessionTimeoutMinutes, nowMs } = params;
  if (!callerAuthUid || !profile) return false;
  if (profile.id !== callerAuthUid) return false;
  if (profile.role !== 'owner') return false;
  if (profile.lockedUntilMs !== null && profile.lockedUntilMs > nowMs) {
    return false;
  }
  if (
    profile.otpVerifiedUntilMs === null ||
    profile.otpVerifiedUntilMs <= nowMs
  ) {
    return false;
  }
  if (profile.lastActiveAtMs === null) {
    return false;
  }
  const timeoutMs = Math.max(5, sessionTimeoutMinutes || 30) * 60 * 1000;
  if (profile.lastActiveAtMs <= nowMs - timeoutMs) {
    return false;
  }
  return true;
}

// =============================================================================
// H-01: NON-OPTIMISTIC SERVER-CONFIRMED ADMIN HEARTBEAT CONTROLLER
// =============================================================================

export interface AdminHeartbeatResult {
  status: 'confirmed' | 'expired' | 'transient_error';
  serverNowMs?: number;
  confirmedExpiresAtMs?: number;
}

/**
 * Executes a server-side `touch_admin_activity` heartbeat WITHOUT optimistically
 * extending the local countdown prior to server confirmation.
 * Automatically triggers `onExpired` when the server rejects the session with
 * PostgreSQL `P0001` (`UNAUTHORIZED: ...`), `PGRST301`, `42501`, or HTTP 401/403.
 */
export async function performAdminActivityHeartbeat(params: {
  touchServer: () => Promise<string>;
  otpVerifiedUntilMs?: number;
  sessionTimeoutMinutes: number;
  onConfirmed: (serverNowMs: number, confirmedExpiresAtMs: number) => void;
  onExpired: (reason: string, auditDetails: string) => void;
}): Promise<AdminHeartbeatResult> {
  try {
    const serverIso = await params.touchServer();
    const parsedServerMs = Date.parse(serverIso);
    const serverNowMs = Number.isFinite(parsedServerMs)
      ? parsedServerMs
      : Date.now();
    const timeoutMs = Math.max(5, params.sessionTimeoutMinutes || 30) * 60 * 1000;
    const confirmedExpiresAtMs =
      typeof params.otpVerifiedUntilMs === 'number'
        ? Math.min(params.otpVerifiedUntilMs, serverNowMs + timeoutMs)
        : serverNowMs + timeoutMs;

    params.onConfirmed(serverNowMs, confirmedExpiresAtMs);
    return { status: 'confirmed', serverNowMs, confirmedExpiresAtMs };
  } catch (err) {
    if (isUnauthorizedSupabaseError(err)) {
      params.onExpired(
        'Your server-side verification or 30-minute inactivity window has expired. Please sign in again.',
        'Server rejected activity refresh because is_verified_admin() returned false.'
      );
      return { status: 'expired' };
    }
    return { status: 'transient_error' };
  }
}

// =============================================================================
// M-04: RECOVERY LINK PARSING & PASSWORD POLICY (COMPATIBLE WITH detectSessionInUrl: false)
// =============================================================================

export function validateNewAdminPassword(password: string): string | null {
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

/**
 * Safely parses a Supabase password recovery redirect URL on `/admin` without
 * enabling `detectSessionInUrl` or hydrating any authenticated browser session.
 * Supports both token_hash recovery links (`?token_hash=...&type=recovery`) and
 * implicit hash recovery links (`#access_token=...&type=recovery`).
 */
export function parsePasswordRecoveryUrl(locationLike: {
  pathname: string;
  search: string;
  hash: string;
}): PendingPasswordRecovery | null {
  const pathname = (locationLike.pathname || '').replace(/\/+$/, '') || '/';
  if (pathname !== '/admin') {
    return null;
  }

  const queryParams = new URLSearchParams(
    locationLike.search.startsWith('?')
      ? locationLike.search.slice(1)
      : locationLike.search
  );
  const hashParams = new URLSearchParams(
    locationLike.hash.startsWith('#')
      ? locationLike.hash.slice(1)
      : locationLike.hash
  );

  const queryType = queryParams.get('type')?.trim().toLowerCase();
  const hashType = hashParams.get('type')?.trim().toLowerCase();
  const isRecoveryType = queryType === 'recovery' || hashType === 'recovery';

  if (!isRecoveryType) {
    return null;
  }

  const tokenHash =
    queryParams.get('token_hash')?.trim() ||
    hashParams.get('token_hash')?.trim() ||
    '';
  if (tokenHash && tokenHash.length >= 16 && tokenHash.length <= 512) {
    return {
      tokenHash,
      detectedAt: Date.now(),
    };
  }

  const accessToken = hashParams.get('access_token')?.trim() || '';
  if (
    accessToken &&
    accessToken.split('.').length === 3 &&
    accessToken.length <= 4096
  ) {
    return {
      accessToken,
      detectedAt: Date.now(),
    };
  }

  return null;
}

// =============================================================================
// TESTABLE SERVER-SIDE AUTH ORCHESTRATION ENGINE (MIRRORS EDGE FUNCTIONS)
// =============================================================================

export interface MockAdminProfileRecord {
  id: string;
  email: string;
  role: string;
  otpVerifiedUntilMs: number | null;
  lastActiveAtMs: number | null;
  failedLoginAttempts: number;
  lockedUntilMs: number | null;
}

export interface MockOtpChallengeRecord {
  id: string;
  adminId: string;
  otpHash: string;
  challengeTokenHash: string;
  expiresAtMs: number;
  used: boolean;
  attemptCount: number;
  maxAttempts: number;
  resendAvailableAtMs: number;
}

export interface AdminAuthServerAdapters {
  now: () => number;
  pepper: string;
  otpValidityMinutes?: number;
  sessionTimeoutMinutes?: number;
  checkRateLimit: (
    bucketKey: string,
    windowSeconds: number,
    maxRequests: number
  ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  findOwnerByEmail: (email: string) => Promise<MockAdminProfileRecord | null>;
  findOwnerById: (id: string) => Promise<MockAdminProfileRecord | null>;
  verifyPasswordServerSide: (
    email: string,
    password: string
  ) => Promise<{ ok: true; userId: string } | { ok: false }>;
  recordFailedLoginAtomic?: (
    adminId: string,
    maxAttempts: number,
    lockoutMs: number
  ) => Promise<{ locked: boolean; failedAttempts: number; lockedUntilMs: number | null }>;
  updateAdminProfile: (
    id: string,
    patch: Partial<MockAdminProfileRecord>
  ) => Promise<void>;
  invalidateActiveChallengesForAdmin: (adminId: string) => Promise<void>;
  insertChallenge: (record: MockOtpChallengeRecord) => Promise<void>;
  findChallengeById: (id: string) => Promise<MockOtpChallengeRecord | null>;
  updateChallenge: (
    id: string,
    patch: Partial<MockOtpChallengeRecord>
  ) => Promise<void>;
  rotateChallengeForResendAtomic?: (params: {
    oldChallengeId: string;
    oldTokenHash: string;
    newChallenge: MockOtpChallengeRecord;
  }) => Promise<
    | { ok: true; admin: MockAdminProfileRecord }
    | {
        ok: false;
        status: number;
        code: string;
        error: string;
        challengeInvalidated: boolean;
        retryAfterSeconds?: number;
      }
  >;
  sendOtpEmail: (params: {
    toEmail: string;
    otpCode: string;
    expiresInMinutes: number;
  }) => Promise<void>;
  mintPostOtpSession: (
    adminId: string,
    adminEmail: string
  ) => Promise<{ access_token: string; refresh_token: string; expires_at: number }>;
  verifyRecoveryTokenServerSide?: (params: {
    tokenHash?: string;
    accessToken?: string;
  }) => Promise<{ ok: true; userId: string; disposableToken: string } | { ok: false }>;
  updateOwnerPasswordServerSide?: (
    adminId: string,
    newPassword: string
  ) => Promise<void>;
  revokeSupabaseAuthSession?: (adminId: string) => Promise<void>;
  logSecurityEvent?: (eventType: string, actor: string, details: string) => Promise<void>;
}

async function safeCheckRateLimit(
  adapters: AdminAuthServerAdapters,
  bucketKey: string,
  windowSeconds: number,
  maxRequests: number
): Promise<
  | { ok: true; allowed: boolean; retryAfterSeconds: number }
  | { ok: false; status: 503; error: string }
> {
  try {
    const res = await adapters.checkRateLimit(bucketKey, windowSeconds, maxRequests);
    if (!res || typeof res.allowed !== 'boolean') {
      return {
        ok: false,
        status: 503,
        error: 'Authentication service is temporarily unavailable.',
      };
    }
    return {
      ok: true,
      allowed: res.allowed,
      retryAfterSeconds: res.retryAfterSeconds ?? 60,
    };
  } catch {
    // M-01: Fail closed on any rate-limit RPC error
    return {
      ok: false,
      status: 503,
      error: 'Authentication service is temporarily unavailable.',
    };
  }
}

export async function executeAdminAuthInitiate(
  input: { email: string; password: string; ipKey: string },
  adapters: AdminAuthServerAdapters
): Promise<
  | { ok: true; status: 200; data: LiveOtpChallengeResponse }
  | { ok: false; status: number; error: string }
> {
  const GENERIC_ERR = 'Invalid administrator credentials.';
  const cleanEmail = input.email.trim().toLowerCase();
  if (!cleanEmail || !input.password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, status: 401, error: GENERIC_ERR };
  }

  const ipLimit = await safeCheckRateLimit(
    adapters,
    `initiate:ip:${input.ipKey}`,
    900,
    15
  );
  if (!ipLimit.ok) return ipLimit;
  if (!ipLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many authentication attempts. Please try again later.',
    };
  }

  const profile = await adapters.findOwnerByEmail(cleanEmail);
  if (!profile || profile.role !== 'owner') {
    return { ok: false, status: 401, error: GENERIC_ERR };
  }

  const nowMs = adapters.now();
  if (profile.lockedUntilMs !== null && profile.lockedUntilMs > nowMs) {
    return {
      ok: false,
      status: 429,
      error:
        'Too many failed attempts. Administrator sign-in is temporarily locked.',
    };
  }

  const pwRes = await adapters.verifyPasswordServerSide(cleanEmail, input.password);
  if (!pwRes.ok || pwRes.userId !== profile.id) {
    let shouldLock = false;
    if (adapters.recordFailedLoginAtomic) {
      const atomicFail = await adapters.recordFailedLoginAtomic(
        profile.id,
        ADMIN_LOGIN_MAX_FAILURES,
        ADMIN_LOGIN_LOCKOUT_MS
      );
      shouldLock = atomicFail.locked;
    } else {
      const nextFailures =
        profile.lockedUntilMs !== null && profile.lockedUntilMs <= nowMs
          ? 1
          : profile.failedLoginAttempts + 1;
      shouldLock = nextFailures >= ADMIN_LOGIN_MAX_FAILURES;
      await adapters.updateAdminProfile(profile.id, {
        failedLoginAttempts: nextFailures,
        lockedUntilMs: shouldLock ? nowMs + ADMIN_LOGIN_LOCKOUT_MS : null,
      });
    }

    await adapters.logSecurityEvent?.(
      shouldLock ? 'ADMIN_LOCKOUT_TRIGGERED' : 'ADMIN_LOGIN_FAILED',
      profile.email,
      shouldLock ? 'Lockout triggered.' : 'Invalid password.'
    );
    return {
      ok: false,
      status: shouldLock ? 429 : 401,
      error: shouldLock
        ? 'Too many failed attempts. Administrator sign-in is temporarily locked.'
        : GENERIC_ERR,
    };
  }

  const issueLimit = await safeCheckRateLimit(
    adapters,
    `otp_issue:${profile.id}`,
    900,
    5
  );
  if (!issueLimit.ok) return issueLimit;
  if (!issueLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error:
        'Too many verification codes requested recently. Please wait before trying again.',
    };
  }

  // Clear any prior OTP verification until new OTP completes
  await adapters.updateAdminProfile(profile.id, {
    failedLoginAttempts: 0,
    lockedUntilMs: null,
    otpVerifiedUntilMs: null,
  });
  await adapters.invalidateActiveChallengesForAdmin(profile.id);

  const challengeId = globalThis.crypto.randomUUID();
  const otpCode = generateSecureSixDigitOtp();
  const challengeToken = generateOpaqueChallengeToken();
  const [otpHash, challengeTokenHash] = await Promise.all([
    computeServerOtpHash(adapters.pepper, challengeId, otpCode),
    sha256Hex(challengeToken),
  ]);

  const expiresAtMs = nowMs + ADMIN_OTP_EXPIRY_MS;
  const resendAvailableAtMs = nowMs + ADMIN_OTP_RESEND_COOLDOWN_MS;

  await adapters.insertChallenge({
    id: challengeId,
    adminId: profile.id,
    otpHash,
    challengeTokenHash,
    expiresAtMs,
    used: false,
    attemptCount: 0,
    maxAttempts: ADMIN_OTP_MAX_ATTEMPTS,
    resendAvailableAtMs,
  });

  try {
    await adapters.sendOtpEmail({
      toEmail: profile.email,
      otpCode,
      expiresInMinutes: 5,
    });
  } catch {
    await adapters.updateChallenge(challengeId, { used: true });
    return {
      ok: false,
      status: 503,
      error:
        'Unable to dispatch verification email right now. Please verify SMTP configuration and try again.',
    };
  }

  return {
    ok: true,
    status: 200,
    data: {
      challengeId,
      challengeToken,
      email: profile.email,
      expiresAt: new Date(expiresAtMs).toISOString(),
      resendAvailableAt: new Date(resendAvailableAtMs).toISOString(),
      maxAttempts: ADMIN_OTP_MAX_ATTEMPTS,
    },
  };
}

export async function executeAdminAuthResend(
  input: { challengeId: string; challengeToken: string; ipKey?: string },
  adapters: AdminAuthServerAdapters
): Promise<
  | { ok: true; status: 200; data: LiveOtpChallengeResponse }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string;
      challengeInvalidated?: boolean;
      retryAfterSeconds?: number;
    }
> {
  // M-02: Fail-closed IP rate limit before touching challenges
  const ipLimit = await safeCheckRateLimit(
    adapters,
    `resend:ip:${input.ipKey ?? 'default-ip'}`,
    900,
    10
  );
  if (!ipLimit.ok) return ipLimit;
  if (!ipLimit.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      error:
        'Too many verification code resend attempts. Please wait and try again.',
      retryAfterSeconds: ipLimit.retryAfterSeconds,
      challengeInvalidated: false,
    };
  }

  const nowMs = adapters.now();
  const newChallengeId = globalThis.crypto.randomUUID();
  const otpCode = generateSecureSixDigitOtp();
  const newToken = generateOpaqueChallengeToken();
  const [oldTokenHash, otpHash, challengeTokenHash] = await Promise.all([
    sha256Hex(input.challengeToken),
    computeServerOtpHash(adapters.pepper, newChallengeId, otpCode),
    sha256Hex(newToken),
  ]);

  const expiresAtMs = nowMs + ADMIN_OTP_EXPIRY_MS;
  const resendAvailableAtMs = nowMs + ADMIN_OTP_RESEND_COOLDOWN_MS;

  const newChallengeRecord: MockOtpChallengeRecord = {
    id: newChallengeId,
    adminId: '',
    otpHash,
    challengeTokenHash,
    expiresAtMs,
    used: false,
    attemptCount: 0,
    maxAttempts: ADMIN_OTP_MAX_ATTEMPTS,
    resendAvailableAtMs,
  };

  let adminEmail: string;

  if (adapters.rotateChallengeForResendAtomic) {
    const rotation = await adapters.rotateChallengeForResendAtomic({
      oldChallengeId: input.challengeId,
      oldTokenHash,
      newChallenge: newChallengeRecord,
    });
    if (!rotation.ok) {
      return rotation;
    }
    adminEmail = rotation.admin.email;
  } else {
    const existing = await adapters.findChallengeById(input.challengeId);
    if (
      !existing ||
      existing.used ||
      !constantTimeHexEqual(existing.challengeTokenHash, oldTokenHash)
    ) {
      return {
        ok: false,
        status: 401,
        code: existing?.used ? 'CHALLENGE_ALREADY_USED' : 'CHALLENGE_NOT_FOUND',
        error: 'Verification challenge is no longer active. Please sign in again.',
        challengeInvalidated: true,
      };
    }

    if (nowMs >= existing.expiresAtMs) {
      await adapters.updateChallenge(existing.id, { used: true });
      return {
        ok: false,
        status: 401,
        code: 'CHALLENGE_EXPIRED',
        error: 'Verification challenge has expired. Please sign in again.',
        challengeInvalidated: true,
      };
    }

    if (nowMs < existing.resendAvailableAtMs) {
      const waitSec = Math.max(
        1,
        Math.ceil((existing.resendAvailableAtMs - nowMs) / 1000)
      );
      return {
        ok: false,
        status: 429,
        code: 'COOLDOWN_ACTIVE',
        error: `Please wait ${waitSec}s before requesting a new verification code.`,
        retryAfterSeconds: waitSec,
        challengeInvalidated: false,
      };
    }

    const profile = await adapters.findOwnerById(existing.adminId);
    if (!profile || profile.role !== 'owner') {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED_ADMIN',
        error: 'Verification challenge is no longer active. Please sign in again.',
        challengeInvalidated: true,
      };
    }

    if (profile.lockedUntilMs !== null && profile.lockedUntilMs > nowMs) {
      return {
        ok: false,
        status: 429,
        code: 'ACCOUNT_LOCKED',
        error: 'Administrator sign-in is temporarily locked.',
        challengeInvalidated: true,
      };
    }

    const issueLimit = await safeCheckRateLimit(
      adapters,
      `otp_issue:${profile.id}`,
      900,
      5
    );
    if (!issueLimit.ok) return issueLimit;
    if (!issueLimit.allowed) {
      return {
        ok: false,
        status: 429,
        code: 'RATE_LIMITED',
        error:
          'Too many verification codes requested recently. Please wait before trying again.',
        challengeInvalidated: false,
      };
    }

    await adapters.invalidateActiveChallengesForAdmin(profile.id);
    await adapters.insertChallenge({
      ...newChallengeRecord,
      adminId: profile.id,
    });
    adminEmail = profile.email;
  }

  try {
    await adapters.sendOtpEmail({
      toEmail: adminEmail,
      otpCode,
      expiresInMinutes: 5,
    });
  } catch {
    await adapters.updateChallenge(newChallengeId, { used: true });
    return {
      ok: false,
      status: 503,
      error: 'Unable to dispatch verification email right now.',
      challengeInvalidated: true,
    };
  }

  return {
    ok: true,
    status: 200,
    data: {
      challengeId: newChallengeId,
      challengeToken: newToken,
      email: adminEmail,
      expiresAt: new Date(expiresAtMs).toISOString(),
      resendAvailableAt: new Date(resendAvailableAtMs).toISOString(),
      maxAttempts: ADMIN_OTP_MAX_ATTEMPTS,
    },
  };
}

export async function executeAdminAuthVerify(
  input: {
    challengeId: string;
    challengeToken: string;
    otpCode: string;
    ipKey: string;
  },
  adapters: AdminAuthServerAdapters
): Promise<
  | { ok: true; status: 200; data: LiveVerifiedSessionResponse }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
      challengeInvalidated?: boolean;
      remainingAttempts?: number;
    }
> {
  if (!/^\d{6}$/.test(input.otpCode.trim())) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_OTP_FORMAT',
      error: 'Enter the 6-digit numeric verification code from your email.',
    };
  }

  const verifyLimit = await safeCheckRateLimit(
    adapters,
    `verify:ip:${input.ipKey}`,
    900,
    20
  );
  if (!verifyLimit.ok) {
    return {
      ok: false,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      error: verifyLimit.error,
    };
  }
  if (!verifyLimit.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      error: 'Too many verification attempts. Please wait and try again.',
    };
  }

  const challenge = await adapters.findChallengeById(input.challengeId);
  const tokenHash = await sha256Hex(input.challengeToken);

  if (!challenge) {
    return {
      ok: false,
      status: 401,
      code: 'CHALLENGE_NOT_FOUND',
      error:
        'This verification challenge is invalid or has already been used. Please sign in again.',
      challengeInvalidated: true,
    };
  }
  if (challenge.used) {
    return {
      ok: false,
      status: 401,
      code: 'CHALLENGE_ALREADY_USED',
      error:
        'This verification challenge is invalid or has already been used. Please sign in again.',
      challengeInvalidated: true,
    };
  }
  if (!constantTimeHexEqual(challenge.challengeTokenHash, tokenHash)) {
    return {
      ok: false,
      status: 401,
      code: 'INVALID_CHALLENGE_TOKEN',
      error:
        'This verification challenge is invalid or has already been used. Please sign in again.',
      challengeInvalidated: true,
    };
  }

  const nowMs = adapters.now();
  if (nowMs >= challenge.expiresAtMs) {
    await adapters.updateChallenge(challenge.id, { used: true });
    return {
      ok: false,
      status: 401,
      code: 'CHALLENGE_EXPIRED',
      error:
        'This one-time verification code has expired. Please sign in again.',
      challengeInvalidated: true,
    };
  }

  if (challenge.attemptCount >= challenge.maxAttempts) {
    await adapters.updateChallenge(challenge.id, { used: true });
    return {
      ok: false,
      status: 401,
      code: 'MAX_ATTEMPTS_EXCEEDED',
      error: 'Maximum verification attempts exceeded. Please sign in again.',
      challengeInvalidated: true,
    };
  }

  const profile = await adapters.findOwnerById(challenge.adminId);
  if (!profile || profile.role !== 'owner') {
    await adapters.updateChallenge(challenge.id, { used: true });
    return {
      ok: false,
      status: 403,
      code: 'UNAUTHORIZED_ADMIN',
      error: 'Unauthorized administrator account.',
      challengeInvalidated: true,
    };
  }

  const candidateOtpHash = await computeServerOtpHash(
    adapters.pepper,
    challenge.id,
    input.otpCode.trim()
  );

  if (!constantTimeHexEqual(challenge.otpHash, candidateOtpHash)) {
    const nextAttempts = challenge.attemptCount + 1;
    const exhausted = nextAttempts >= challenge.maxAttempts;
    await adapters.updateChallenge(challenge.id, {
      attemptCount: nextAttempts,
      used: exhausted,
    });
    const remaining = Math.max(0, challenge.maxAttempts - nextAttempts);
    return {
      ok: false,
      status: 401,
      code: exhausted ? 'MAX_ATTEMPTS_EXCEEDED' : 'INVALID_OTP',
      error: exhausted
        ? 'Maximum verification attempts exceeded. Please sign in again.'
        : `Invalid verification code. ${remaining} attempt(s) remaining.`,
      remainingAttempts: remaining,
      challengeInvalidated: exhausted,
    };
  }

  // Strictly single-use consumption BEFORE releasing session
  await adapters.updateChallenge(challenge.id, {
    used: true,
    attemptCount: challenge.attemptCount + 1,
  });
  await adapters.invalidateActiveChallengesForAdmin(profile.id);

  const validityMins = Math.max(
    15,
    Math.min(480, adapters.otpValidityMinutes ?? ADMIN_OTP_DEFAULT_VALIDITY_MINUTES)
  );
  const timeoutMins = Math.max(
    5,
    Math.min(240, adapters.sessionTimeoutMinutes ?? 30)
  );
  const otpVerifiedUntilMs = nowMs + validityMins * 60 * 1000;

  await adapters.updateAdminProfile(profile.id, {
    otpVerifiedUntilMs,
    lastActiveAtMs: nowMs,
    failedLoginAttempts: 0,
    lockedUntilMs: null,
  });

  const session = await adapters.mintPostOtpSession(profile.id, profile.email);

  return {
    ok: true,
    status: 200,
    data: {
      session,
      admin: {
        email: profile.email,
        otpVerifiedUntil: new Date(otpVerifiedUntilMs).toISOString(),
        lastActiveAt: new Date(nowMs).toISOString(),
        sessionTimeoutMinutes: timeoutMins,
      },
    },
  };
}

export async function executeAdminAuthLogout(
  input: { adminId: string; eventType: 'ADMIN_LOGOUT' | 'ADMIN_SESSION_TIMEOUT'; reason: string },
  adapters: Pick<
    AdminAuthServerAdapters,
    | 'updateAdminProfile'
    | 'invalidateActiveChallengesForAdmin'
    | 'revokeSupabaseAuthSession'
    | 'logSecurityEvent'
  >
): Promise<{ ok: true }> {
  await adapters.updateAdminProfile(input.adminId, {
    otpVerifiedUntilMs: null,
  });
  await adapters.invalidateActiveChallengesForAdmin(input.adminId);
  await adapters.revokeSupabaseAuthSession?.(input.adminId);
  await adapters.logSecurityEvent?.(input.eventType, input.adminId, input.reason);
  return { ok: true };
}

/**
 * M-04 testable server-side recovery completion orchestration.
 * Guarantees recovery NEVER mints a verified session, revokes all prior OTP/auth
 * sessions, and forces a full Password + 6-digit Email OTP login afterwards.
 */
export async function executeAdminPasswordRecovery(
  input: {
    tokenHash?: string;
    accessToken?: string;
    newPassword: string;
    ipKey: string;
  },
  adapters: AdminAuthServerAdapters
): Promise<
  | { ok: true; status: 200; message: string }
  | { ok: false; status: number; error: string }
> {
  if (!input.tokenHash && !input.accessToken) {
    return {
      ok: false,
      status: 400,
      error: 'Recovery link token is missing or invalid.',
    };
  }

  const pwError = validateNewAdminPassword(input.newPassword);
  if (pwError) {
    return { ok: false, status: 400, error: pwError };
  }

  const ipLimit = await safeCheckRateLimit(
    adapters,
    `recovery:ip:${input.ipKey}`,
    900,
    10
  );
  if (!ipLimit.ok) return ipLimit;
  if (!ipLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many password recovery attempts. Please wait before trying again.',
    };
  }

  if (!adapters.verifyRecoveryTokenServerSide || !adapters.updateOwnerPasswordServerSide) {
    return { ok: false, status: 503, error: 'Recovery backend unavailable.' };
  }

  const verified = await adapters.verifyRecoveryTokenServerSide({
    tokenHash: input.tokenHash,
    accessToken: input.accessToken,
  });
  if (!verified.ok) {
    return {
      ok: false,
      status: 401,
      error: 'This password recovery link is invalid or has expired.',
    };
  }

  const owner = await adapters.findOwnerById(verified.userId);
  if (!owner || owner.role !== 'owner') {
    await adapters.revokeSupabaseAuthSession?.(verified.userId);
    return {
      ok: false,
      status: 403,
      error: 'Unauthorized password recovery request.',
    };
  }

  await adapters.updateOwnerPasswordServerSide(owner.id, input.newPassword);
  await adapters.updateAdminProfile(owner.id, {
    otpVerifiedUntilMs: null,
    failedLoginAttempts: 0,
    lockedUntilMs: null,
  });
  await adapters.invalidateActiveChallengesForAdmin(owner.id);
  await adapters.revokeSupabaseAuthSession?.(owner.id);
  await adapters.logSecurityEvent?.(
    'ADMIN_LOGOUT',
    owner.email,
    'Owner password reset completed; all sessions revoked pending full OTP login.'
  );

  return {
    ok: true,
    status: 200,
    message:
      'Password updated successfully. Sign in with your new password and complete 6-digit Email OTP verification.',
  };
}

// =============================================================================
// BROWSER-SAFE EDGE FUNCTION INVOKERS (NO SERVICE-ROLE, NO DIRECT PASSWORD SIGNIN)
// =============================================================================

async function extractEdgeFunctionErrorMessage(
  error: unknown,
  fallback: string
): Promise<{ message: string; code?: string; challengeInvalidated?: boolean }> {
  const errObj = error as {
    message?: string;
    context?: { json?: () => Promise<Record<string, unknown>> };
  };

  if (errObj?.context && typeof errObj.context.json === 'function') {
    try {
      const payload = await errObj.context.json();
      if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
        return {
          message: payload.error,
          code: typeof payload.code === 'string' ? payload.code : undefined,
          challengeInvalidated: Boolean(payload.challengeInvalidated),
        };
      }
    } catch {
      // fall through to generic message
    }
  }

  return {
    message:
      typeof errObj?.message === 'string' && errObj.message.trim().length > 0
        ? errObj.message
        : fallback,
  };
}

export async function invokeAdminAuthInitiate(
  client: SupabaseClient | null,
  email: string,
  password: string
): Promise<LiveOtpChallengeResponse> {
  const db = requireSupabaseClient(client, 'invokeAdminAuthInitiate');
  const { data, error } = await db.functions.invoke(
    ADMIN_AUTH_EDGE_FUNCTIONS.INITIATE,
    {
      body: { email, password },
    }
  );

  if (error) {
    const parsed = await extractEdgeFunctionErrorMessage(
      error,
      'Invalid administrator credentials.'
    );
    throw new SupabaseRepositoryError('invokeAdminAuthInitiate', parsed.message, {
      code: parsed.code || 'ADMIN_AUTH_INITIATE_ERROR',
    });
  }

  const parsed = data as Partial<LiveOtpChallengeResponse> & { error?: string };
  if (parsed?.error) {
    throw new SupabaseRepositoryError('invokeAdminAuthInitiate', parsed.error, {
      code: 'ADMIN_AUTH_INITIATE_ERROR',
    });
  }
  if (
    !parsed?.challengeId ||
    !parsed?.challengeToken ||
    !parsed?.email ||
    !parsed?.expiresAt ||
    !parsed?.resendAvailableAt
  ) {
    throw new SupabaseRepositoryError(
      'invokeAdminAuthInitiate',
      'Unexpected response from server-side Email OTP initiation endpoint.'
    );
  }

  return {
    challengeId: parsed.challengeId,
    challengeToken: parsed.challengeToken,
    email: parsed.email,
    expiresAt: parsed.expiresAt,
    resendAvailableAt: parsed.resendAvailableAt,
    maxAttempts: parsed.maxAttempts ?? ADMIN_OTP_MAX_ATTEMPTS,
  };
}

export async function invokeAdminAuthResend(
  client: SupabaseClient | null,
  challengeId: string,
  challengeToken: string
): Promise<LiveOtpChallengeResponse> {
  const db = requireSupabaseClient(client, 'invokeAdminAuthResend');
  const { data, error } = await db.functions.invoke(
    ADMIN_AUTH_EDGE_FUNCTIONS.RESEND,
    {
      body: { challengeId, challengeToken },
    }
  );

  if (error) {
    const parsed = await extractEdgeFunctionErrorMessage(
      error,
      'Could not resend verification code right now.'
    );
    throw new SupabaseRepositoryError('invokeAdminAuthResend', parsed.message, {
      code: parsed.challengeInvalidated
        ? 'CHALLENGE_INVALIDATED'
        : parsed.code || 'ADMIN_AUTH_RESEND_ERROR',
    });
  }

  const parsed = data as Partial<LiveOtpChallengeResponse> & {
    error?: string;
    challengeInvalidated?: boolean;
  };
  if (parsed?.error) {
    throw new SupabaseRepositoryError('invokeAdminAuthResend', parsed.error, {
      code: parsed.challengeInvalidated
        ? 'CHALLENGE_INVALIDATED'
        : 'ADMIN_AUTH_RESEND_ERROR',
    });
  }
  if (
    !parsed?.challengeId ||
    !parsed?.challengeToken ||
    !parsed?.expiresAt ||
    !parsed?.resendAvailableAt
  ) {
    throw new SupabaseRepositoryError(
      'invokeAdminAuthResend',
      'Unexpected response from Email OTP resend endpoint.'
    );
  }

  return {
    challengeId: parsed.challengeId,
    challengeToken: parsed.challengeToken,
    email: parsed.email || '',
    expiresAt: parsed.expiresAt,
    resendAvailableAt: parsed.resendAvailableAt,
    maxAttempts: parsed.maxAttempts ?? ADMIN_OTP_MAX_ATTEMPTS,
  };
}

export async function invokeAdminAuthVerify(
  client: SupabaseClient | null,
  params: { challengeId: string; challengeToken: string; otpCode: string }
): Promise<LiveVerifiedSessionResponse> {
  const db = requireSupabaseClient(client, 'invokeAdminAuthVerify');
  const { data, error } = await db.functions.invoke(
    ADMIN_AUTH_EDGE_FUNCTIONS.VERIFY,
    {
      body: params,
    }
  );

  if (error) {
    const parsed = await extractEdgeFunctionErrorMessage(
      error,
      'Verification code check failed.'
    );
    throw new SupabaseRepositoryError('invokeAdminAuthVerify', parsed.message, {
      code: parsed.challengeInvalidated
        ? 'CHALLENGE_INVALIDATED'
        : parsed.code || 'ADMIN_AUTH_VERIFY_ERROR',
    });
  }

  const parsed = data as Partial<LiveVerifiedSessionResponse> & {
    error?: string;
    challengeInvalidated?: boolean;
  };
  if (parsed?.error) {
    throw new SupabaseRepositoryError('invokeAdminAuthVerify', parsed.error, {
      code: parsed.challengeInvalidated
        ? 'CHALLENGE_INVALIDATED'
        : 'ADMIN_AUTH_VERIFY_ERROR',
    });
  }

  if (
    !parsed?.session?.access_token ||
    !parsed?.session?.refresh_token ||
    !parsed?.admin?.email ||
    !parsed?.admin?.otpVerifiedUntil
  ) {
    throw new SupabaseRepositoryError(
      'invokeAdminAuthVerify',
      'Server did not return a verified administrator session.'
    );
  }

  return {
    session: parsed.session,
    admin: parsed.admin,
  };
}

export async function invokeAdminAuthCompleteRecovery(
  client: SupabaseClient | null,
  params: { tokenHash?: string; accessToken?: string; newPassword: string }
): Promise<{ success: true; message: string }> {
  const db = requireSupabaseClient(client, 'invokeAdminAuthCompleteRecovery');
  const { data, error } = await db.functions.invoke(
    ADMIN_AUTH_EDGE_FUNCTIONS.COMPLETE_RECOVERY,
    {
      body: params,
    }
  );

  if (error) {
    const parsed = await extractEdgeFunctionErrorMessage(
      error,
      'Unable to complete password recovery right now.'
    );
    throw new SupabaseRepositoryError(
      'invokeAdminAuthCompleteRecovery',
      parsed.message,
      { code: parsed.code || 'ADMIN_RECOVERY_ERROR' }
    );
  }

  const parsed = data as { success?: boolean; message?: string; error?: string };
  if (parsed?.error || !parsed?.success) {
    throw new SupabaseRepositoryError(
      'invokeAdminAuthCompleteRecovery',
      parsed?.error || 'Unable to complete password recovery right now.',
      { code: 'ADMIN_RECOVERY_ERROR' }
    );
  }

  return {
    success: true,
    message:
      parsed.message ||
      'Password updated successfully. Sign in with your new password and complete 6-digit Email OTP verification.',
  };
}

export async function invokeAdminAuthLogout(
  client: SupabaseClient | null,
  params: {
    eventType: 'ADMIN_LOGOUT' | 'ADMIN_SESSION_TIMEOUT';
    reason: string;
  }
): Promise<void> {
  if (!client) return;
  await client.functions.invoke(ADMIN_AUTH_EDGE_FUNCTIONS.LOGOUT, {
    body: params,
  });
}
