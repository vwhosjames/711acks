// =============================================================================
// 711ACKS — SHARED SERVER-SIDE ADMIN OTP AUTH HELPERS (SUPABASE EDGE FUNCTIONS)
// =============================================================================
// Runs strictly inside Supabase Edge Functions (Deno runtime).
// NEVER imported into frontend browser bundles.
//
// TRUSTED PROXY IP HEADER ASSUMPTION (M-02):
//   Supabase Edge Functions sit behind Cloudflare / Supabase Edge Gateway.
//   The edge proxy overwrites `cf-connecting-ip` (and on compatible gateways,
//   `x-real-ip` / `x-envoy-external-address`) with the verified TCP peer IP.
//   End clients CAN inject arbitrary leftmost entries into `X-Forwarded-For`,
//   so we NEVER trust leftmost `X-Forwarded-For`. Only if no trusted single-IP
//   edge header is present do we inspect `X-Forwarded-For` from RIGHT to LEFT
//   for the rightmost valid public IP; if none is trustworthy, we fall back to
//   a shared constant bucket (`untrusted-ip-fallback`) rather than accepting
//   attacker-controlled values.
// =============================================================================

export const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
export const OTP_MAX_ATTEMPTS = 5;
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_OTP_VALIDITY_MINUTES = 120; // 2 hours absolute cap (30-min inactivity still enforced by is_verified_admin())

const LOCALHOST_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export interface CorsEnvOverride {
  allowedOrigins?: string;
  allowLocalhostCors?: string;
}

function readRuntimeEnv(key: string): string | undefined {
  const denoGlobal = (
    globalThis as unknown as {
      Deno?: { env?: { get?: (name: string) => string | undefined } };
    }
  ).Deno;
  return denoGlobal?.env?.get?.(key);
}

function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Resolves explicit CORS allowlist from `ALLOWED_ORIGINS`.
 * L-01: Never includes localhost origins in production unless explicitly listed
 * in `ALLOWED_ORIGINS` or opted in via `ALLOW_LOCALHOST_CORS=true`.
 * Never permits wildcard `*`.
 */
export function resolveAllowedOrigins(envOverride?: CorsEnvOverride): Set<string> {
  const rawAllowed =
    envOverride?.allowedOrigins ?? readRuntimeEnv('ALLOWED_ORIGINS') ?? '';
  const allowLocalhostFlag = (
    envOverride?.allowLocalhostCors ??
    readRuntimeEnv('ALLOW_LOCALHOST_CORS') ??
    ''
  )
    .trim()
    .toLowerCase();

  const allowlist = new Set<string>();
  for (const candidate of rawAllowed.split(',')) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) {
      allowlist.add(normalized);
    }
  }

  if (allowLocalhostFlag === 'true') {
    for (const devOrigin of LOCALHOST_DEV_ORIGINS) {
      allowlist.add(devOrigin);
    }
  }

  return allowlist;
}

/**
 * Checks whether a request's Origin header (when present) is explicitly allowlisted.
 * Requests without an Origin header (non-browser / server-to-server) are permitted
 * and receive no Access-Control-Allow-Origin header.
 */
export function isOriginAllowed(
  req: Request,
  envOverride?: CorsEnvOverride
): boolean {
  const requestOrigin = req.headers.get('Origin')?.trim() || '';
  if (!requestOrigin) return true;
  const normalized = normalizeOrigin(requestOrigin);
  if (!normalized) return false;
  return resolveAllowedOrigins(envOverride).has(normalized);
}

/**
 * Builds strict origin-validated CORS headers from ALLOWED_ORIGINS secret.
 * Never emits wildcard `*` on authenticated admin endpoints.
 */
export function buildAdminCorsHeaders(
  req: Request,
  envOverride?: CorsEnvOverride
): Record<string, string> {
  const allowlist = resolveAllowedOrigins(envOverride);
  const requestOrigin = req.headers.get('Origin')?.trim() || '';
  const normalizedOrigin = requestOrigin ? normalizeOrigin(requestOrigin) : null;

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };

  if (normalizedOrigin && allowlist.has(normalizedOrigin)) {
    headers['Access-Control-Allow-Origin'] = normalizedOrigin;
  }

  return headers;
}

/**
 * Rejects requests presenting an unapproved browser Origin with HTTP 403 and
 * no Access-Control-Allow-Origin header.
 */
export function rejectIfDisallowedOrigin(
  req: Request,
  envOverride?: CorsEnvOverride
): Response | null {
  if (isOriginAllowed(req, envOverride)) {
    return null;
  }

  return new Response(
    JSON.stringify({ error: 'Forbidden: Origin is not allowed.' }),
    {
      status: 403,
      headers: {
        Vary: 'Origin',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    }
  );
}

export function handleAdminPreflight(
  req: Request,
  envOverride?: CorsEnvOverride
): Response {
  const rejected = rejectIfDisallowedOrigin(req, envOverride);
  if (rejected) return rejected;

  return new Response('ok', {
    status: 200,
    headers: {
      ...buildAdminCorsHeaders(req, envOverride),
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
}

export function jsonAdminResponse(
  req: Request,
  body: Record<string, unknown>,
  status: number,
  envOverride?: CorsEnvOverride
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildAdminCorsHeaders(req, envOverride),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison (M-03): compares lengths and all byte positions
 * without short-circuiting on content mismatch.
 */
export function constantTimeEqual(a: string, b: string): boolean {
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
 * Cryptographically secure 6-digit numeric OTP using rejection sampling
 * (zero modulo bias, CSPRNG via Web Crypto getRandomValues).
 */
export function generateSecureSixDigitOtp(): string {
  const MAX_UNBIASED = 4_294_000_000; // largest multiple of 1,000,000 < 2^32
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < MAX_UNBIASED) {
      return (buf[0] % 1_000_000).toString().padStart(6, '0');
    }
  }
}

/**
 * Generates a 256-bit cryptographically random opaque challenge token.
 */
export function generateChallengeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * SHA-256 hex digest (used for challenge token hashing and anonymized IP hashing).
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Computes HMAC-SHA256(pepper, "${challengeId}:${otpCode}") for secure OTP storage.
 * Plaintext OTPs are never written to PostgreSQL or logs.
 */
export async function computeServerOtpHash(
  pepper: string,
  challengeId: string,
  otpCode: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${challengeId}:${otpCode}`)
  );
  return bytesToHex(new Uint8Array(sig));
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isValidIpv6(ip: string): boolean {
  if (!ip.includes(':') || ip.length > 45) return false;
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return false;
  if (ip.includes(':::')) return false;
  const doubleColons = ip.split('::').length - 1;
  if (doubleColons > 1) return false;
  const groups = ip.split(':').filter((g) => g.length > 0);
  if (doubleColons === 0 && groups.length !== 8) return false;
  if (doubleColons === 1 && groups.length >= 8) return false;
  return groups.every((g) => g.length <= 4);
}

function isValidIpAddress(ip: string): boolean {
  return isValidIpv4(ip) || isValidIpv6(ip);
}

function isPrivateOrNonRoutableIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (isValidIpv4(lower)) {
    const [a, b] = lower.split('.').map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    return false;
  }
  if (isValidIpv6(lower)) {
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
    if (lower.startsWith('fe80:')) return true; // Link-local fe80::/10
    return false;
  }
  return true;
}

/**
 * Extracts client IP strictly from trusted edge proxy headers (M-02):
 *   1. `cf-connecting-ip` (Cloudflare / Supabase Edge Gateway)
 *   2. `x-real-ip` (trusted reverse proxy)
 *   3. `x-envoy-external-address` (trusted Envoy edge proxy)
 *   4. Rightmost valid public IP in `x-forwarded-for` (NEVER leftmost client-spoofable hop)
 *   5. Constant `'untrusted-ip-fallback'` when no trustworthy IP is available.
 */
export function extractTrustedClientIp(req: Request): string {
  const trustedSingleHeaders = [
    'cf-connecting-ip',
    'x-real-ip',
    'x-envoy-external-address',
  ];

  for (const headerName of trustedSingleHeaders) {
    const value = req.headers.get(headerName)?.trim();
    if (value && isValidIpAddress(value)) {
      return value.toLowerCase();
    }
  }

  // Fallback only: scan X-Forwarded-For from RIGHT to LEFT to pick the last
  // proxy-appended public IP rather than client-injected leftmost entries.
  const xff = req.headers.get('x-forwarded-for') || '';
  if (xff.trim()) {
    const hops = xff
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      const candidate = hops[i];
      if (isValidIpAddress(candidate) && !isPrivateOrNonRoutableIp(candidate)) {
        return candidate.toLowerCase();
      }
    }
  }

  return 'untrusted-ip-fallback';
}

/**
 * Extracts and anonymizes the trusted caller IP address via SHA-256 for rate limiting & audit.
 * Raw IP addresses are never stored.
 */
export async function extractAnonymizedIpHash(
  req: Request,
  pepper: string
): Promise<string> {
  const trustedIp = extractTrustedClientIp(req);
  return sha256Hex(`ip:${pepper}:${trustedIp}`);
}

export function getRequiredAdminAuthEnv(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  otpPepper: string;
  otpValidityMinutes: number;
} | null {
  const supabaseUrl = readRuntimeEnv('SUPABASE_URL')?.trim();
  const supabaseAnonKey = readRuntimeEnv('SUPABASE_ANON_KEY')?.trim();
  const supabaseServiceRoleKey = readRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const otpPepper = readRuntimeEnv('ADMIN_OTP_PEPPER')?.trim();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !otpPepper) {
    return null;
  }

  const parsedValidity = Number.parseInt(
    readRuntimeEnv('ADMIN_OTP_VALIDITY_MINUTES') ||
      String(DEFAULT_OTP_VALIDITY_MINUTES),
    10
  );
  const otpValidityMinutes = Number.isFinite(parsedValidity)
    ? Math.max(15, Math.min(480, parsedValidity))
    : DEFAULT_OTP_VALIDITY_MINUTES;

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    otpPepper,
    otpValidityMinutes,
  };
}
