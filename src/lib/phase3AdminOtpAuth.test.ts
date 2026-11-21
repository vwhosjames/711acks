import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_AUTH_EDGE_FUNCTIONS,
  ADMIN_LOGIN_LOCKOUT_MS,
  ADMIN_LOGIN_MAX_FAILURES,
  ADMIN_OTP_EXPIRY_MS,
  ADMIN_OTP_MAX_ATTEMPTS,
  ADMIN_OTP_RESEND_COOLDOWN_MS,
  AdminAuthServerAdapters,
  MockAdminProfileRecord,
  MockOtpChallengeRecord,
  computeServerOtpHash,
  evaluateIsVerifiedAdmin,
  executeAdminAuthInitiate,
  executeAdminAuthLogout,
  executeAdminAuthResend,
  executeAdminAuthVerify,
  generateSecureSixDigitOtp,
} from './adminAuthController';

const ROOT_DIR = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function createInMemoryAuthHarness(options?: {
  ownerEmail?: string;
  ownerPassword?: string;
  smtpShouldFail?: boolean;
}) {
  let currentTimeMs = Date.parse('2026-11-20T12:00:00.000Z');
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const ownerEmail = options?.ownerEmail ?? 'owner@711acks.ph';
  const ownerPassword = options?.ownerPassword ?? 'SuperStrongOwnerPass!2026';

  const profiles = new Map<string, MockAdminProfileRecord>([
    [
      ownerId,
      {
        id: ownerId,
        email: ownerEmail,
        role: 'owner',
        otpVerifiedUntilMs: null,
        lastActiveAtMs: null,
        failedLoginAttempts: 0,
        lockedUntilMs: null,
      },
    ],
    [
      '00000000-0000-4000-8000-000000000002',
      {
        id: '00000000-0000-4000-8000-000000000002',
        email: 'editor@711acks.ph',
        role: 'editor', // Non-owner must never authenticate as admin
        otpVerifiedUntilMs: null,
        lastActiveAtMs: null,
        failedLoginAttempts: 0,
        lockedUntilMs: null,
      },
    ],
  ]);

  const challenges = new Map<string, MockOtpChallengeRecord>();
  const rateBuckets = new Map<string, { windowStartMs: number; count: number }>();
  const sentEmails: Array<{ toEmail: string; otpCode: string; expiresInMinutes: number }> = [];
  const mintedSessions: Array<{ adminId: string; adminEmail: string; atMs: number }> = [];
  const revokedSessions: string[] = [];
  const securityLogs: Array<{ eventType: string; actor: string; details: string }> = [];

  let smtpShouldFail = options?.smtpShouldFail ?? false;

  const adapters: AdminAuthServerAdapters = {
    now: () => currentTimeMs,
    pepper: 'test-server-side-hmac-pepper-min-32-chars-711acks',
    otpValidityMinutes: 120,
    sessionTimeoutMinutes: 30,

    async checkRateLimit(bucketKey, windowSeconds, maxRequests) {
      const existing = rateBuckets.get(bucketKey);
      const windowMs = windowSeconds * 1000;
      if (!existing || existing.windowStartMs + windowMs <= currentTimeMs) {
        rateBuckets.set(bucketKey, { windowStartMs: currentTimeMs, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (existing.count >= maxRequests) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((existing.windowStartMs + windowMs - currentTimeMs) / 1000)
        );
        return { allowed: false, retryAfterSeconds };
      }
      existing.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },

    async findOwnerByEmail(email) {
      for (const p of profiles.values()) {
        if (p.email.toLowerCase() === email.toLowerCase()) {
          return { ...p };
        }
      }
      return null;
    },

    async findOwnerById(id) {
      const p = profiles.get(id);
      return p ? { ...p } : null;
    },

    async verifyPasswordServerSide(email, password) {
      if (email.toLowerCase() === ownerEmail.toLowerCase() && password === ownerPassword) {
        return { ok: true, userId: ownerId };
      }
      return { ok: false };
    },

    async updateAdminProfile(id, patch) {
      const existing = profiles.get(id);
      if (!existing) return;
      profiles.set(id, { ...existing, ...patch });
    },

    async invalidateActiveChallengesForAdmin(adminId) {
      for (const [key, ch] of challenges.entries()) {
        if (ch.adminId === adminId && !ch.used) {
          challenges.set(key, { ...ch, used: true });
        }
      }
    },

    async insertChallenge(record) {
      challenges.set(record.id, { ...record });
    },

    async findChallengeById(id) {
      const ch = challenges.get(id);
      return ch ? { ...ch } : null;
    },

    async updateChallenge(id, patch) {
      const existing = challenges.get(id);
      if (!existing) return;
      challenges.set(id, { ...existing, ...patch });
    },

    async sendOtpEmail(params) {
      if (smtpShouldFail) {
        throw new Error('SMTP connection refused');
      }
      sentEmails.push(params);
    },

    async mintPostOtpSession(adminId, adminEmail) {
      mintedSessions.push({ adminId, adminEmail, atMs: currentTimeMs });
      return {
        access_token: `jwt-post-otp-${mintedSessions.length}`,
        refresh_token: `refresh-post-otp-${mintedSessions.length}`,
        expires_at: Math.floor((currentTimeMs + 3600_000) / 1000),
      };
    },

    async revokeSupabaseAuthSession(adminId) {
      revokedSessions.push(adminId);
    },

    async logSecurityEvent(eventType, actor, details) {
      securityLogs.push({ eventType, actor, details });
    },
  };

  return {
    ownerId,
    ownerEmail,
    ownerPassword,
    adapters,
    profiles,
    challenges,
    sentEmails,
    mintedSessions,
    revokedSessions,
    securityLogs,
    advanceMs(deltaMs: number) {
      currentTimeMs += deltaMs;
    },
    getNowMs() {
      return currentTimeMs;
    },
    setSmtpShouldFail(value: boolean) {
      smtpShouldFail = value;
    },
  };
}

// =============================================================================
// 1. CRYPTOGRAPHIC OTP GENERATION & HASHING
// =============================================================================

test('Phase 3: generateSecureSixDigitOtp produces unbiased 6-digit numeric strings', () => {
  const sample = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const code = generateSecureSixDigitOtp();
    assert.match(code, /^\d{6}$/, 'OTP must always be exactly 6 numeric digits');
    sample.add(code);
  }
  assert.ok(sample.size > 180, 'CSPRNG OTP output should exhibit high entropy');
});

// =============================================================================
// 2. PASSWORD VERIFICATION, GENERIC ERRORS, LOCKOUT & SINGLE-OWNER ENFORCEMENT
// =============================================================================

test('Phase 3: invalid password returns generic error, increments failures, and triggers 15m lockout on 5th failure', async () => {
  const h = createInMemoryAuthHarness();

  for (let i = 1; i <= ADMIN_LOGIN_MAX_FAILURES - 1; i++) {
    const res = await executeAdminAuthInitiate(
      { email: h.ownerEmail, password: 'WrongPassword!', ipKey: 'ip-1' },
      h.adapters
    );
    assert.equal(res.ok, false);
    assert.equal(res.status, 401);
    assert.equal(res.error, 'Invalid administrator credentials.');
    assert.equal(h.sentEmails.length, 0);
    assert.equal(h.mintedSessions.length, 0);
  }

  // 5th consecutive failure triggers lockout
  const fifth = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: 'WrongPassword!', ipKey: 'ip-1' },
    h.adapters
  );
  assert.equal(fifth.ok, false);
  assert.equal(fifth.status, 429);
  assert.match(fifth.error, /temporarily locked/i);

  const owner = h.profiles.get(h.ownerId)!;
  assert.equal(owner.failedLoginAttempts, ADMIN_LOGIN_MAX_FAILURES);
  assert.equal(owner.lockedUntilMs, h.getNowMs() + ADMIN_LOGIN_LOCKOUT_MS);

  // Even the valid password is blocked during active lockout
  const duringLock = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.ownerPassword, ipKey: 'ip-1' },
    h.adapters
  );
  assert.equal(duringLock.ok, false);
  assert.equal(duringLock.status, 429);
  assert.equal(h.sentEmails.length, 0);
  assert.equal(h.mintedSessions.length, 0);
});

test('Phase 3: unauthorized email and non-owner accounts receive identical generic error without enumeration', async () => {
  const h = createInMemoryAuthHarness();

  const unknownEmail = await executeAdminAuthInitiate(
    { email: 'attacker@example.com', password: h.ownerPassword, ipKey: 'ip-2' },
    h.adapters
  );
  const nonOwner = await executeAdminAuthInitiate(
    { email: 'editor@711acks.ph', password: h.ownerPassword, ipKey: 'ip-2' },
    h.adapters
  );
  const badOwnerPw = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: 'BadPassword', ipKey: 'ip-2' },
    h.adapters
  );

  assert.equal(unknownEmail.ok, false);
  assert.equal(nonOwner.ok, false);
  assert.equal(badOwnerPw.ok, false);
  assert.equal(unknownEmail.error, badOwnerPw.error);
  assert.equal(nonOwner.error, badOwnerPw.error);
  assert.equal(h.sentEmails.length, 0);
  assert.equal(h.mintedSessions.length, 0);
});

// =============================================================================
// 3. SUCCESSFUL PASSWORD CHALLENGE — HASHED OTP ONLY, ZERO PREMATURE SESSION
// =============================================================================

test('Phase 3: successful password challenge stores only HMAC-SHA256 OTP hash and releases ZERO auth session prior to OTP', async () => {
  const h = createInMemoryAuthHarness();

  const res = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.ownerPassword, ipKey: 'ip-3' },
    h.adapters
  );

  assert.equal(res.ok, true);
  if (!res.ok) return;

  // Must NOT return any session/JWT/OTP code in API payload
  assert.equal('session' in res.data, false);
  assert.equal('access_token' in res.data, false);
  assert.equal('otpCode' in res.data, false);
  assert.equal(h.mintedSessions.length, 0);

  // Email dispatched once with 6-digit code
  assert.equal(h.sentEmails.length, 1);
  const emailedCode = h.sentEmails[0].otpCode;
  assert.match(emailedCode, /^\d{6}$/);

  // Database record stores ONLY salted HMAC-SHA256 hash, never plaintext OTP
  const storedChallenge = h.challenges.get(res.data.challengeId)!;
  assert.ok(storedChallenge);
  assert.notEqual(storedChallenge.otpHash, emailedCode);
  assert.equal(storedChallenge.otpHash.includes(emailedCode), false);
  assert.equal(storedChallenge.otpHash.length, 64);

  const expectedHash = await computeServerOtpHash(
    h.adapters.pepper,
    res.data.challengeId,
    emailedCode
  );
  assert.equal(storedChallenge.otpHash, expectedHash);

  // Profile otp_verified_until remains null until OTP succeeds
  const owner = h.profiles.get(h.ownerId)!;
  assert.equal(owner.otpVerifiedUntilMs, null);
  assert.equal(
    evaluateIsVerifiedAdmin({
      callerAuthUid: h.ownerId,
      profile: owner,
      sessionTimeoutMinutes: 30,
      nowMs: h.getNowMs(),
    }),
    false
  );
});

test('Phase 3: SMTP delivery failure invalidates newly created challenge cleanly', async () => {
  const h = createInMemoryAuthHarness({ smtpShouldFail: true });

  const res = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.ownerPassword, ipKey: 'ip-smtp' },
    h.adapters
  );

  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(h.challenges.size, 1);
  const [stored] = Array.from(h.challenges.values());
  assert.equal(stored.used, true);
  assert.equal(h.mintedSessions.length, 0);
});

// =============================================================================
// 4. OTP VERIFICATION: EXPIRATION, INVALID CODE, ATTEMPT LIMIT, SINGLE-USE
// =============================================================================

test('Phase 3: expired OTP is rejected and marked used with zero session released', async () => {
  const h = createInMemoryAuthHarness();
  const init = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.ownerPassword, ipKey: 'ip-exp' },
    h.adapters
  );
  assert.equal(init.ok, true);
  if (!init.ok) return;

  const emailedCode = h.sentEmails[0].otpCode;
  h.advanceMs(ADMIN_OTP_EXPIRY_MS + 1_000);

  const verify = await executeAdminAuthVerify(
    {
      challengeId: init.data.challengeId,
      challengeToken: init.data.challengeToken,
      otpCode: emailedCode,
      ipKey: 'ip-exp',
    },
    h.adapters
  );

  assert.equal(verify.ok, false);
  if (verify.ok) return;
  assert.equal(verify.code, 'CHALLENGE_EXPIRED');
  assert.equal(verify.challengeInvalidated, true);
  assert.equal(h.mintedSessions.length, 0);
  assert.equal(h.challenges.get(init.data.challengeId)!.used, true);
});

test('Phase 3: invalid OTP decrements remaining attempts and invalidates challenge on max attempt limit', async () => {
  const h = createInMemoryAuthHarness();
  const init = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.ownerPassword, ipKey: 'ip-att' },
    h.adapters
  );
  assert.equal(init.ok, true);
  if (!init.ok) return;

  const emailedCode = h.sentEmails[0].otpCode;
  const wrongCode = emailedCode === '000000' ? '999999' : '000000';

  for (let i = 1; i <= ADMIN_OTP_MAX_ATTEMPTS - 1; i++) {
    const attempt = await executeAdminAuthVerify(
      {
        challengeId: init.data.challengeId,
        challengeToken: init.data.challengeToken,
        otpCode: wrongCode,
        ipKey: 'ip-att',
      },
      h.adapters
    );
    assert.equal(attempt.ok, false);
    if (attempt.ok) return;
    assert.equal(attempt.code, 'INVALID_OTP');
    assert.equal(attempt.remainingAttempts, ADMIN_OTP_MAX_ATTEMPTS - i);
    assert.equal(attempt.challengeInvalidated, false);
    assert.equal(h.mintedSessions.length, 0);
  }

  // 5th wrong attempt invalidates challenge
  const exhausted = await executeAdminAuthVerify(
    {
      challengeId: init.data.challengeId,
      challengeToken: init.data.challengeToken,
      otpCode: wrongCode,
      ipKey: 'ip-att',
    },
    h.adapters
  );
  assert.equal(exhausted.ok, false);
  if (exhausted.ok) return;
  assert.equal(exhausted.code, 'MAX_ATTEMPTS_EXCEEDED');
  assert.equal(exhausted.challengeInvalidated, true);
  assert.equal(h.challenges.get(init.data.challengeId)!.used, true);

  // Even the real code cannot be used after exhaustion
  const afterExhaustion = await executeAdminAuthVerify(
    {
      challengeId: init.data.challengeId,
      challengeToken: init.data.challengeToken,
      otpCode: emailedCode,
      ipKey: 'ip-att',
    },
    h.adapters
  );
  assert.equal(afterExhaustion.ok, false);
  assert.equal(h.mintedSessions.length, 0);
});

test('Phase 3: valid OTP releases session strictly once and replays are rejected (single-use)', async () => {
  const h = createInMemoryAuthHarness();
  const init = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.ownerPassword, ipKey: 'ip-ok' },
    h.adapters
  );
  assert.equal(init.ok, true);
  if (!init.ok) return;

  const emailedCode = h.sentEmails[0].otpCode;
  assert.equal(h.mintedSessions.length, 0);

  const firstVerify = await executeAdminAuthVerify(
    {
      challengeId: init.data.challengeId,
      challengeToken: init.data.challengeToken,
      otpCode: emailedCode,
      ipKey: 'ip-ok',
    },
    h.adapters
  );

  assert.equal(firstVerify.ok, true);
  if (!firstVerify.ok) return;

  assert.equal(h.mintedSessions.length, 1);
  assert.equal(firstVerify.data.admin.email, h.ownerEmail);
  assert.ok(firstVerify.data.session.access_token.startsWith('jwt-post-otp-'));

  // Server-side otp_verified_until and last_active_at are updated for owner
  const owner = h.profiles.get(h.ownerId)!;
  assert.ok(owner.otpVerifiedUntilMs && owner.otpVerifiedUntilMs > h.getNowMs());
  assert.equal(owner.lastActiveAtMs, h.getNowMs());
  assert.equal(
    evaluateIsVerifiedAdmin({
      callerAuthUid: h.ownerId,
      profile: owner,
      sessionTimeoutMinutes: 30,
      nowMs: h.getNowMs(),
    }),
    true
  );

  // Replaying the exact same OTP must fail immediately
  const replay = await executeAdminAuthVerify(
    {
      challengeId: init.data.challengeId,
      challengeToken: init.data.challengeToken,
      otpCode: emailedCode,
      ipKey: 'ip-ok',
    },
    h.adapters
  );
  assert.equal(replay.ok, false);
  if (replay.ok) return;
  assert.equal(replay.code, 'CHALLENGE_ALREADY_USED');
  assert.equal(h.mintedSessions.length, 1);
});

// =============================================================================
// 5. RESEND COOLDOWN, PRIOR CHALLENGE INVALIDATION & RATE LIMITING
// =============================================================================

test('Phase 3: resend enforces 30s cooldown, invalidates previous OTP, and enforces rolling issue rate limit', async () => {
  const h = createInMemoryAuthHarness();
  const init = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.ownerPassword, ipKey: 'ip-rs' },
    h.adapters
  );
  assert.equal(init.ok, true);
  if (!init.ok) return;

  const firstCode = h.sentEmails[0].otpCode;

  // Immediate resend within 30s must be blocked with 429
  const tooSoon = await executeAdminAuthResend(
    { challengeId: init.data.challengeId, challengeToken: init.data.challengeToken },
    h.adapters
  );
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.status, 429);

  // Advance past 30s cooldown -> resend succeeds and invalidates original challenge
  h.advanceMs(ADMIN_OTP_RESEND_COOLDOWN_MS + 1_000);
  const resent = await executeAdminAuthResend(
    { challengeId: init.data.challengeId, challengeToken: init.data.challengeToken },
    h.adapters
  );
  assert.equal(resent.ok, true);
  if (!resent.ok) return;

  assert.notEqual(resent.data.challengeId, init.data.challengeId);
  assert.equal(h.challenges.get(init.data.challengeId)!.used, true);

  // Old OTP can no longer verify
  const oldVerify = await executeAdminAuthVerify(
    {
      challengeId: init.data.challengeId,
      challengeToken: init.data.challengeToken,
      otpCode: firstCode,
      ipKey: 'ip-rs',
    },
    h.adapters
  );
  assert.equal(oldVerify.ok, false);

  // Exhaust rolling 5-per-15-minute OTP issue rate limit (2 already issued: initiate + 1 resend)
  let active = resent.data;
  for (let i = 0; i < 3; i++) {
    h.advanceMs(ADMIN_OTP_RESEND_COOLDOWN_MS + 1_000);
    const next = await executeAdminAuthResend(
      { challengeId: active.challengeId, challengeToken: active.challengeToken },
      h.adapters
    );
    assert.equal(next.ok, true);
    if (!next.ok) return;
    active = next.data;
  }

  // 6th OTP within 15 minutes must be rate-limited (429)
  h.advanceMs(ADMIN_OTP_RESEND_COOLDOWN_MS + 1_000);
  const rateLimited = await executeAdminAuthResend(
    { challengeId: active.challengeId, challengeToken: active.challengeToken },
    h.adapters
  );
  assert.equal(rateLimited.ok, false);
  assert.equal(rateLimited.status, 429);
});

// =============================================================================
// 6. SERVER-SIDE 30-MIN INACTIVITY TIMEOUT, OTP EXPIRATION & LOGOUT REVOCATION
// =============================================================================

test('Phase 3: is_verified_admin() denies access after 30-min inactivity, after OTP expiry, and after server-side logout', async () => {
  const h = createInMemoryAuthHarness();
  const init = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.ownerPassword, ipKey: 'ip-to' },
    h.adapters
  );
  assert.equal(init.ok, true);
  if (!init.ok) return;

  const verify = await executeAdminAuthVerify(
    {
      challengeId: init.data.challengeId,
      challengeToken: init.data.challengeToken,
      otpCode: h.sentEmails[0].otpCode,
      ipKey: 'ip-to',
    },
    h.adapters
  );
  assert.equal(verify.ok, true);

  const owner = h.profiles.get(h.ownerId)!;

  // Valid at 29 minutes
  assert.equal(
    evaluateIsVerifiedAdmin({
      callerAuthUid: h.ownerId,
      profile: owner,
      sessionTimeoutMinutes: 30,
      nowMs: h.getNowMs() + 29 * 60 * 1000,
    }),
    true
  );

  // Blocked at 30 minutes of inactivity even though otp_verified_until is 120m away
  assert.equal(
    evaluateIsVerifiedAdmin({
      callerAuthUid: h.ownerId,
      profile: owner,
      sessionTimeoutMinutes: 30,
      nowMs: h.getNowMs() + 30 * 60 * 1000,
    }),
    false
  );

  // Blocked after absolute OTP verification expiration even if lastActiveAt were recent
  const activeButOtpExpired: MockAdminProfileRecord = {
    ...owner,
    lastActiveAtMs: owner.otpVerifiedUntilMs! - 1000,
  };
  assert.equal(
    evaluateIsVerifiedAdmin({
      callerAuthUid: h.ownerId,
      profile: activeButOtpExpired,
      sessionTimeoutMinutes: 30,
      nowMs: owner.otpVerifiedUntilMs! + 1,
    }),
    false
  );

  // Server-side logout clears otp_verified_until immediately and revokes auth session
  await executeAdminAuthLogout(
    {
      adminId: h.ownerId,
      eventType: 'ADMIN_LOGOUT',
      reason: 'Manual sign-out',
    },
    h.adapters
  );
  const afterLogout = h.profiles.get(h.ownerId)!;
  assert.equal(afterLogout.otpVerifiedUntilMs, null);
  assert.deepEqual(h.revokedSessions, [h.ownerId]);
  assert.equal(
    evaluateIsVerifiedAdmin({
      callerAuthUid: h.ownerId,
      profile: afterLogout,
      sessionTimeoutMinutes: 30,
      nowMs: h.getNowMs(),
    }),
    false
  );
});

// =============================================================================
// 7. STATIC SECURITY, MIGRATION 005, EDGE FUNCTION & FRONTEND CONTRACT CHECKS
// =============================================================================

test('Phase 3: migration 005 enforces single owner, service_role-only OTP RPCs, and strict RLS on rate limits', () => {
  const mig005 = readProjectFile('supabase/migrations/005_phase3_admin_otp_auth.sql');

  // Single-owner partial unique index
  assert.match(mig005, /create unique index if not exists uq_admin_profiles_single_owner/i);
  assert.match(mig005, /where\s+\(?role\s*=\s*'owner'\)?/i);

  // Server-side rate limit table with RLS enabled and no public/anon/authenticated policies
  assert.match(mig005, /create table if not exists public\.admin_auth_rate_limits/i);
  assert.match(mig005, /alter table public\.admin_auth_rate_limits enable row level security/i);
  assert.doesNotMatch(
    mig005,
    /create policy .* on public\.admin_auth_rate_limits .* to (anon|authenticated|public)/i
  );

  // Atomic FOR UPDATE verification and revocation RPCs restricted strictly to service_role
  assert.match(mig005, /create or replace function public\.verify_admin_otp_challenge/i);
  assert.match(mig005, /for update/i);
  assert.match(mig005, /create or replace function public\.revoke_admin_otp_session/i);
  assert.match(mig005, /set search_path = public, pg_temp/i);
  assert.match(
    mig005,
    /revoke all on function public\.verify_admin_otp_challenge[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    mig005,
    /grant execute on function public\.verify_admin_otp_challenge[\s\S]*to service_role/i
  );
  assert.match(
    mig005,
    /grant execute on function public\.revoke_admin_otp_session[\s\S]*to service_role/i
  );
});

test('Phase 3: Edge Functions exist, use allowlisted CORS, no wildcard *, no plaintext OTP logging, and direct SMTP', () => {
  const shared = readProjectFile('supabase/functions/_shared/adminAuthShared.ts');
  const smtp = readProjectFile('supabase/functions/_shared/smtpClient.ts');
  const initiate = readProjectFile(
    `supabase/functions/${ADMIN_AUTH_EDGE_FUNCTIONS.INITIATE}/index.ts`
  );
  const resend = readProjectFile(
    `supabase/functions/${ADMIN_AUTH_EDGE_FUNCTIONS.RESEND}/index.ts`
  );
  const verify = readProjectFile(
    `supabase/functions/${ADMIN_AUTH_EDGE_FUNCTIONS.VERIFY}/index.ts`
  );
  const logout = readProjectFile(
    `supabase/functions/${ADMIN_AUTH_EDGE_FUNCTIONS.LOGOUT}/index.ts`
  );

  // Strict CORS without wildcard '*' on authenticated endpoints
  assert.doesNotMatch(shared, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/);
  assert.match(shared, /ALLOWED_ORIGINS/);
  assert.match(shared, /Cache-Control.*no-store/);

  // Direct TLS/STARTTLS SMTP with env secrets and header injection defense
  assert.match(smtp, /Deno\.connectTls/);
  assert.match(smtp, /STARTTLS/);
  assert.match(smtp, /SMTP_HOST/);
  assert.match(smtp, /SMTP_PASS/);
  assert.doesNotMatch(smtp, /console\.log\(.*otpCode/i);
  assert.doesNotMatch(smtp, /console\.log\(.*pass/i);

  // Initiate revokes pre-OTP password session immediately and returns zero JWT/OTP
  assert.match(initiate, /auth\.admin\s*\.signOut/);
  assert.match(initiate, /computeServerOtpHash/);
  assert.match(initiate, /sendAdminOtpEmail/);

  // Resend enforces cooldown and invalidates previous challenges
  assert.match(resend, /resend_available_at/);
  assert.match(resend, /computeServerOtpHash/);

  // Verify calls atomic DB RPC and ONLY mints session after verified === true
  assert.match(verify, /verify_admin_otp_challenge/);
  assert.match(verify, /auth\.admin\.generateLink/);
  assert.match(verify, /verifyOtp/);
  assert.match(verify, /revoke_admin_otp_session/);

  // Logout verifies caller JWT, revokes otp_verified_until, and signs out globally
  assert.match(logout, /auth\.getUser/);
  assert.match(logout, /revoke_admin_otp_session/);
  assert.match(logout, /auth\.admin\s*\.signOut/);
});

test('Phase 3: frontend never calls signInWithPassword directly, uses memory-only auth session, and exposes zero server secrets', () => {
  const supabaseClientSrc = readProjectFile('src/lib/supabaseClient.ts');
  const appContextSrc = readProjectFile('src/context/AppContext.tsx');
  const adminPageSrc = readProjectFile('src/pages/AdminDashboardPage.tsx');
  const controllerSrc = readProjectFile('src/lib/adminAuthController.ts');

  // Memory-only Supabase Auth session (no persistent LocalStorage refresh tokens or remember-me bypass)
  assert.match(supabaseClientSrc, /persistSession:\s*false/);
  assert.match(supabaseClientSrc, /detectSessionInUrl:\s*false/);

  // Browser executable code must NEVER call signInWithPassword directly or write otp_verified_until
  for (const src of [supabaseClientSrc, appContextSrc, adminPageSrc, controllerSrc]) {
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(withoutComments, /signInWithPassword\s*\(/);
    assert.doesNotMatch(withoutComments, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(withoutComments, /SMTP_PASS/);
    assert.doesNotMatch(withoutComments, /ADMIN_OTP_PEPPER/);
    assert.doesNotMatch(withoutComments, /\.update\(\s*\{[^}]*otp_verified_until/);
  }

  // Live mode uses Edge Function invokers and sets session ONLY inside verifyAdminOtp
  assert.match(appContextSrc, /invokeAdminAuthInitiate/);
  assert.match(appContextSrc, /invokeAdminAuthVerify/);
  assert.match(appContextSrc, /invokeAdminAuthResend/);
  assert.match(appContextSrc, /invokeAdminAuthLogout/);
  assert.match(appContextSrc, /supabase\.auth\.setSession/);

  // Demo OTP code is strictly gated behind Local Preview Mode (!isLiveSupabase)
  assert.match(adminPageSrc, /!isLiveSupabase\s*&&\s*pendingOtpChallenge\.demoOtpDisplay/);
});

test('Phase 3: migrations 001-004 remain intact and is_verified_admin() enforcement is preserved', () => {
  const mig001 = readProjectFile('supabase/migrations/001_711acks_schema.sql');
  const mig002 = readProjectFile('supabase/migrations/002_phase2_database_foundation.sql');
  const mig003 = readProjectFile('supabase/migrations/003_storage_setup.sql');
  const mig004 = readProjectFile('supabase/migrations/004_phase2d_security_hardening.sql');

  assert.match(mig001, /create or replace function public\.is_verified_admin\(\)/i);
  assert.match(mig002, /make_interval\(mins => coalesce\(ws\.session_timeout_minutes, 30\)\)/i);
  assert.match(mig003, /pending-submissions/);
  assert.match(mig004, /drop policy if exists "Public can insert pending community submissions"/i);
});
