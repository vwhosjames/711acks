import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  APPROVE_SUBMISSION_EDGE_FUNCTION,
  TrustedApprovalServerAdapters,
  buildPromotedPublishedDrinkPath,
  executeTrustedSubmissionApproval,
  invokeApproveCommunitySubmissionEdgeFunction,
  isApprovedPublishedPhotoUrl,
} from './communityApprovalController';
import { resolveUniqueRecipeSlug } from '../utils/drinkLogic';
import type { DrinkRecipe, RecipeIngredient } from '../types/domain';

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
const MIGRATION_004 = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/migrations/004_phase2d_security_hardening.sql'),
  'utf8'
);
const EDGE_FUNCTION_SRC = fs.readFileSync(
  path.join(ROOT_DIR, 'supabase/functions/approve-community-submission/index.ts'),
  'utf8'
);

const SAMPLE_INGREDIENT: RecipeIngredient = {
  id: 'ing-1',
  productId: 'prod-kopiko',
  productNameSnapshot: 'Kopiko Lucky Day 180ml',
  productPhotoSnapshot: '/kopiko.jpg',
  quantityUsed: '1 bottle (180ml)',
  unitsToPurchase: 1,
  priceSnapshot: 29,
  priceVerified: true,
};

const VALID_PENDING_PATH =
  'finished-drink/2026-11-20/0123456789abcdef0123456789abcdef.jpg';

// =============================================================================
// 1. DIRECT PUBLIC INSERT POLICIES REMOVED & RPC PERMISSIONS PRESERVED
// =============================================================================

test('004_phase2d_security_hardening.sql drops all four exact legacy public direct-INSERT policies', () => {
  const expectedDrops: Array<{ policy: string; table: string; sourceSql: string }> = [
    {
      policy: 'Public can insert pending community submissions',
      table: 'public.community_submissions',
      sourceSql: MIGRATION_001,
    },
    {
      policy: 'Public can insert submission ingredients',
      table: 'public.submission_ingredients',
      sourceSql: MIGRATION_002,
    },
    {
      policy: 'Public can insert product suggestions',
      table: 'public.product_suggestions',
      sourceSql: MIGRATION_002,
    },
    {
      policy: 'Public can submit contact reports',
      table: 'public.contact_reports',
      sourceSql: MIGRATION_001,
    },
  ];

  for (const item of expectedDrops) {
    // Verify the policy name actually existed in 001 or 002
    assert.ok(
      item.sourceSql.includes(`"${item.policy}"`),
      `Policy "${item.policy}" must match an actual policy in earlier migrations`
    );

    // Verify 004 drops it explicitly on the exact table
    const dropRegex = new RegExp(
      `drop\\s+policy\\s+if\\s+exists\\s+"${item.policy}"\\s+on\\s+${item.table.replace('.', '\\.')};`,
      'i'
    );
    assert.match(
      MIGRATION_004,
      dropRegex,
      `004 must drop "${item.policy}" on ${item.table}`
    );
  }

  // Must NOT re-create any direct public insert policy as a workaround
  const nonCommentSql = MIGRATION_004.replace(/--.*$/gm, '');
  assert.doesNotMatch(
    nonCommentSql,
    /create\s+policy\s+/i,
    '004 should not grant new direct table write policies'
  );
});

test('004 preserves approved public SECURITY DEFINER RPCs and Maintenance Mode enforcement', () => {
  assert.match(
    MIGRATION_004,
    /create\s+or\s+replace\s+function\s+public\.submit_community_hack\(/i
  );
  assert.match(
    MIGRATION_004,
    /grant\s+execute\s+on\s+function\s+public\.submit_community_hack\([\s\S]*?\)\s+to\s+anon,\s*authenticated;/i
  );
  assert.match(
    MIGRATION_004,
    /grant\s+execute\s+on\s+function\s+public\.submit_contact_report\([\s\S]*?\)\s+to\s+anon,\s*authenticated;/i
  );
  assert.match(MIGRATION_004, /MAINTENANCE_MODE/i);
  assert.match(MIGRATION_004, /INVALID_PHOTO_PATH/i);
  assert.match(MIGRATION_004, /UNPROMOTED_PENDING_PHOTO/i);

  // Admin-only RPCs must NEVER be granted to anon (checked per SQL statement)
  assert.doesNotMatch(
    MIGRATION_004,
    /grant\s+execute\s+on\s+function\s+public\.(save_recipe_with_ingredients|approve_community_submission|resolve_unique_recipe_slug)[^;]*\banon\b/i
  );
});

test('frontend src/ never references SUPABASE_SERVICE_ROLE_KEY or service_role credentials', () => {
  const srcFiles: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.endsWith('.test.ts')
      ) {
        srcFiles.push(full);
      }
    }
  }
  walk(path.join(ROOT_DIR, 'src'));

  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      content,
      /SUPABASE_SERVICE_ROLE_KEY|VITE_.*SERVICE_ROLE/i,
      `Frontend source file ${file} must never reference service-role credentials`
    );
  }
});

// =============================================================================
// 2. ADMIN-ONLY IMAGE PROMOTION, PRIVACY, ROLLBACK & CLEANUP
// =============================================================================

function createBaseAdapters(
  overrides: Partial<TrustedApprovalServerAdapters> = {}
): {
  adapters: TrustedApprovalServerAdapters;
  calls: string[];
} {
  const calls: string[] = [];
  const adapters: TrustedApprovalServerAdapters = {
    verifyAdminCaller: async () => {
      calls.push('verifyAdminCaller');
      return { ok: true, adminEmail: 'admin@711acks.ph' };
    },
    loadSubmission: async () => {
      calls.push('loadSubmission');
      return {
        id: 'sub-1234',
        status: 'Pending',
        finishedPhotoStoragePath: VALID_PENDING_PATH,
      };
    },
    downloadPendingImage: async () => {
      calls.push('downloadPendingImage');
      return {
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
        mimeType: 'image/jpeg',
      };
    },
    uploadPublishedImage: async (dest) => {
      calls.push(`uploadPublishedImage:${dest}`);
      return {
        publicUrl: `https://project.supabase.co/storage/v1/object/public/published-drinks/${dest}`,
      };
    },
    removePublishedImage: async (dest) => {
      calls.push(`removePublishedImage:${dest}`);
    },
    removePendingImage: async (src) => {
      calls.push(`removePendingImage:${src}`);
    },
    commitApprovalRpc: async (args) => {
      calls.push(`commitApprovalRpc:${args.publishedPhotoUrl}`);
      return {
        recipeId: 'rec-9001',
        slug: args.slug,
        totalPurchaseCost: 29,
      };
    },
    ...overrides,
  };
  return { adapters, calls };
}

test('executeTrustedSubmissionApproval blocks unauthenticated and non-verified-admin callers before touching Storage', async () => {
  const { adapters: unauthAdapters, calls: unauthCalls } = createBaseAdapters({
    verifyAdminCaller: async () => ({
      ok: false,
      status: 401,
      error: 'Unauthorized: Missing bearer authentication token.',
    }),
  });

  const unauthRes = await executeTrustedSubmissionApproval(
    {
      submissionId: 'sub-1234',
      name: 'Midnight Kopiko',
      slug: 'midnight-kopiko',
      category: 'Coffee Mixes',
      photoUrl: VALID_PENDING_PATH,
      ingredients: [SAMPLE_INGREDIENT],
    },
    unauthAdapters
  );

  assert.equal(unauthRes.ok, false);
  assert.equal(unauthRes.status, 401);
  assert.deepEqual(unauthCalls, []);

  const { adapters: forbiddenAdapters, calls: forbiddenCalls } = createBaseAdapters({
    verifyAdminCaller: async () => ({
      ok: false,
      status: 403,
      error: 'Forbidden: Active OTP-verified owner administrator session is required.',
    }),
  });

  const forbiddenRes = await executeTrustedSubmissionApproval(
    {
      submissionId: 'sub-1234',
      name: 'Midnight Kopiko',
      slug: 'midnight-kopiko',
      category: 'Coffee Mixes',
      photoUrl: VALID_PENDING_PATH,
      ingredients: [SAMPLE_INGREDIENT],
    },
    forbiddenAdapters
  );

  assert.equal(forbiddenRes.ok, false);
  assert.equal(forbiddenRes.status, 403);
  assert.deepEqual(forbiddenCalls, []);
});

test('executeTrustedSubmissionApproval promotes private photo to published-drinks, commits RPC, and cleans up pending source', async () => {
  const { adapters, calls } = createBaseAdapters();
  const expectedDest = buildPromotedPublishedDrinkPath('sub-1234', VALID_PENDING_PATH);

  // Destination path must match 003_storage_setup.sql published-drinks regex
  const pubRegexMatch = MIGRATION_003.match(
    /"Published drinks: verified admin insert"[\s\S]*?name\s*~\s*'([^']+)'/i
  );
  assert.ok(pubRegexMatch);
  assert.match(expectedDest, new RegExp(pubRegexMatch[1]));

  const res = await executeTrustedSubmissionApproval(
    {
      submissionId: 'sub-1234',
      name: 'Midnight Kopiko',
      slug: 'midnight-kopiko',
      category: 'Coffee Mixes',
      photoUrl: VALID_PENDING_PATH,
      ingredients: [SAMPLE_INGREDIENT],
    },
    adapters
  );

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.recipeId, 'rec-9001');
    assert.equal(res.data.promotedDestinationPath, expectedDest);
    assert.match(res.data.publishedPhotoUrl, /\/published-drinks\/community\/sub-1234\//);
    assert.equal(res.data.cleanupWarning, null);
  }

  assert.deepEqual(calls, [
    'verifyAdminCaller',
    'loadSubmission',
    'downloadPendingImage',
    `uploadPublishedImage:${expectedDest}`,
    `commitApprovalRpc:https://project.supabase.co/storage/v1/object/public/published-drinks/${expectedDest}`,
    `removePendingImage:${VALID_PENDING_PATH}`,
  ]);
});

test('promotion failure aborts BEFORE committing DB approval so no broken recipe is published', async () => {
  const { adapters, calls } = createBaseAdapters({
    uploadPublishedImage: async () => {
      calls.push('uploadPublishedImage:FAIL');
      throw new Error('Storage upload timeout');
    },
  });

  const res = await executeTrustedSubmissionApproval(
    {
      submissionId: 'sub-1234',
      name: 'Midnight Kopiko',
      slug: 'midnight-kopiko',
      category: 'Coffee Mixes',
      photoUrl: VALID_PENDING_PATH,
      ingredients: [SAMPLE_INGREDIENT],
    },
    adapters
  );

  assert.equal(res.ok, false);
  assert.equal(res.status, 502);
  assert.ok(
    !calls.some((c) => c.startsWith('commitApprovalRpc')),
    'DB approval RPC must never run when image promotion fails'
  );
  assert.ok(
    !calls.some((c) => c.startsWith('removePendingImage')),
    'Original pending image must remain intact for retry when promotion fails'
  );
});

test('DB approval RPC failure rolls back newly uploaded published-drinks object and preserves pending source for retry', async () => {
  const expectedDest = buildPromotedPublishedDrinkPath('sub-1234', VALID_PENDING_PATH);
  const { adapters, calls } = createBaseAdapters({
    commitApprovalRpc: async () => {
      calls.push('commitApprovalRpc:FAIL');
      throw new Error('UNVERIFIED_PRICES: Missing verified price');
    },
  });

  const res = await executeTrustedSubmissionApproval(
    {
      submissionId: 'sub-1234',
      name: 'Midnight Kopiko',
      slug: 'midnight-kopiko',
      category: 'Coffee Mixes',
      photoUrl: VALID_PENDING_PATH,
      ingredients: [SAMPLE_INGREDIENT],
    },
    adapters
  );

  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.ok(
    calls.includes(`removePublishedImage:${expectedDest}`),
    'Newly uploaded published-drinks object must be deleted on DB rollback'
  );
  assert.ok(
    !calls.some((c) => c.startsWith('removePendingImage')),
    'Original pending-submissions file must remain untouched so admin can retry'
  );
});

test('rejected or already-published submissions are blocked (409) and never promote private files', async () => {
  const { adapters, calls } = createBaseAdapters({
    loadSubmission: async () => {
      calls.push('loadSubmission');
      return {
        id: 'sub-rejected',
        status: 'Rejected',
        finishedPhotoStoragePath: VALID_PENDING_PATH,
      };
    },
  });

  const res = await executeTrustedSubmissionApproval(
    {
      submissionId: 'sub-rejected',
      name: 'Rejected Drink',
      slug: 'rejected-drink',
      category: 'Coffee Mixes',
      photoUrl: VALID_PENDING_PATH,
      ingredients: [SAMPLE_INGREDIENT],
    },
    adapters
  );

  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.deepEqual(calls, ['verifyAdminCaller', 'loadSubmission']);
});

test('pending photo privacy guards reject pending-submissions paths and inline data URLs as public recipe photo URLs', () => {
  assert.equal(isApprovedPublishedPhotoUrl(VALID_PENDING_PATH), false);
  assert.equal(
    isApprovedPublishedPhotoUrl(
      'https://project.supabase.co/storage/v1/object/public/pending-submissions/x.jpg'
    ),
    false
  );
  assert.equal(
    isApprovedPublishedPhotoUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='),
    false
  );
  assert.equal(
    isApprovedPublishedPhotoUrl(
      'https://project.supabase.co/storage/v1/object/public/published-drinks/community/sub-1/a.jpg'
    ),
    true
  );
  assert.equal(
    isApprovedPublishedPhotoUrl('/src/assets/images/drink.jpg'),
    true
  );

  // Edge Function must never call getPublicUrl on pending-submissions
  assert.doesNotMatch(
    EDGE_FUNCTION_SRC,
    /from\(\s*PENDING_BUCKET\s*\)\s*\.getPublicUrl/i
  );
  assert.match(EDGE_FUNCTION_SRC, /userClient\.rpc\(\s*'is_verified_admin'\s*\)/);
  assert.match(
    EDGE_FUNCTION_SRC,
    /userClient\.rpc\(\s*'approve_community_submission'/
  );
});

test('invokeApproveCommunitySubmissionEdgeFunction calls Edge Function via supabase.functions.invoke and surfaces errors cleanly', async () => {
  let invokedName = '';
  const okClient = {
    functions: {
      invoke: async (fnName: string) => {
        invokedName = fnName;
        return {
          data: {
            recipeId: 'rec-edge-1',
            slug: 'midnight-kopiko-2',
            totalPurchaseCost: 58,
            publishedPhotoUrl:
              'https://project.supabase.co/storage/v1/object/public/published-drinks/community/sub-1/a.jpg',
            promotedDestinationPath: 'community/sub-1/a.jpg',
            cleanupWarning: null,
          },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;

  const ok = await invokeApproveCommunitySubmissionEdgeFunction(okClient, {
    submissionId: 'sub-1',
    name: 'Midnight Kopiko',
    slug: 'midnight-kopiko',
    category: 'Coffee Mixes',
    photoUrl: VALID_PENDING_PATH,
    ingredients: [SAMPLE_INGREDIENT],
  });

  assert.equal(invokedName, APPROVE_SUBMISSION_EDGE_FUNCTION);
  assert.equal(ok.recipeId, 'rec-edge-1');
  assert.equal(ok.slug, 'midnight-kopiko-2');

  const failingClient = {
    functions: {
      invoke: async () => ({
        data: null,
        error: { message: 'FunctionsFetchError: Edge Function not deployed' },
      }),
    },
  } as unknown as SupabaseClient;

  await assert.rejects(
    () =>
      invokeApproveCommunitySubmissionEdgeFunction(failingClient, {
        submissionId: 'sub-1',
        name: 'Midnight Kopiko',
        slug: 'midnight-kopiko',
        category: 'Coffee Mixes',
        photoUrl: VALID_PENDING_PATH,
        ingredients: [SAMPLE_INGREDIENT],
      }),
    /Edge Function not deployed/i
  );
});

// =============================================================================
// 3. DETERMINISTIC RECIPE SLUG COLLISION HANDLING
// =============================================================================

test('resolveUniqueRecipeSlug allocates deterministic sequential suffixes (-2, -3) on duplicate recipe names', () => {
  const existing: Pick<DrinkRecipe, 'id' | 'slug' | 'status' | 'publishedAt'>[] = [
    {
      id: 'rec-1',
      slug: 'kopiko-caramel-macchiato',
      status: 'Published',
      publishedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'rec-2',
      slug: 'kopiko-caramel-macchiato-2',
      status: 'Draft',
      publishedAt: null,
    },
  ];

  const created = resolveUniqueRecipeSlug('Kopiko Caramel Macchiato', existing);
  assert.equal(created.success, true);
  assert.equal(created.slug, 'kopiko-caramel-macchiato-3');

  // Fresh unique name keeps base slug without suffix
  const unique = resolveUniqueRecipeSlug('Matcha Chuckie Float', existing);
  assert.equal(unique.success, true);
  assert.equal(unique.slug, 'matcha-chuckie-float');
});

test('resolveUniqueRecipeSlug preserves existing Published URLs when editing and blocks colliding draft slugs', () => {
  const existing: Pick<DrinkRecipe, 'id' | 'slug' | 'status' | 'publishedAt'>[] = [
    {
      id: 'rec-pub',
      slug: 'original-published-url',
      status: 'Published',
      publishedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'rec-draft',
      slug: 'draft-recipe-slug',
      status: 'Draft',
      publishedAt: null,
    },
  ];

  // Editing Published recipe with a new title MUST preserve its existing published URL
  const editPublished = resolveUniqueRecipeSlug('Completely Renamed Drink', existing, {
    editingRecipeId: 'rec-pub',
  });
  assert.equal(editPublished.success, true);
  assert.equal(editPublished.slug, 'original-published-url');

  // Editing Draft recipe without explicit slug keeps its own slug
  const editDraftKeep = resolveUniqueRecipeSlug('Renamed Draft', existing, {
    editingRecipeId: 'rec-draft',
  });
  assert.equal(editDraftKeep.success, true);
  assert.equal(editDraftKeep.slug, 'draft-recipe-slug');

  // Editing Draft recipe with explicit slug already owned by another recipe MUST fail (never overwrite)
  const editDraftCollision = resolveUniqueRecipeSlug('Renamed Draft', existing, {
    editingRecipeId: 'rec-draft',
    explicitSlug: 'original-published-url',
  });
  assert.equal(editDraftCollision.success, false);
  assert.match(editDraftCollision.error || '', /already assigned/i);
});

test('004_phase2d_security_hardening.sql enforces advisory-locked deterministic slug resolution and preserves recipes.slug UNIQUE guard', () => {
  assert.match(MIGRATION_001, /slug\s+text\s+unique\s+not\s+null/i);
  assert.match(MIGRATION_004, /pg_advisory_xact_lock\(/i);
  assert.match(MIGRATION_004, /public\.resolve_unique_recipe_slug\(/i);
  assert.match(MIGRATION_004, /SLUG_COLLISION/i);
});
