// =============================================================================
// 711ACKS — DIRECT TLS / STARTTLS SMTP CLIENT FOR SUPABASE EDGE FUNCTIONS
// =============================================================================
// Uses Deno native TLS/TCP sockets — zero paid email API dependency.
// All credentials are read strictly from Edge Function secrets:
//   - SMTP_HOST   (e.g. smtp.gmail.com)
//   - SMTP_PORT   (465 for implicit TLS, or 587 for STARTTLS)
//   - SMTP_USER   (authenticated SMTP username / Gmail address)
//   - SMTP_PASS   (SMTP password / 16-char Google App Password)
//   - SMTP_FROM   (optional From address: bare email or "Display Name <email>")
//   - SMTP_SECURE (optional 'true'/'false'; defaults to true when port === 465)
//
// SECURITY GUARANTEES (H-02 HARDENED):
//   - Never hardcodes credentials.
//   - Never logs SMTP_PASS or the plaintext OTP code.
//   - Rejects CR/LF/NUL header injection in sender, recipient, and subject.
//   - Parses `SMTP_FROM` safely (bare email OR "Display Name <email>") so
//     envelope `MAIL FROM:<addr>` always receives ONLY the validated bare email
//     while `From:` preserves the display name without double angle brackets.
//   - Enforces strict connection, read, write, and total session timeouts with
//     guaranteed socket cleanup so stalled SMTP servers cannot hang workers or
//     bypass challenge invalidation.
//   - Caps SMTP response buffer size (64 KB) and line count (100 lines).
//   - Verifies EHLO capabilities (`STARTTLS` on 587 and `AUTH LOGIN`) before
//     sending credentials and preserves full TLS certificate verification.
// =============================================================================

export const DEFAULT_SMTP_CONNECT_TIMEOUT_MS = 8_000;
export const DEFAULT_SMTP_IO_TIMEOUT_MS = 8_000;
export const DEFAULT_SMTP_TOTAL_TIMEOUT_MS = 15_000;
export const MAX_SMTP_BUFFER_BYTES = 64 * 1024;
export const MAX_SMTP_RESPONSE_LINES = 100;

const EMAIL_ADDRESS_REGEX =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export class SmtpTimeoutError extends Error {
  public readonly operation: string;
  public readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`SMTP ${operation} timed out after ${timeoutMs}ms.`);
    this.name = 'SmtpTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  implicitTls: boolean;
}

export interface ParsedSmtpSender {
  address: string;
  displayName: string;
  formattedHeader: string;
}

export interface SmtpTimeoutOptions {
  connectTimeoutMs?: number;
  ioTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface SmtpSocketLike {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
}

export interface SmtpDialer {
  connectTls(hostname: string, port: number): Promise<SmtpSocketLike>;
  connectTcp(hostname: string, port: number): Promise<SmtpSocketLike>;
  startTls(conn: SmtpSocketLike, hostname: string): Promise<SmtpSocketLike>;
}

function readRuntimeEnv(key: string): string | undefined {
  const denoGlobal = (
    globalThis as unknown as {
      Deno?: { env?: { get?: (name: string) => string | undefined } };
    }
  ).Deno;
  return denoGlobal?.env?.get?.(key);
}

export function assertNoHeaderInjection(value: string, field: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`Invalid SMTP header value in ${field}.`);
  }
}

export function isValidEmailAddress(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  if (/[\r\n\0<>]/.test(trimmed)) return false;
  return EMAIL_ADDRESS_REGEX.test(trimmed);
}

function formatDisplayName(displayName: string): string {
  const clean = displayName.trim().replace(/^"(.*)"$/, '$1').trim();
  assertNoHeaderInjection(clean, 'from.displayName');
  if (!clean) return '711acks Security';
  if (/["\\<>]/.test(clean)) {
    throw new Error('Invalid characters in SMTP sender display name.');
  }
  if (/[,;:()@[\]]/.test(clean)) {
    return `"${clean}"`;
  }
  return clean;
}

/**
 * Parses `SMTP_FROM` whether provided as a bare email (`owner@gmail.com`) or
 * with a display name (`711acks Security <owner@gmail.com>`).
 * Returns the validated bare email for SMTP `MAIL FROM:<address>` and a clean
 * single-bracketed `From:` header string.
 */
export function parseSmtpSender(rawFrom: string): ParsedSmtpSender {
  const trimmed = (rawFrom || '').trim();
  assertNoHeaderInjection(trimmed, 'from');

  if (!trimmed) {
    throw new Error('SMTP sender address is required.');
  }

  let displayName = '711acks Security';
  let address = trimmed;

  if (trimmed.includes('<') || trimmed.includes('>')) {
    const match = trimmed.match(/^(.*?)<([^<>]+)>$/);
    if (!match) {
      throw new Error('Invalid SMTP_FROM mailbox syntax.');
    }
    const rawName = match[1].trim();
    address = match[2].trim();
    if (rawName.includes('<') || rawName.includes('>')) {
      throw new Error('Invalid nested angle brackets in SMTP_FROM.');
    }
    if (rawName.length > 0) {
      displayName = formatDisplayName(rawName);
    }
  }

  const normalizedAddress = address.toLowerCase();
  if (!isValidEmailAddress(normalizedAddress)) {
    throw new Error('Invalid SMTP_FROM email address syntax.');
  }

  const safeDisplayName = formatDisplayName(displayName);
  return {
    address: normalizedAddress,
    displayName: safeDisplayName.replace(/^"(.*)"$/, '$1'),
    formattedHeader: `${safeDisplayName} <${normalizedAddress}>`,
  };
}

export function loadSmtpConfigFromEnv(): SmtpConfig | null {
  const host = readRuntimeEnv('SMTP_HOST')?.trim();
  const portRaw = readRuntimeEnv('SMTP_PORT')?.trim() || '465';
  const user = readRuntimeEnv('SMTP_USER')?.trim();
  const pass = readRuntimeEnv('SMTP_PASS');
  const from = readRuntimeEnv('SMTP_FROM')?.trim() || user;
  const secureFlag = readRuntimeEnv('SMTP_SECURE')?.trim().toLowerCase();

  const port = Number.parseInt(portRaw, 10);
  if (!host || !user || !pass || !from || !Number.isFinite(port)) {
    return null;
  }
  if (port !== 465 && port !== 587) {
    return null;
  }

  try {
    assertNoHeaderInjection(host, 'host');
    assertNoHeaderInjection(user, 'user');
    parseSmtpSender(from);
  } catch {
    return null;
  }

  const implicitTls =
    secureFlag === 'true'
      ? true
      : secureFlag === 'false'
        ? false
        : port === 465;

  return { host, port, user, pass, from, implicitTls };
}

function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function withTimeout<T>(
  operationPromise: Promise<T>,
  timeoutMs: number,
  operationLabel: string,
  onTimeout?: () => void
): Promise<T> {
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      timedOut = true;
      try {
        onTimeout?.();
      } catch {
        // ignore cleanup error on timeout
      }
      reject(new SmtpTimeoutError(operationLabel, boundedTimeoutMs));
    }, boundedTimeoutMs);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    if (timedOut) {
      // Prevent unhandled rejection if the underlying promise rejects after timeout
      operationPromise.catch(() => {});
    }
  }
}

export function ehloSupportsCapability(
  ehloLines: string[],
  capability: string
): boolean {
  const upperCap = capability.toUpperCase();
  return ehloLines.some((line) => {
    const body = line.replace(/^\d{3}[- ]/, '').trim().toUpperCase();
    return body === upperCap || body.startsWith(`${upperCap} `) || body.startsWith(`${upperCap}=`);
  });
}

export function ehloSupportsAuthLogin(ehloLines: string[]): boolean {
  return ehloLines.some((line) => {
    const body = line.replace(/^\d{3}[- ]/, '').trim().toUpperCase();
    if (!body.startsWith('AUTH ') && !body.startsWith('AUTH=')) {
      return false;
    }
    const tokens = body.slice(5).split(/[\s=]+/).filter(Boolean);
    return tokens.includes('LOGIN');
  });
}

export class SmtpSocketSession {
  private conn: SmtpSocketLike;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private buffer = '';
  private ioTimeoutMs: number;
  private deadlineAtMs: number;

  constructor(
    conn: SmtpSocketLike,
    options?: { ioTimeoutMs?: number; totalTimeoutMs?: number }
  ) {
    this.conn = conn;
    this.ioTimeoutMs = options?.ioTimeoutMs ?? DEFAULT_SMTP_IO_TIMEOUT_MS;
    const totalMs = options?.totalTimeoutMs ?? DEFAULT_SMTP_TOTAL_TIMEOUT_MS;
    this.deadlineAtMs = Date.now() + totalMs;
  }

  replaceConnection(conn: SmtpSocketLike): void {
    this.conn = conn;
    this.buffer = '';
  }

  close(): void {
    try {
      this.conn.close();
    } catch {
      // ignore close errors
    }
  }

  private remainingTimeoutMs(operationLabel: string): number {
    const remainingTotal = this.deadlineAtMs - Date.now();
    if (remainingTotal <= 0) {
      this.close();
      throw new SmtpTimeoutError(operationLabel, this.ioTimeoutMs);
    }
    return Math.min(this.ioTimeoutMs, remainingTotal);
  }

  async readResponse(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    const chunk = new Uint8Array(4096);

    while (true) {
      let newlineIdx = this.buffer.indexOf('\r\n');
      while (newlineIdx === -1) {
        const timeoutMs = this.remainingTimeoutMs('read');
        const readCount = await withTimeout(
          this.conn.read(chunk),
          timeoutMs,
          'read',
          () => this.close()
        );
        if (readCount === null) {
          throw new Error('SMTP connection closed unexpectedly.');
        }
        this.buffer += this.decoder.decode(chunk.subarray(0, readCount));
        if (this.buffer.length > MAX_SMTP_BUFFER_BYTES) {
          this.close();
          throw new Error('SMTP response exceeded maximum allowed buffer size.');
        }
        newlineIdx = this.buffer.indexOf('\r\n');
      }

      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 2);
      lines.push(line);

      if (lines.length > MAX_SMTP_RESPONSE_LINES) {
        this.close();
        throw new Error('SMTP response exceeded maximum allowed line count.');
      }

      // Final line of SMTP reply has a space after the 3-digit status code
      if (/^\d{3} /.test(line)) {
        const code = Number.parseInt(line.slice(0, 3), 10);
        return { code, lines };
      }
    }
  }

  async sendCommand(
    command: string,
    expectedCodes: number[]
  ): Promise<{ code: number; lines: string[] }> {
    await this.writeRaw(`${command}\r\n`);
    const resp = await this.readResponse();
    if (!expectedCodes.includes(resp.code)) {
      throw new Error(`SMTP command failed with status ${resp.code}.`);
    }
    return resp;
  }

  async writeRaw(payload: string): Promise<void> {
    const data = this.encoder.encode(payload);
    let offset = 0;
    while (offset < data.length) {
      const timeoutMs = this.remainingTimeoutMs('write');
      const written = await withTimeout(
        this.conn.write(data.subarray(offset)),
        timeoutMs,
        'write',
        () => this.close()
      );
      if (written <= 0) {
        throw new Error('Failed to write payload to SMTP socket.');
      }
      offset += written;
    }
  }
}

function dotStuffBody(body: string): string {
  return body
    .replace(/\r?\n/g, '\r\n')
    .replace(/^\./gm, '..');
}

interface DenoSocketRuntime {
  connectTls(options: { hostname: string; port: number }): Promise<SmtpSocketLike>;
  connect(options: { hostname: string; port: number }): Promise<SmtpSocketLike>;
  startTls(conn: SmtpSocketLike, options: { hostname: string }): Promise<SmtpSocketLike>;
}

declare const Deno: DenoSocketRuntime | undefined;

function createDenoDialer(): SmtpDialer {
  return {
    connectTls: (hostname, port) => {
      if (typeof Deno?.connectTls !== 'function') {
        throw new Error('Deno TLS socket runtime is unavailable.');
      }
      return Deno.connectTls({ hostname, port });
    },
    connectTcp: (hostname, port) => {
      if (typeof Deno?.connect !== 'function') {
        throw new Error('Deno TCP socket runtime is unavailable.');
      }
      return Deno.connect({ hostname, port });
    },
    startTls: (conn, hostname) => {
      if (typeof Deno?.startTls !== 'function') {
        throw new Error('Deno STARTTLS socket runtime is unavailable.');
      }
      return Deno.startTls(conn, { hostname });
    },
  };
}

export async function sendAdminOtpEmailViaSmtp(params: {
  config: SmtpConfig;
  toEmail: string;
  otpCode: string;
  expiresInMinutes: number;
  timeouts?: SmtpTimeoutOptions;
  dialer?: SmtpDialer;
}): Promise<void> {
  const { config, toEmail, otpCode, expiresInMinutes } = params;
  const connectTimeoutMs =
    params.timeouts?.connectTimeoutMs ?? DEFAULT_SMTP_CONNECT_TIMEOUT_MS;
  const ioTimeoutMs =
    params.timeouts?.ioTimeoutMs ?? DEFAULT_SMTP_IO_TIMEOUT_MS;
  const totalTimeoutMs =
    params.timeouts?.totalTimeoutMs ?? DEFAULT_SMTP_TOTAL_TIMEOUT_MS;
  const dialer = params.dialer ?? createDenoDialer();

  const cleanTo = toEmail.trim().toLowerCase();
  const parsedFrom = parseSmtpSender(config.from);
  const subject = '711acks Admin Verification Code (Single-Use)';

  assertNoHeaderInjection(cleanTo, 'toEmail');
  assertNoHeaderInjection(subject, 'subject');
  assertNoHeaderInjection(config.host, 'host');
  assertNoHeaderInjection(config.user, 'user');

  if (!isValidEmailAddress(cleanTo)) {
    throw new Error('Invalid recipient email address.');
  }

  let timedOutDuringConnect = false;
  const rawConnectPromise = config.implicitTls
    ? dialer.connectTls(config.host, config.port)
    : dialer.connectTcp(config.host, config.port);

  // If a connect resolves AFTER timeout, close it immediately to avoid FD leaks
  rawConnectPromise
    .then((lateConn) => {
      if (timedOutDuringConnect) {
        try {
          lateConn.close();
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});

  let conn = await withTimeout(
    rawConnectPromise,
    Math.min(connectTimeoutMs, totalTimeoutMs),
    'connect',
    () => {
      timedOutDuringConnect = true;
    }
  );

  const session = new SmtpSocketSession(conn, { ioTimeoutMs, totalTimeoutMs });

  try {
    const greeting = await session.readResponse();
    if (greeting.code !== 220) {
      throw new Error(`SMTP server rejected connection (${greeting.code}).`);
    }

    let ehloResp = await session.sendCommand('EHLO 711acks.local', [250]);

    if (!config.implicitTls) {
      if (!ehloSupportsCapability(ehloResp.lines, 'STARTTLS')) {
        throw new Error('SMTP server did not advertise mandatory STARTTLS support.');
      }

      await session.sendCommand('STARTTLS', [220]);
      conn = await withTimeout(
        dialer.startTls(conn, config.host),
        Math.min(connectTimeoutMs, totalTimeoutMs),
        'startTls',
        () => session.close()
      );
      session.replaceConnection(conn);
      ehloResp = await session.sendCommand('EHLO 711acks.local', [250]);
    }

    if (!ehloSupportsAuthLogin(ehloResp.lines)) {
      throw new Error('SMTP server did not advertise AUTH LOGIN support over TLS.');
    }

    // Authenticate with AUTH LOGIN over active TLS channel
    await session.sendCommand('AUTH LOGIN', [334]);
    await session.sendCommand(toBase64(config.user), [334]);
    await session.sendCommand(toBase64(config.pass), [235]);

    // Envelope MAIL FROM strictly uses the bare validated email address
    await session.sendCommand(`MAIL FROM:<${parsedFrom.address}>`, [250]);
    await session.sendCommand(`RCPT TO:<${cleanTo}>`, [250, 251]);
    await session.sendCommand('DATA', [354]);

    const dateHeader = new Date().toUTCString();
    const messageId = `<otp-${crypto.randomUUID()}@711acks.ph>`;
    const plainBody = [
      '711acks Administrator Verification',
      '',
      `Your single-use 6-digit verification code is: ${otpCode}`,
      '',
      `This code expires in ${expiresInMinutes} minutes and can only be used once.`,
      'If you did not attempt to sign in to the 711acks Admin Console, change your owner password immediately.',
    ].join('\r\n');

    const mimeMessage = [
      `From: ${parsedFrom.formattedHeader}`,
      `To: <${cleanTo}>`,
      `Subject: ${subject}`,
      `Date: ${dateHeader}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'X-Auto-Response-Suppress: All',
      '',
      dotStuffBody(plainBody),
      '.',
      '',
    ].join('\r\n');

    await session.writeRaw(mimeMessage);
    const dataResp = await session.readResponse();
    if (dataResp.code !== 250) {
      throw new Error(`SMTP server rejected email payload (${dataResp.code}).`);
    }

    await session.sendCommand('QUIT', [221]).catch(() => {});
  } finally {
    session.close();
  }
}
