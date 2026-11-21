import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_BACKUP_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_BACKUP_FILE_SIZE_BYTES,
  MAX_IMAGE_FILE_SIZE_BYTES,
  PENDING_SUBMISSION_PATH_PATTERN,
  STORAGE_BUCKETS,
  STORAGE_BUCKET_CONFIGS,
  buildPendingSubmissionStoragePath,
  isRelativeStoragePath,
  validateImageFileMetadata,
} from './supabaseStorage';

const ROOT_DIR = process.cwd();
const MIGRATION_001 = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/001_711acks_schema.sql'),
  'utf8'
);
const MIGRATION_002 = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/002_phase2_database_foundation.sql'),
  'utf8'
);
const MIGRATION_003 = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/003_storage_setup.sql'),
  'utf8'
);
const REPOSITORY_SRC = fs.readFileSync(
  path.join(ROOT_DIR, 'src/lib/supabaseRepository.ts'),
  'utf8'
);

interface ParsedPolicy {
  name: string;
  operation: 'select' | 'insert' | 'update' | 'delete' | 'all';
  roles: string[];
  body: string;
}

function parseStoragePolicies(sql: string): ParsedPolicy[] {
  const regex =
    /create\s+policy\s+"([^"]+)"\s+on\s+storage\.objects\s+for\s+(select|insert|update|delete|all)\s+to\s+([a-z,\s]+?)\s+((?:using|with\s+check)[\s\S]*?);/gi;
  const policies: ParsedPolicy[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sql)) !== null) {
    policies.push({
      name: match[1],
      operation: match[2].toLowerCase() as ParsedPolicy['operation'],
      roles: match[3]
        .split(',')
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean),
      body: match[4],
    });
  }
  return policies;
}

function extractBucketInsertBlock(sql: string, bucketId: string): string {
  const pattern = new RegExp(
    `insert\\s+into\\s+storage\\.buckets[\\s\\S]*?values\\s*\\(\\s*'${bucketId}'[\\s\\S]*?;`,
    'i'
  );
  const match = sql.match(pattern);
  assert.ok(match, `Expected storage.buckets upsert block for '${bucketId}'`);
  return match[0];
}

// =============================================================================
// 1. BUCKET CONFIGURATION EXPECTATIONS
// =============================================================================

test('003_storage_setup.sql provisions all four required buckets idempotently with strict limits', () => {
  const expectedBuckets = [
    STORAGE_BUCKETS.PENDING_SUBMISSIONS,
    STORAGE_BUCKETS.PUBLISHED_DRINKS,
    STORAGE_BUCKETS.VERIFIED_PRODUCTS,
    STORAGE_BUCKETS.PRIVATE_ADMIN_BACKUPS,
  ];

  for (const bucketId of expectedBuckets) {
    const spec = STORAGE_BUCKET_CONFIGS[bucketId];
    const block = extractBucketInsertBlock(MIGRATION_003, bucketId);

    // Must be idempotent via ON CONFLICT (id) DO UPDATE
    assert.match(block, /on\s+conflict\s*\(\s*id\s*\)\s+do\s+update/i);

    // Public flag must match specification exactly
    const publicRegex = new RegExp(
      `'${bucketId}'\\s*,\\s*'${bucketId}'\\s*,\\s*${spec.public ? 'true' : 'false'}\\s*,\\s*${spec.fileSizeLimitBytes}`,
      'i'
    );
    assert.match(
      block,
      publicRegex,
      `Bucket '${bucketId}' must set public=${spec.public} and file_size_limit=${spec.fileSizeLimitBytes}`
    );

    // Allowed MIME types must match specification exactly
    for (const mime of spec.allowedMimeTypes) {
      assert.ok(
        block.includes(`'${mime}'`),
        `Bucket '${bucketId}' must allow MIME type '${mime}'`
      );
    }
  }

  // Private buckets must strictly be public = false
  assert.equal(STORAGE_BUCKET_CONFIGS[STORAGE_BUCKETS.PENDING_SUBMISSIONS].public, false);
  assert.equal(STORAGE_BUCKET_CONFIGS[STORAGE_BUCKETS.PRIVATE_ADMIN_BACKUPS].public, false);

  // Image buckets must enforce 5 MB and JPEG/PNG/WebP
  assert.equal(MAX_IMAGE_FILE_SIZE_BYTES, 5242880);
  assert.deepEqual([...ALLOWED_IMAGE_MIME_TYPES], [
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);
  assert.equal(MAX_BACKUP_FILE_SIZE_BYTES, 10485760);
  assert.deepEqual([...ALLOWED_BACKUP_MIME_TYPES], ['application/json']);
});

test('003_storage_setup.sql avoids risky ALTER TABLE storage.objects ownership failure', () => {
  const nonCommentSql = MIGRATION_003.replace(/--.*$/gm, '');
  assert.doesNotMatch(
    nonCommentSql,
    /alter\s+table\s+storage\.objects/i,
    'Should not run ALTER TABLE storage.objects which fails with 42501 under postgres role on hosted Supabase'
  );
});

// =============================================================================
// 2. UPLOAD PATH COMPATIBILITY (supabaseStorage.ts <-> 003_storage_setup.sql)
// =============================================================================

test('buildPendingSubmissionStoragePath output matches exact regex enforced by 003_storage_setup.sql', () => {
  const policies = parseStoragePolicies(MIGRATION_003);
  const pendingInsertPolicy = policies.find(
    (p) =>
      p.operation === 'insert' &&
      p.body.includes("bucket_id = 'pending-submissions'")
  );
  assert.ok(pendingInsertPolicy, 'Expected pending-submissions INSERT policy');

  const regexMatch = pendingInsertPolicy.body.match(/name\s*~\s*'([^']+)'/);
  assert.ok(regexMatch, 'Expected regex check on name in pending-submissions INSERT policy');
  const sqlRegex = new RegExp(regexMatch[1]);

  const fixedDate = new Date('2026-11-20T07:00:00.000Z');
  const kinds = ['finished-drink', 'suggested-product'] as const;
  const mimes = ['image/jpeg', 'image/png', 'image/webp'] as const;

  for (const kind of kinds) {
    for (const mime of mimes) {
      const generated = buildPendingSubmissionStoragePath(kind, mime, fixedDate);
      assert.ok(
        sqlRegex.test(generated),
        `Generated path '${generated}' must satisfy SQL RLS regex '${regexMatch[1]}'`
      );
      assert.ok(
        PENDING_SUBMISSION_PATH_PATTERN.test(generated),
        `Generated path '${generated}' must satisfy TS PENDING_SUBMISSION_PATH_PATTERN`
      );
      assert.equal(isRelativeStoragePath(generated), true);
    }
  }

  // Malicious, traversal, inline data URL, and arbitrary paths must be rejected by SQL regex
  const invalidPaths = [
    '../published-drinks/2026-11-20/0123456789abcdef0123456789abcdef.jpg',
    '/finished-drink/2026-11-20/0123456789abcdef0123456789abcdef.jpg',
    'finished-drink/2026-11-20/my-original-filename.jpg',
    'finished-drink/2026-11-20/0123456789abcdef0123456789abcdef.svg',
    'finished-drink/2026-11-20/0123456789abcdef0123456789abcdef.html',
    'finished-drink/2026-11-20/0123456789abcdef0123456789abcdef.jpg.exe',
    'arbitrary-prefix/2026-11-20/0123456789abcdef0123456789abcdef.jpg',
    'finished-drink/2026-11-20/short.jpg',
    'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    'https://example.com/drink.jpg',
  ];

  for (const badPath of invalidPaths) {
    assert.equal(
      sqlRegex.test(badPath),
      false,
      `Invalid path '${badPath}' must be rejected by SQL RLS regex`
    );
  }
});

// =============================================================================
// 3. ANONYMOUS UPLOAD RESTRICTIONS & ZERO UNAUTHORIZED ACCESS
// =============================================================================

test('pending-submissions grants anon ONLY INSERT and denies anon SELECT, UPDATE, and DELETE', () => {
  const policies = parseStoragePolicies(MIGRATION_003);
  const pendingPolicies = policies.filter((p) =>
    p.body.includes("bucket_id = 'pending-submissions'")
  );

  assert.equal(pendingPolicies.length, 4, 'Expected exactly 4 policies on pending-submissions');

  const anonPendingPolicies = pendingPolicies.filter((p) => p.roles.includes('anon'));
  assert.equal(
    anonPendingPolicies.length,
    1,
    'anon must only have a single INSERT policy on pending-submissions'
  );
  assert.equal(anonPendingPolicies[0].operation, 'insert');

  // SELECT, UPDATE, DELETE on pending-submissions must be authenticated + is_verified_admin()
  for (const op of ['select', 'update', 'delete'] as const) {
    const opPolicies = pendingPolicies.filter((p) => p.operation === op);
    assert.equal(opPolicies.length, 1, `Expected 1 ${op} policy on pending-submissions`);
    assert.deepEqual(opPolicies[0].roles, ['authenticated']);
    assert.match(opPolicies[0].body, /public\.is_verified_admin\(\)/);
  }
});

// =============================================================================
// 4. ADMIN-ONLY PRIVATE BACKUP ACCESS
// =============================================================================

test('private-admin-backups denies all anon access and enforces public.is_verified_admin() on all CRUD ops', () => {
  const policies = parseStoragePolicies(MIGRATION_003);
  const backupPolicies = policies.filter((p) =>
    p.body.includes("bucket_id = 'private-admin-backups'")
  );

  assert.equal(backupPolicies.length, 4, 'Expected SELECT, INSERT, UPDATE, DELETE policies on private-admin-backups');

  for (const op of ['select', 'insert', 'update', 'delete'] as const) {
    const policy = backupPolicies.find((p) => p.operation === op);
    assert.ok(policy, `Expected ${op} policy for private-admin-backups`);
    assert.equal(
      policy.roles.includes('anon'),
      false,
      `anon must never have ${op} access to private-admin-backups`
    );
    assert.deepEqual(policy.roles, ['authenticated']);
    assert.match(policy.body, /public\.is_verified_admin\(\)/);
  }

  // Backup insert/update regex must allow app backup filenames and reject non-JSON
  const insertPolicy = backupPolicies.find((p) => p.operation === 'insert')!;
  const regexMatch = insertPolicy.body.match(/name\s*~\s*'([^']+)'/);
  assert.ok(regexMatch);
  const backupRegex = new RegExp(regexMatch[1]);
  assert.equal(backupRegex.test('711acks-full-backup-2026-11-20.json'), true);
  assert.equal(backupRegex.test('2026-11-20/711acks-full-backup-2026-11-20.json'), true);
  assert.equal(backupRegex.test('evil.html'), false);
  assert.equal(backupRegex.test('../backup.json'), false);
});

// =============================================================================
// 5. PUBLIC ASSET BUCKETS (published-drinks & verified-products)
// =============================================================================

test('published-drinks and verified-products allow public SELECT and restrict writes to verified admin', () => {
  const policies = parseStoragePolicies(MIGRATION_003);

  for (const bucketId of [
    STORAGE_BUCKETS.PUBLISHED_DRINKS,
    STORAGE_BUCKETS.VERIFIED_PRODUCTS,
  ]) {
    const bucketPolicies = policies.filter((p) =>
      p.body.includes(`bucket_id = '${bucketId}'`)
    );
    assert.equal(
      bucketPolicies.length,
      4,
      `Expected 4 policies (SELECT/INSERT/UPDATE/DELETE) for '${bucketId}'`
    );

    const selectPolicy = bucketPolicies.find((p) => p.operation === 'select');
    assert.ok(selectPolicy);
    assert.ok(selectPolicy.roles.includes('anon'));
    assert.ok(selectPolicy.roles.includes('authenticated'));

    for (const writeOp of ['insert', 'update', 'delete'] as const) {
      const writePolicy = bucketPolicies.find((p) => p.operation === writeOp);
      assert.ok(writePolicy, `Expected ${writeOp} policy on '${bucketId}'`);
      assert.equal(
        writePolicy.roles.includes('anon'),
        false,
        `anon must never have ${writeOp} access on '${bucketId}'`
      );
      assert.deepEqual(writePolicy.roles, ['authenticated']);
      assert.match(writePolicy.body, /public\.is_verified_admin\(\)/);
    }
  }
});

test('every storage.objects policy is strictly bucket-scoped (no global wildcard policies)', () => {
  const policies = parseStoragePolicies(MIGRATION_003);
  assert.equal(policies.length, 16, 'Expected 16 total bucket-scoped policies across 4 buckets');

  for (const policy of policies) {
    assert.match(
      policy.body,
      /bucket_id\s*=\s*'(pending-submissions|published-drinks|verified-products|private-admin-backups)'/,
      `Policy "${policy.name}" must be explicitly scoped to one of the 4 buckets`
    );
  }
});

// =============================================================================
// 6. CROSS-MIGRATION & REPOSITORY CONTRACT CONSISTENCY (001 + 002 + Repo)
// =============================================================================

test('all RPCs invoked by supabaseRepository.ts exist in 002_phase2_database_foundation.sql with explicit grants', () => {
  const rpcCalls = [...REPOSITORY_SRC.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)].map(
    (m) => m[1]
  );
  const uniqueRpcNames = [...new Set(rpcCalls)];
  assert.ok(uniqueRpcNames.length >= 9, 'Expected at least 9 RPCs in repository');

  for (const rpcName of uniqueRpcNames) {
    assert.match(
      MIGRATION_002,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpcName}\\s*\\(`, 'i'),
      `RPC '${rpcName}' called in supabaseRepository.ts must exist in 002_phase2_database_foundation.sql`
    );
    assert.match(
      MIGRATION_002,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${rpcName}\\b`, 'i'),
      `RPC '${rpcName}' must have an explicit GRANT EXECUTE statement in 002`
    );
  }

  // is_verified_admin() must exist in both 001 and 002 and be granted to anon, authenticated
  assert.match(MIGRATION_001, /create\s+or\s+replace\s+function\s+public\.is_verified_admin\(\)/i);
  assert.match(MIGRATION_002, /create\s+or\s+replace\s+function\s+public\.is_verified_admin\(\)/i);
  assert.match(
    MIGRATION_002,
    /grant\s+execute\s+on\s+function\s+public\.is_verified_admin\(\)\s+to\s+anon,\s*authenticated;/i
  );
});

test('image validation enforces 5MB cap and JPEG/PNG/WebP MIME allowlist matching Storage bucket limits', () => {
  assert.equal(
    validateImageFileMetadata({
      mimeType: 'image/jpeg',
      sizeBytes: MAX_IMAGE_FILE_SIZE_BYTES,
      width: 1000,
      height: 1000,
    }).valid,
    true
  );

  assert.equal(
    validateImageFileMetadata({
      mimeType: 'image/jpeg',
      sizeBytes: MAX_IMAGE_FILE_SIZE_BYTES + 1,
      width: 1000,
      height: 1000,
    }).valid,
    false
  );

  assert.equal(
    validateImageFileMetadata({
      mimeType: 'image/svg+xml',
      sizeBytes: 2048,
      width: 500,
      height: 500,
    }).valid,
    false
  );
});
