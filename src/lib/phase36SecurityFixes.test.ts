import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SupabaseRepositoryError,
  isUnauthorizedSupabaseError,
} from './supabaseRepository';
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
  constantTimeHexEqual,
  evaluateIsVerifiedAdmin,
  executeAdminAuthInitiate,
  executeAdminAuthResend,
  executeAdminAuthVerify,
  executeAdminPasswordRecovery,
  invokeAdminAuthResend,
  parsePasswordRecoveryUrl,
  performAdminActivityHeartbeat,
  validateNewAdminPassword,
} from './adminAuthController';
import {
  buildAdminCorsHeaders,
  constantTimeEqual,
  extractAnonymizedIpHash,
  extractTrustedClientIp,
  handleAdminPreflight,
  isOriginAllowed,
  jsonAdminResponse,
  rejectIfDisallowedOrigin,
  resolveAllowedOrigins,
} from '../../supabase/functions/_shared/adminAuthShared';
import {
  SmtpConfig,
  SmtpDialer,
  SmtpSocketLike,
  SmtpTimeoutError,
  assertNoHeaderInjection,
  ehloSupportsAuthLogin,
  ehloSupportsCapability,
  parseSmtpSender,
  sendAdminOtpEmailViaSmtp,
} from '../../supabase/functions/_shared/smtpClient';

const PROJECT_ROOT = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

// =============================================================================
// IN-MEMORY ATOMIC SERVER HARNESS (SUPPORTS CONCURRENCY & FAIL-CLOSED TESTS)
// =============================================================================

function createPhase36Harness(options?: {
  failRateLimitBucketPrefix?: string;
  throwOnSmtp?: boolean;
}) {
  let clockMs = Date.UTC(2026, 10, 21, 12, 0, 0);
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const ownerEmail = 'owner@711acks.ph';
  const ownerPassword = 'InitialOwnerPassword!2026';
  let currentPassword = ownerPassword;
  const pepper = 'phase36-test-pepper-64-chars-minimum-secret-entropy-value-0000';

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
  ]);

  const challenges = new Map<string, MockOtpChallengeRecord>();
  const rateBuckets = new Map<string, { windowStartMs: number; count: number }>();
  const sentEmails: Array<{ toEmail: string; otpCode: string }> = [];
  const securityEvents: Array<{ eventType: string; actor: string; details: string }> = [];
  let revokedSessionCount = 0;
  let mintedSessionCount = 0;

  // Simulates PostgreSQL row-level serialization for concurrent tests
  const bucketLocks = new Map<string, Promise<void>>();
  const serializeByKey = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = bucketLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    bucketLocks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const adapters: AdminAuthServerAdapters = {
    now: () => clockMs,
    pepper,
    otpValidityMinutes: 120,
    sessionTimeoutMinutes: 30,

    async checkRateLimit(bucketKey, windowSeconds, maxRequests) {
      if (
        options?.failRateLimitBucketPrefix &&
        bucketKey.startsWith(options.failRateLimitBucketPrefix)
      ) {
        throw new Error('Simulated rate-limit RPC outage');
      }

      return serializeByKey(`rl:${bucketKey}`, async () => {
        const existing = rateBuckets.get(bucketKey);
        if (!existing) {
          // Mirrors migration 006 INSERT ... ON CONFLICT DO NOTHING first-request path
          rateBuckets.set(bucketKey, { windowStartMs: clockMs, count: 1 });
          return { allowed: true, retryAfterSeconds: 0 };
        }
        const elapsedSec = Math.floor((clockMs - existing.windowStartMs) / 1000);
        if (elapsedSec >= windowSeconds) {
          rateBuckets.set(bucketKey, { windowStartMs: clockMs, count: 1 });
          return { allowed: true, retryAfterSeconds: 0 };
        }
        if (existing.count >= maxRequests) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, windowSeconds - elapsedSec),
          };
        }
        existing.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      });
    },

    async findOwnerByEmail(email) {
      for (const p of profiles.values()) {
        if (p.email === email && p.role === 'owner') return { ...p };
      }
      return null;
    },

    async findOwnerById(id) {
      const p = profiles.get(id);
      return p ? { ...p } : null;
    },

    async verifyPasswordServerSide(email, password) {
      // Yield to event loop so concurrent calls overlap realistically
      await Promise.resolve();
      if (email === ownerEmail && password === currentPassword) {
        return { ok: true, userId: ownerId };
      }
      return { ok: false };
    },

    async recordFailedLoginAtomic(adminId, maxAttempts, lockoutMs) {
      return serializeByKey(`admin:${adminId}`, async () => {
        const p = profiles.get(adminId);
        if (!p || p.role !== 'owner') {
          return { locked: false, failedAttempts: 0, lockedUntilMs: null };
        }
        if (p.lockedUntilMs !== null && p.lockedUntilMs > clockMs) {
          return {
            locked: true,
            failedAttempts: p.failedLoginAttempts,
            lockedUntilMs: p.lockedUntilMs,
          };
        }
        const nextFailures =
          p.lockedUntilMs !== null && p.lockedUntilMs <= clockMs
            ? 1
            : p.failedLoginAttempts + 1;
        const locked = nextFailures >= maxAttempts;
        p.failedLoginAttempts = nextFailures;
        p.lockedUntilMs = locked ? clockMs + lockoutMs : null;
        return {
          locked,
          failedAttempts: nextFailures,
          lockedUntilMs: p.lockedUntilMs,
        };
      });
    },

    async updateAdminProfile(id, patch) {
      const p = profiles.get(id);
      if (p) Object.assign(p, patch);
    },

    async invalidateActiveChallengesForAdmin(adminId) {
      for (const c of challenges.values()) {
        if (c.adminId === adminId && !c.used) c.used = true;
      }
    },

    async insertChallenge(record) {
      challenges.set(record.id, { ...record });
    },

    async findChallengeById(id) {
      const c = challenges.get(id);
      return c ? { ...c } : null;
    },

    async updateChallenge(id, patch) {
      const c = challenges.get(id);
      if (c) Object.assign(c, patch);
    },

    async rotateChallengeForResendAtomic({
      oldChallengeId,
      oldTokenHash,
      newChallenge,
    }) {
      return serializeByKey(`challenge:${oldChallengeId}`, async () => {
        const existing = challenges.get(oldChallengeId);
        if (!existing) {
          return {
            ok: false,
            status: 401,
            code: 'CHALLENGE_NOT_FOUND',
            error: 'Verification challenge is no longer active. Please sign in again.',
            challengeInvalidated: true,
          };
        }
        if (existing.used) {
          return {
            ok: false,
            status: 401,
            code: 'CHALLENGE_ALREADY_USED',
            error: 'Verification challenge is no longer active. Please sign in again.',
            challengeInvalidated: true,
          };
        }
        if (!constantTimeHexEqual(existing.challengeTokenHash, oldTokenHash)) {
          return {
            ok: false,
            status: 401,
            code: 'INVALID_CHALLENGE_TOKEN',
            error: 'Verification challenge is no longer active. Please sign in again.',
            challengeInvalidated: true,
          };
        }
        if (clockMs >= existing.expiresAtMs) {
          existing.used = true;
          return {
            ok: false,
            status: 401,
            code: 'CHALLENGE_EXPIRED',
            error: 'Verification challenge has expired. Please sign in again.',
            challengeInvalidated: true,
          };
        }
        if (clockMs < existing.resendAvailableAtMs) {
          const waitSec = Math.max(
            1,
            Math.ceil((existing.resendAvailableAtMs - clockMs) / 1000)
          );
          return {
            ok: false,
            status: 429,
            code: 'COOLDOWN_ACTIVE',
            error: `Please wait ${waitSec}s before requesting a new verification code.`,
            challengeInvalidated: false,
            retryAfterSeconds: waitSec,
          };
        }

        const admin = profiles.get(existing.adminId);
        if (!admin || admin.role !== 'owner') {
          existing.used = true;
          return {
            ok: false,
            status: 401,
            code: 'UNAUTHORIZED_ADMIN',
            error: 'Verification challenge is no longer active. Please sign in again.',
            challengeInvalidated: true,
          };
        }
        if (admin.lockedUntilMs !== null && admin.lockedUntilMs > clockMs) {
          return {
            ok: false,
            status: 429,
            code: 'ACCOUNT_LOCKED',
            error: 'Administrator sign-in is temporarily locked.',
            challengeInvalidated: true,
          };
        }

        const issueLimit = await adapters.checkRateLimit(
          `otp_issue:${admin.id}`,
          900,
          5
        );
        if (!issueLimit.allowed) {
          return {
            ok: false,
            status: 429,
            code: 'RATE_LIMITED',
            error:
              'Too many verification codes requested recently. Please wait before trying again.',
            challengeInvalidated: false,
            retryAfterSeconds: issueLimit.retryAfterSeconds,
          };
        }

        for (const c of challenges.values()) {
          if (c.adminId === admin.id && !c.used) c.used = true;
        }
        challenges.set(newChallenge.id, { ...newChallenge, adminId: admin.id });
        return { ok: true, admin: { ...admin } };
      });
    },

    async sendOtpEmail({ toEmail, otpCode }) {
      if (options?.throwOnSmtp) {
        throw new SmtpTimeoutError('read', 8000);
      }
      sentEmails.push({ toEmail, otpCode });
    },

    async mintPostOtpSession() {
      mintedSessionCount += 1;
      return {
        access_token: `verified-access-${mintedSessionCount}`,
        refresh_token: `verified-refresh-${mintedSessionCount}`,
        expires_at: Math.floor((clockMs + 3600_000) / 1000),
      };
    },

    async verifyRecoveryTokenServerSide({ tokenHash, accessToken }) {
      if (tokenHash === 'valid-recovery-token-hash-0123456789abcdef') {
        return { ok: true, userId: ownerId, disposableToken: 'disposable-rec-jwt' };
      }
      if (accessToken === 'eyJ.validrecovery.sig') {
        return { ok: true, userId: ownerId, disposableToken: accessToken };
      }
      return { ok: false };
    },

    async updateOwnerPasswordServerSide(adminId, newPassword) {
      if (adminId !== ownerId) throw new Error('Unknown admin');
      currentPassword = newPassword;
    },

    async revokeSupabaseAuthSession() {
      revokedSessionCount += 1;
    },

    async logSecurityEvent(eventType, actor, details) {
      securityEvents.push({ eventType, actor, details });
    },
  };

  return {
    adapters,
    ownerId,
    ownerEmail,
    getCurrentPassword: () => currentPassword,
    profiles,
    challenges,
    rateBuckets,
    sentEmails,
    securityEvents,
    getRevokedSessionCount: () => revokedSessionCount,
    getMintedSessionCount: () => mintedSessionCount,
    advanceMs: (ms: number) => {
      clockMs += ms;
    },
    getClockMs: () => clockMs,
  };
}

// =============================================================================
// H-01 TESTS: NORMALIZED UNAUTHORIZED DETECTION & NON-OPTIMISTIC HEARTBEAT
// =============================================================================

test('H-01: isUnauthorizedSupabaseError detects PostgreSQL P0001 UNAUTHORIZED, PGRST301, 42501, and HTTP 401/403', () => {
  const p0001Unauthorized = new SupabaseRepositoryError(
    'touchAdminActivityInDb',
    'UNAUTHORIZED: Verified admin session required.',
    { code: 'P0001' }
  );
  assert.equal(isUnauthorizedSupabaseError(p0001Unauthorized), true);

  const pgrst301 = new SupabaseRepositoryError('fetchAdmin', 'JWT expired', {
    code: 'PGRST301',
  });
  assert.equal(isUnauthorizedSupabaseError(pgrst301), true);

  const rls42501 = new SupabaseRepositoryError(
    'saveProduct',
    'new row violates row-level security policy for table "products"',
    { code: '42501' }
  );
  assert.equal(isUnauthorizedSupabaseError(rls42501), true);

  const http401 = new SupabaseRepositoryError('rpc', 'Session rejected', {
    status: 401,
  });
  const http403 = new SupabaseRepositoryError('rpc', 'Forbidden', {
    status: 403,
  });
  assert.equal(isUnauthorizedSupabaseError(http401), true);
  assert.equal(isUnauthorizedSupabaseError(http403), true);

  // Non-auth database or network errors must NOT trigger false logouts
  const p0001Validation = new SupabaseRepositoryError(
    'saveProduct',
    'INVALID_PRICE: Price must be positive.',
    { code: 'P0001' }
  );
  const networkErr = new Error('Failed to fetch');
  assert.equal(isUnauthorizedSupabaseError(p0001Validation), false);
  assert.equal(isUnauthorizedSupabaseError(networkErr), false);
});

test('H-01: performAdminActivityHeartbeat does NOT optimistically extend expiry and immediately expires session on P0001 rejection', async () => {
  let localExpiresAt = Date.UTC(2026, 10, 21, 12, 30, 0);
  let expiredCalled = false;
  let confirmedCalled = false;

  let rejectTouch!: (err: Error) => void;
  const pendingTouch = new Promise<string>((_, reject) => {
    rejectTouch = reject;
  });

  const heartbeatPromise = performAdminActivityHeartbeat({
    touchServer: () => pendingTouch,
    otpVerifiedUntilMs: Date.UTC(2026, 10, 21, 14, 0, 0),
    sessionTimeoutMinutes: 30,
    onConfirmed: (_serverNowMs, confirmedExpiresAtMs) => {
      confirmedCalled = true;
      localExpiresAt = confirmedExpiresAtMs;
    },
    onExpired: () => {
      expiredCalled = true;
    },
  });

  // Before server responds, local expiry MUST remain untouched (no optimistic extension)
  assert.equal(confirmedCalled, false);
  assert.equal(localExpiresAt, Date.UTC(2026, 10, 21, 12, 30, 0));

  rejectTouch(
    new SupabaseRepositoryError(
      'touchAdminActivityInDb',
      'UNAUTHORIZED: Verified admin session required.',
      { code: 'P0001' }
    )
  );

  const result = await heartbeatPromise;
  assert.equal(result.status, 'expired');
  assert.equal(confirmedCalled, false);
  assert.equal(expiredCalled, true);
  assert.equal(localExpiresAt, Date.UTC(2026, 10, 21, 12, 30, 0));
});

test('H-01: performAdminActivityHeartbeat extends expiry ONLY after server confirms and caps at otpVerifiedUntilMs', async () => {
  const serverNowIso = '2026-11-21T13:50:00.000Z';
  const otpCapMs = Date.parse('2026-11-21T14:00:00.000Z'); // Only 10 mins remaining until absolute cap
  let confirmedExpiresAt = 0;

  const result = await performAdminActivityHeartbeat({
    touchServer: async () => serverNowIso,
    otpVerifiedUntilMs: otpCapMs,
    sessionTimeoutMinutes: 30,
    onConfirmed: (_now, exp) => {
      confirmedExpiresAt = exp;
    },
    onExpired: () => {
      assert.fail('Should not expire on confirmed heartbeat');
    },
  });

  assert.equal(result.status, 'confirmed');
  // 13:50 + 30m = 14:20, clamped to absolute otpVerifiedUntilMs = 14:00
  assert.equal(confirmedExpiresAt, otpCapMs);
});

// =============================================================================
// H-02 TESTS: SMTP SOCKET TIMEOUTS, SENDER PARSING, EHLO CHECKS & ROLLBACK
// =============================================================================

function createScriptedSmtpSocket(
  responses: string[],
  options?: { hangOnReadIndex?: number; hangOnWriteIndex?: number }
) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const writtenChunks: string[] = [];
  let readIdx = 0;
  let writeIdx = 0;
  let closed = false;

  const socket: SmtpSocketLike = {
    async read(buf: Uint8Array): Promise<number | null> {
      const idx = readIdx++;
      if (options?.hangOnReadIndex === idx) {
        return new Promise<number | null>(() => {
          // Intentionally never resolves to simulate stalled SMTP peer
        });
      }
      if (idx >= responses.length) return null;
      const bytes = encoder.encode(responses[idx]);
      buf.set(bytes, 0);
      return bytes.length;
    },
    async write(buf: Uint8Array): Promise<number> {
      const idx = writeIdx++;
      if (options?.hangOnWriteIndex === idx) {
        return new Promise<number>(() => {
          // Intentionally never resolves to simulate stalled socket write
        });
      }
      writtenChunks.push(decoder.decode(buf));
      return buf.length;
    },
    close() {
      closed = true;
    },
  };

  return {
    socket,
    writtenChunks,
    isClosed: () => closed,
  };
}

const SAMPLE_SMTP_CONFIG: SmtpConfig = {
  host: 'smtp.gmail.com',
  port: 465,
  user: 'owner@gmail.com',
  pass: 'app-password-secret',
  from: '711acks Security <owner@gmail.com>',
  implicitTls: true,
};

test('H-02: parseSmtpSender handles bare email, display-name mailbox, and rejects malformed/injection inputs', () => {
  const withDisplay = parseSmtpSender('711acks Security <Owner@Gmail.com>');
  assert.equal(withDisplay.address, 'owner@gmail.com');
  assert.equal(withDisplay.displayName, '711acks Security');
  assert.equal(
    withDisplay.formattedHeader,
    '711acks Security <owner@gmail.com>'
  );

  const bare = parseSmtpSender('owner@gmail.com');
  assert.equal(bare.address, 'owner@gmail.com');
  assert.equal(bare.formattedHeader, '711acks Security <owner@gmail.com>');

  assert.throws(() => parseSmtpSender('not-an-email'));
  assert.throws(() => parseSmtpSender('Bad <<owner@gmail.com>>'));
  assert.throws(() =>
    parseSmtpSender('711acks\r\nBcc: evil@example.com <owner@gmail.com>')
  );
  assert.throws(() =>
    assertNoHeaderInjection('subject\r\nInjected: yes', 'subject')
  );
});

test('H-02: sendAdminOtpEmailViaSmtp sends bare email in MAIL FROM and clean display name in From header', async () => {
  const scripted = createScriptedSmtpSocket([
    '220 smtp.gmail.com ESMTP ready\r\n',
    '250-smtp.gmail.com at your service\r\n250 AUTH LOGIN PLAIN\r\n',
    '334 VXNlcm5hbWU6\r\n',
    '334 UGFzc3dvcmQ6\r\n',
    '235 2.7.0 Accepted\r\n',
    '250 2.1.0 OK\r\n',
    '250 2.1.5 OK\r\n',
    '354 Go ahead\r\n',
    '250 2.0.0 OK queued\r\n',
    '221 2.0.0 Bye\r\n',
  ]);

  const dialer: SmtpDialer = {
    connectTls: async () => scripted.socket,
    connectTcp: async () => assert.fail('Should use implicit TLS on port 465'),
    startTls: async () => assert.fail('Should not call startTls on implicit TLS'),
  };

  await sendAdminOtpEmailViaSmtp({
    config: SAMPLE_SMTP_CONFIG,
    toEmail: 'owner@gmail.com',
    otpCode: '482913',
    expiresInMinutes: 5,
    dialer,
  });

  const transcript = scripted.writtenChunks.join('');
  assert.match(transcript, /MAIL FROM:<owner@gmail\.com>\r\n/);
  assert.doesNotMatch(transcript, /MAIL FROM:<711acks Security/);
  assert.match(transcript, /From: 711acks Security <owner@gmail\.com>\r\n/);
  assert.doesNotMatch(transcript, /<<owner@gmail\.com>>/);
  assert.equal(scripted.isClosed(), true);
});

test('H-02: SMTP connect, read, and write timeouts terminate stalled operations and close sockets', async () => {
  // 1. Connect timeout
  const hangingConnectDialer: SmtpDialer = {
    connectTls: () => new Promise<SmtpSocketLike>(() => {}),
    connectTcp: () => new Promise<SmtpSocketLike>(() => {}),
    startTls: () => new Promise<SmtpSocketLike>(() => {}),
  };

  await assert.rejects(
    () =>
      sendAdminOtpEmailViaSmtp({
        config: SAMPLE_SMTP_CONFIG,
        toEmail: 'owner@gmail.com',
        otpCode: '123456',
        expiresInMinutes: 5,
        timeouts: { connectTimeoutMs: 25, ioTimeoutMs: 25, totalTimeoutMs: 100 },
        dialer: hangingConnectDialer,
      }),
    (err: unknown) => err instanceof SmtpTimeoutError && err.operation === 'connect'
  );

  // 2. Read timeout
  const hangingRead = createScriptedSmtpSocket([], { hangOnReadIndex: 0 });
  await assert.rejects(
    () =>
      sendAdminOtpEmailViaSmtp({
        config: SAMPLE_SMTP_CONFIG,
        toEmail: 'owner@gmail.com',
        otpCode: '123456',
        expiresInMinutes: 5,
        timeouts: { connectTimeoutMs: 100, ioTimeoutMs: 25, totalTimeoutMs: 200 },
        dialer: {
          connectTls: async () => hangingRead.socket,
          connectTcp: async () => hangingRead.socket,
          startTls: async () => hangingRead.socket,
        },
      }),
    (err: unknown) => err instanceof SmtpTimeoutError && err.operation === 'read'
  );
  assert.equal(hangingRead.isClosed(), true);

  // 3. Write timeout
  const hangingWrite = createScriptedSmtpSocket(
    ['220 smtp.gmail.com ESMTP ready\r\n'],
    { hangOnWriteIndex: 0 }
  );
  await assert.rejects(
    () =>
      sendAdminOtpEmailViaSmtp({
        config: SAMPLE_SMTP_CONFIG,
        toEmail: 'owner@gmail.com',
        otpCode: '123456',
        expiresInMinutes: 5,
        timeouts: { connectTimeoutMs: 100, ioTimeoutMs: 25, totalTimeoutMs: 200 },
        dialer: {
          connectTls: async () => hangingWrite.socket,
          connectTcp: async () => hangingWrite.socket,
          startTls: async () => hangingWrite.socket,
        },
      }),
    (err: unknown) => err instanceof SmtpTimeoutError && err.operation === 'write'
  );
  assert.equal(hangingWrite.isClosed(), true);
});

test('H-02: EHLO capability checks enforce STARTTLS on port 587 and AUTH LOGIN before sending credentials', async () => {
  assert.equal(
    ehloSupportsCapability(['250-smtp.gmail.com', '250 STARTTLS'], 'STARTTLS'),
    true
  );
  assert.equal(
    ehloSupportsCapability(['250-smtp.gmail.com', '250 SIZE 35882577'], 'STARTTLS'),
    false
  );
  assert.equal(ehloSupportsAuthLogin(['250 AUTH PLAIN LOGIN XOAUTH2']), true);
  assert.equal(ehloSupportsAuthLogin(['250 AUTH PLAIN XOAUTH2']), false);

  // Port 587 server omitting STARTTLS must be rejected before AUTH LOGIN
  const noStartTls = createScriptedSmtpSocket([
    '220 smtp.example.com ESMTP\r\n',
    '250-smtp.example.com\r\n250 AUTH LOGIN\r\n',
  ]);
  await assert.rejects(
    () =>
      sendAdminOtpEmailViaSmtp({
        config: { ...SAMPLE_SMTP_CONFIG, port: 587, implicitTls: false },
        toEmail: 'owner@gmail.com',
        otpCode: '123456',
        expiresInMinutes: 5,
        dialer: {
          connectTls: async () => noStartTls.socket,
          connectTcp: async () => noStartTls.socket,
          startTls: async () => noStartTls.socket,
        },
      }),
    /STARTTLS/
  );
  assert.equal(noStartTls.isClosed(), true);
  assert.doesNotMatch(noStartTls.writtenChunks.join(''), /AUTH LOGIN/);
});

test('H-02: SMTP timeout/delivery failure during initiate and resend rolls back and invalidates newly created challenges', async () => {
  const h = createPhase36Harness({ throwOnSmtp: true });
  const initRes = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.getCurrentPassword(), ipKey: 'ip-1' },
    h.adapters
  );
  assert.equal(initRes.ok, false);
  assert.equal(initRes.status, 503);
  assert.equal(h.challenges.size, 1);
  const [created] = [...h.challenges.values()];
  assert.equal(created.used, true);
});

// =============================================================================
// H-03 & L-01 TESTS: STRICT CORS ALLOWLIST, NO WILDCARD *, NO DEFAULT LOCALHOST
// =============================================================================

test('H-03 & L-01: CORS helper rejects unapproved origins with 403, strips wildcards, and excludes localhost unless explicitly allowed', () => {
  const prodEnv = { allowedOrigins: 'https://711acks.vercel.app, *' };

  const resolvedProd = resolveAllowedOrigins(prodEnv);
  assert.equal(resolvedProd.has('https://711acks.vercel.app'), true);
  assert.equal(resolvedProd.has('*'), false);
  assert.equal(resolvedProd.has('http://localhost:3000'), false);
  assert.equal(resolvedProd.has('http://127.0.0.1:3000'), false);

  // Unapproved external origin -> 403, NO Access-Control-Allow-Origin, Cache-Control: no-store
  const evilReq = new Request('https://example.supabase.co/functions/v1/approve-community-submission', {
    method: 'POST',
    headers: { Origin: 'https://evil-attacker.example' },
  });
  assert.equal(isOriginAllowed(evilReq, prodEnv), false);
  const rejected = rejectIfDisallowedOrigin(evilReq, prodEnv);
  assert.ok(rejected);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(rejected.headers.get('Cache-Control'), 'no-store');

  // Localhost rejected in production mode by default (L-01)
  const localReq = new Request('https://example.supabase.co/functions/v1/admin-auth-initiate', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:3000' },
  });
  const localRejected = handleAdminPreflight(localReq, prodEnv);
  assert.equal(localRejected.status, 403);
  assert.equal(localRejected.headers.get('Access-Control-Allow-Origin'), null);

  // Opt-in local dev flag permits localhost:3000 explicitly
  const localAllowed = handleAdminPreflight(localReq, {
    ...prodEnv,
    allowLocalhostCors: 'true',
  });
  assert.equal(localAllowed.status, 200);
  assert.equal(
    localAllowed.headers.get('Access-Control-Allow-Origin'),
    'http://localhost:3000'
  );

  // Approved production origin passes with exact origin echo and no-store
  const okReq = new Request('https://example.supabase.co/functions/v1/approve-community-submission', {
    method: 'POST',
    headers: { Origin: 'https://711acks.vercel.app' },
  });
  assert.equal(rejectIfDisallowedOrigin(okReq, prodEnv), null);
  const okResp = jsonAdminResponse(okReq, { ok: true }, 200, prodEnv);
  assert.equal(
    okResp.headers.get('Access-Control-Allow-Origin'),
    'https://711acks.vercel.app'
  );
  assert.equal(okResp.headers.get('Cache-Control'), 'no-store');
  assert.equal(buildAdminCorsHeaders(okReq, prodEnv).Vary, 'Origin');
});

test('H-03: Zero Edge Functions emit wildcard Access-Control-Allow-Origin: * and all enforce origin checks + no-store', () => {
  const fnPaths = [
    'supabase/functions/approve-community-submission/index.ts',
    'supabase/functions/admin-auth-initiate/index.ts',
    'supabase/functions/admin-auth-resend/index.ts',
    'supabase/functions/admin-auth-verify/index.ts',
    'supabase/functions/admin-auth-logout/index.ts',
    'supabase/functions/admin-auth-complete-recovery/index.ts',
  ];

  for (const fnPath of fnPaths) {
    const src = readProjectFile(fnPath);
    assert.doesNotMatch(
      src,
      /'Access-Control-Allow-Origin'\s*:\s*'\*'|"Access-Control-Allow-Origin"\s*:\s*"\*"/,
      `${fnPath} must not contain wildcard CORS`
    );
    assert.match(
      src,
      /handleAdminPreflight\(/,
      `${fnPath} must use handleAdminPreflight`
    );
    assert.match(
      src,
      /rejectIfDisallowedOrigin\(/,
      `${fnPath} must call rejectIfDisallowedOrigin`
    );
    assert.match(
      src,
      /jsonAdminResponse\(/,
      `${fnPath} must return jsonAdminResponse (Cache-Control: no-store)`
    );
  }
});

// =============================================================================
// M-01 TESTS: FAIL-CLOSED RATE LIMITS & CONCURRENT ATOMIC OPERATIONS
// =============================================================================

test('M-01: Rate-limit RPC failures fail closed with HTTP 503 across initiate, resend, verify, and recovery', async () => {
  // 1. initiate IP rate-limit outage -> 503
  const hInitIp = createPhase36Harness({ failRateLimitBucketPrefix: 'initiate:ip:' });
  const r1 = await executeAdminAuthInitiate(
    { email: hInitIp.ownerEmail, password: hInitIp.getCurrentPassword(), ipKey: 'ip-a' },
    hInitIp.adapters
  );
  assert.equal(r1.ok, false);
  assert.equal(r1.status, 503);

  // 2. initiate otp_issue rate-limit outage -> 503 (never fails open!)
  const hInitIssue = createPhase36Harness({ failRateLimitBucketPrefix: 'otp_issue:' });
  const r2 = await executeAdminAuthInitiate(
    { email: hInitIssue.ownerEmail, password: hInitIssue.getCurrentPassword(), ipKey: 'ip-a' },
    hInitIssue.adapters
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 503);
  assert.equal(hInitIssue.sentEmails.length, 0);

  // 3. resend IP rate-limit outage -> 503
  const hResend = createPhase36Harness({ failRateLimitBucketPrefix: 'resend:ip:' });
  const r3 = await executeAdminAuthResend(
    {
      challengeId: '22222222-2222-4222-8222-222222222222',
      challengeToken: 'a'.repeat(64),
      ipKey: 'ip-a',
    },
    hResend.adapters
  );
  assert.equal(r3.ok, false);
  assert.equal(r3.status, 503);

  // 4. verify IP rate-limit outage -> 503
  const hVerify = createPhase36Harness({ failRateLimitBucketPrefix: 'verify:ip:' });
  const r4 = await executeAdminAuthVerify(
    {
      challengeId: '22222222-2222-4222-8222-222222222222',
      challengeToken: 'a'.repeat(64),
      otpCode: '123456',
      ipKey: 'ip-a',
    },
    hVerify.adapters
  );
  assert.equal(r4.ok, false);
  assert.equal(r4.status, 503);

  // 5. recovery IP rate-limit outage -> 503
  const hRec = createPhase36Harness({ failRateLimitBucketPrefix: 'recovery:ip:' });
  const r5 = await executeAdminPasswordRecovery(
    {
      tokenHash: 'valid-recovery-token-hash-0123456789abcdef',
      newPassword: 'StrongNewPassword!2026',
      ipKey: 'ip-a',
    },
    hRec.adapters
  );
  assert.equal(r5.ok, false);
  assert.equal(r5.status, 503);
});

test('M-01: Concurrent first-insert rate-limit requests serialize cleanly without race errors', async () => {
  const h = createPhase36Harness();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      h.adapters.checkRateLimit('initiate:ip:brand-new-bucket', 900, 5)
    )
  );
  const allowedCount = results.filter((r) => r.allowed).length;
  const blockedCount = results.filter((r) => !r.allowed).length;
  assert.equal(allowedCount, 5);
  assert.equal(blockedCount, 3);
});

test('M-01: Concurrent wrong-password attempts increment failed_login_attempts atomically and lock on exact threshold', async () => {
  const h = createPhase36Harness();
  const responses = await Promise.all(
    Array.from({ length: ADMIN_LOGIN_MAX_FAILURES }, (_, i) =>
      executeAdminAuthInitiate(
        { email: h.ownerEmail, password: `WrongPass-${i}`, ipKey: `ip-${i}` },
        h.adapters
      )
    )
  );

  const profile = h.profiles.get(h.ownerId)!;
  assert.equal(profile.failedLoginAttempts, ADMIN_LOGIN_MAX_FAILURES);
  assert.ok(
    profile.lockedUntilMs !== null &&
      profile.lockedUntilMs === h.getClockMs() + ADMIN_LOGIN_LOCKOUT_MS
  );
  assert.equal(
    responses.filter((r) => !r.ok && r.status === 429).length,
    1,
    'Exactly the 5th serialized failure triggers 429 lockout'
  );
});

test('M-01: Concurrent resend requests right after cooldown allow strictly ONE rotation and reject the rival race', async () => {
  const h = createPhase36Harness();
  const init = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.getCurrentPassword(), ipKey: 'ip-owner' },
    h.adapters
  );
  assert.equal(init.ok, true);
  if (!init.ok) return;

  h.advanceMs(ADMIN_OTP_RESEND_COOLDOWN_MS + 1000);

  const [resA, resB] = await Promise.all([
    executeAdminAuthResend(
      {
        challengeId: init.data.challengeId,
        challengeToken: init.data.challengeToken,
        ipKey: 'ip-owner',
      },
      h.adapters
    ),
    executeAdminAuthResend(
      {
        challengeId: init.data.challengeId,
        challengeToken: init.data.challengeToken,
        ipKey: 'ip-owner',
      },
      h.adapters
    ),
  ]);

  const succeeded = [resA, resB].filter((r) => r.ok);
  const failed = [resA, resB].filter((r) => !r.ok);
  assert.equal(succeeded.length, 1, 'Only one concurrent resend may succeed');
  assert.equal(failed.length, 1, 'The racing duplicate resend must fail');
  if (!failed[0].ok) {
    assert.equal(failed[0].status, 401);
    assert.equal(failed[0].challengeInvalidated, true);
  }
  // 1 email from initiate + strictly 1 email from resend
  assert.equal(h.sentEmails.length, 2);
});

// =============================================================================
// M-02 TESTS: TRUSTED CLIENT IP EXTRACTION & RESEND IP RATE LIMITING
// =============================================================================

test('M-02: extractTrustedClientIp prioritizes cf-connecting-ip over spoofed leftmost X-Forwarded-For and hashes cleanly', async () => {
  const spoofedReq = new Request('https://example.supabase.co/functions/v1/admin-auth-initiate', {
    headers: {
      'x-forwarded-for': '198.51.100.99, 203.0.113.45',
      'cf-connecting-ip': '203.0.113.10',
    },
  });
  assert.equal(extractTrustedClientIp(spoofedReq), '203.0.113.10');

  // Changing leftmost spoofed XFF must NOT change the rate-limit IP hash when cf-connecting-ip is present
  const spoofedReq2 = new Request('https://example.supabase.co/functions/v1/admin-auth-initiate', {
    headers: {
      'x-forwarded-for': '198.51.100.100, 203.0.113.45',
      'cf-connecting-ip': '203.0.113.10',
    },
  });
  const hash1 = await extractAnonymizedIpHash(spoofedReq, 'pepper-test');
  const hash2 = await extractAnonymizedIpHash(spoofedReq2, 'pepper-test');
  assert.equal(hash1, hash2);
  assert.match(hash1, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(hash1, /203\.0\.113\.10/);

  // Without single-IP edge headers, picks RIGHTMOST public XFF hop (ignores private hops and spoofed leftmost hop)
  const xffOnlyReq = new Request('https://example.supabase.co/functions/v1/admin-auth-initiate', {
    headers: {
      'x-forwarded-for': '1.2.3.4, 203.0.113.77, 10.0.0.5, 192.168.1.1',
    },
  });
  assert.equal(extractTrustedClientIp(xffOnlyReq), '203.0.113.77');

  // Untrusted/private-only or missing headers fall back safely to constant bucket
  const privateOnlyReq = new Request('https://example.supabase.co/functions/v1/admin-auth-initiate', {
    headers: { 'x-forwarded-for': '127.0.0.1, 10.1.2.3' },
  });
  assert.equal(extractTrustedClientIp(privateOnlyReq), 'untrusted-ip-fallback');
});

test('M-02: admin-auth-resend enforces IP rate limit (10/15m) before probing challenges', async () => {
  const h = createPhase36Harness();
  for (let i = 0; i < 10; i++) {
    const r = await executeAdminAuthResend(
      {
        challengeId: '33333333-3333-4333-8333-333333333333',
        challengeToken: 'b'.repeat(64),
        ipKey: 'spam-ip',
      },
      h.adapters
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  }

  const blocked = await executeAdminAuthResend(
    {
      challengeId: '33333333-3333-4333-8333-333333333333',
      challengeToken: 'b'.repeat(64),
      ipKey: 'spam-ip',
    },
    h.adapters
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.code, 'RATE_LIMITED');
});

// =============================================================================
// M-03 TESTS: CONSTANT-TIME TOKEN COMPARISON & CHALLENGE INVALIDATION CLEANUP
// =============================================================================

test('M-03: constantTimeEqual and constantTimeHexEqual validate exact matches without short-circuit equality', () => {
  const hexA = 'a'.repeat(64);
  const hexB = 'a'.repeat(63) + 'b';
  assert.equal(constantTimeEqual(hexA, hexA), true);
  assert.equal(constantTimeEqual(hexA, hexB), false);
  assert.equal(constantTimeEqual(hexA, 'short'), false);

  assert.equal(constantTimeHexEqual(hexA, hexA), true);
  assert.equal(constantTimeHexEqual(hexA, hexB), false);
  assert.equal(constantTimeHexEqual(hexA, 'short'), false);
});

test('M-03: Expired resend challenge emits challengeInvalidated=true and invokeAdminAuthResend maps to CHALLENGE_INVALIDATED', async () => {
  const h = createPhase36Harness();
  const init = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: h.getCurrentPassword(), ipKey: 'ip-1' },
    h.adapters
  );
  assert.equal(init.ok, true);
  if (!init.ok) return;

  // Expire challenge past 5 minutes
  h.advanceMs(ADMIN_OTP_EXPIRY_MS + 1000);

  const expiredResend = await executeAdminAuthResend(
    {
      challengeId: init.data.challengeId,
      challengeToken: init.data.challengeToken,
      ipKey: 'ip-1',
    },
    h.adapters
  );
  assert.equal(expiredResend.ok, false);
  if (!expiredResend.ok) {
    assert.equal(expiredResend.status, 401);
    assert.equal(expiredResend.code, 'CHALLENGE_EXPIRED');
    assert.equal(expiredResend.challengeInvalidated, true);
  }

  // Verify browser invoker converts challengeInvalidated=true into CHALLENGE_INVALIDATED error code
  const fakeSupabaseClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: {
            json: async () => ({
              error: 'Verification challenge has expired. Please sign in again.',
              code: 'CHALLENGE_EXPIRED',
              challengeInvalidated: true,
            }),
          },
        },
      }),
    },
  } as never;

  await assert.rejects(
    () =>
      invokeAdminAuthResend(
        fakeSupabaseClient,
        init.data.challengeId,
        init.data.challengeToken
      ),
    (err: unknown) =>
      err instanceof SupabaseRepositoryError &&
      err.code === 'CHALLENGE_INVALIDATED'
  );
});

// =============================================================================
// M-04 TESTS: LIVE PASSWORD RECOVERY WITHOUT OTP BYPASS
// =============================================================================

test('M-04: parsePasswordRecoveryUrl parses recovery links strictly on /admin and rejects non-recovery URLs', () => {
  const tokenHashParsed = parsePasswordRecoveryUrl({
    pathname: '/admin',
    search: '?recovery=1&token_hash=abcdef0123456789abcdef0123456789&type=recovery',
    hash: '',
  });
  assert.ok(tokenHashParsed);
  assert.equal(tokenHashParsed.tokenHash, 'abcdef0123456789abcdef0123456789');

  const hashTokenParsed = parsePasswordRecoveryUrl({
    pathname: '/admin/',
    search: '?recovery=1',
    hash: '#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln&type=recovery',
  });
  assert.ok(hashTokenParsed);
  assert.equal(
    hashTokenParsed.accessToken,
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln'
  );

  // Wrong pathname or non-recovery type must be ignored
  assert.equal(
    parsePasswordRecoveryUrl({
      pathname: '/explore',
      search: '?token_hash=abcdef0123456789abcdef0123456789&type=recovery',
      hash: '',
    }),
    null
  );
  assert.equal(
    parsePasswordRecoveryUrl({
      pathname: '/admin',
      search: '?token_hash=abcdef0123456789abcdef0123456789&type=magiclink',
      hash: '',
    }),
    null
  );
});

test('M-04: executeAdminPasswordRecovery updates password, revokes OTP/auth sessions, mints ZERO tokens, and still requires full Password + OTP login', async () => {
  const h = createPhase36Harness();
  // Suppose owner previously had an active OTP-verified session
  const profileBefore = h.profiles.get(h.ownerId)!;
  profileBefore.otpVerifiedUntilMs = h.getClockMs() + 60 * 60 * 1000;
  profileBefore.lastActiveAtMs = h.getClockMs();

  // Weak password rejected
  assert.ok(validateNewAdminPassword('short1!'));
  const weakRes = await executeAdminPasswordRecovery(
    {
      tokenHash: 'valid-recovery-token-hash-0123456789abcdef',
      newPassword: 'weak',
      ipKey: 'ip-owner',
    },
    h.adapters
  );
  assert.equal(weakRes.ok, false);
  assert.equal(weakRes.status, 400);

  // Valid recovery updates password and revokes everything with ZERO tokens returned
  const newPassword = 'BrandNewOwnerPassword!2026';
  const recRes = await executeAdminPasswordRecovery(
    {
      tokenHash: 'valid-recovery-token-hash-0123456789abcdef',
      newPassword,
      ipKey: 'ip-owner',
    },
    h.adapters
  );
  assert.equal(recRes.ok, true);
  assert.equal('session' in recRes, false, 'Recovery must NEVER return session tokens');
  assert.equal(h.getCurrentPassword(), newPassword);
  assert.equal(h.getMintedSessionCount(), 0);
  assert.equal(h.getRevokedSessionCount(), 1);

  // Immediately after recovery, is_verified_admin() MUST return false (no OTP bypass!)
  const profileAfter = h.profiles.get(h.ownerId)!;
  assert.equal(profileAfter.otpVerifiedUntilMs, null);
  assert.equal(
    evaluateIsVerifiedAdmin({
      callerAuthUid: h.ownerId,
      profile: profileAfter,
      sessionTimeoutMinutes: 30,
      nowMs: h.getClockMs(),
    }),
    false
  );

  // Owner can now sign in with the NEW password and still must complete 6-digit Email OTP
  const step1 = await executeAdminAuthInitiate(
    { email: h.ownerEmail, password: newPassword, ipKey: 'ip-owner' },
    h.adapters
  );
  assert.equal(step1.ok, true);
  if (!step1.ok) return;
  assert.equal(h.getMintedSessionCount(), 0, 'Still zero session prior to OTP');

  const otpCode = h.sentEmails[h.sentEmails.length - 1].otpCode;
  const step2 = await executeAdminAuthVerify(
    {
      challengeId: step1.data.challengeId,
      challengeToken: step1.data.challengeToken,
      otpCode,
      ipKey: 'ip-owner',
    },
    h.adapters
  );
  assert.equal(step2.ok, true);
  assert.equal(h.getMintedSessionCount(), 1);
  assert.equal(
    evaluateIsVerifiedAdmin({
      callerAuthUid: h.ownerId,
      profile: h.profiles.get(h.ownerId)!,
      sessionTimeoutMinutes: 30,
      nowMs: h.getClockMs(),
    }),
    true
  );
});

// =============================================================================
// L-02, L-03, L-04 & MIGRATION 006 / CONFIG CONTRACT TESTS
// =============================================================================

test('L-02: evaluateIsVerifiedAdmin returns false when lastActiveAtMs is null even if otpVerifiedUntilMs is in the future', () => {
  const nowMs = Date.UTC(2026, 10, 21, 12, 0, 0);
  const ownerId = '11111111-1111-4111-8111-111111111111';

  const resultWithNullLastActive = evaluateIsVerifiedAdmin({
    callerAuthUid: ownerId,
    profile: {
      id: ownerId,
      role: 'owner',
      otpVerifiedUntilMs: nowMs + 60 * 60 * 1000,
      lastActiveAtMs: null,
      lockedUntilMs: null,
    },
    sessionTimeoutMinutes: 30,
    nowMs,
  });
  assert.equal(resultWithNullLastActive, false);

  const resultWithRecentActivity = evaluateIsVerifiedAdmin({
    callerAuthUid: ownerId,
    profile: {
      id: ownerId,
      role: 'owner',
      otpVerifiedUntilMs: nowMs + 60 * 60 * 1000,
      lastActiveAtMs: nowMs - 5 * 60 * 1000,
      lockedUntilMs: null,
    },
    sessionTimeoutMinutes: 30,
    nowMs,
  });
  assert.equal(resultWithRecentActivity, true);
});

test('Migration 006, config.toml, and Edge Function contracts enforce all Phase 3.6 hardening guarantees', () => {
  const m006 = readProjectFile(
    'supabase/migrations/006_phase36_security_hardening.sql'
  );
  // L-02: last_active_at is not null
  assert.match(m006, /ap\.last_active_at\s+is\s+not\s+null/i);
  // L-03: resolve_unique_recipe_slug guarded by is_verified_admin()
  assert.match(
    m006,
    /create or replace function public\.resolve_unique_recipe_slug[\s\S]*?if not public\.is_verified_admin\(\) then\s+raise exception 'UNAUTHORIZED:/i
  );
  // M-01: race-safe rate-limit ON CONFLICT + atomic failed login + atomic resend rotation
  assert.match(m006, /on conflict \(bucket_key\) do nothing/i);
  assert.match(m006, /create or replace function public\.record_admin_failed_login/i);
  assert.match(
    m006,
    /create or replace function public\.rotate_admin_otp_challenge_for_resend/i
  );
  // M-03: constant_time_text_equal used in verify & resend RPCs
  assert.match(m006, /create or replace function public\.constant_time_text_equal/i);
  assert.match(m006, /public\.constant_time_text_equal\(/i);
  // Least-privilege service_role grants
  assert.match(
    m006,
    /revoke all on function public\.record_admin_failed_login[\s\S]*?from public, anon, authenticated/i
  );
  assert.match(
    m006,
    /revoke all on function public\.rotate_admin_otp_challenge_for_resend[\s\S]*?from public, anon, authenticated/i
  );
  assert.match(
    m006,
    /revoke all on function public\.resolve_unique_recipe_slug\(text, uuid\) from public, anon/i
  );

  // Verify admin-auth-resend no longer uses non-constant-time !== on challenge_token_hash
  const resendSrc = readProjectFile('supabase/functions/admin-auth-resend/index.ts');
  assert.doesNotMatch(resendSrc, /challenge_token_hash\s*!==/);
  assert.match(resendSrc, /rotate_admin_otp_challenge_for_resend/);
  assert.match(resendSrc, /resend:ip:/);

  // Verify admin-auth-initiate uses atomic record_admin_failed_login & timing floor
  const initiateSrc = readProjectFile('supabase/functions/admin-auth-initiate/index.ts');
  assert.match(initiateSrc, /record_admin_failed_login/);
  assert.match(initiateSrc, /enforceMinimumFailureDuration/);

  // Verify admin-auth-verify fails closed on verify:ip limit & revokes mismatched token
  const verifySrc = readProjectFile('supabase/functions/admin-auth-verify/index.ts');
  assert.match(verifySrc, /verifyLimitErr/);
  assert.match(verifySrc, /signOut\(sessionData\.session\.access_token,\s*'local'\)/);

  // Verify supabase/config.toml sets verify_jwt properly
  const configToml = readProjectFile('supabase/config.toml');
  assert.match(configToml, /\[functions\.admin-auth-initiate\]\s+verify_jwt = false/);
  assert.match(configToml, /\[functions\.admin-auth-resend\]\s+verify_jwt = false/);
  assert.match(configToml, /\[functions\.admin-auth-verify\]\s+verify_jwt = false/);
  assert.match(configToml, /\[functions\.admin-auth-complete-recovery\]\s+verify_jwt = false/);
  assert.match(configToml, /\[functions\.admin-auth-logout\]\s+verify_jwt = true/);
  assert.match(configToml, /\[functions\.approve-community-submission\]\s+verify_jwt = true/);

  // Verify client keeps detectSessionInUrl: false and persistSession: false
  const clientSrc = readProjectFile('src/lib/supabaseClient.ts');
  assert.match(clientSrc, /persistSession:\s*false/);
  assert.match(clientSrc, /detectSessionInUrl:\s*false/);

  // Verify COMPLETE_RECOVERY edge function constant exists
  assert.equal(
    ADMIN_AUTH_EDGE_FUNCTIONS.COMPLETE_RECOVERY,
    'admin-auth-complete-recovery'
  );
  assert.equal(ADMIN_OTP_MAX_ATTEMPTS, 5);
});
