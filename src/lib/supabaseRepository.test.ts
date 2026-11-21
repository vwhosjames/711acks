import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseRepositoryError,
  assertNoSupabaseError,
  fetchPublishedRecipes,
  fetchWebsiteSettings,
  mapBackupRecordRowToDomain,
  mapCommunitySubmissionRowToDomain,
  mapContactReportRowToDomain,
  mapProductPriceHistoryRowToDomain,
  mapProductRowToDomain,
  mapProductSuggestionRowToDomain,
  mapRecipePriceSnapshotRowToDomain,
  mapRecipeRevisionRowToDomain,
  mapRecipeRowToDomain,
  mapSecurityEventRowToDomain,
  mapWebsiteSettingsRowToDomain,
  requireSupabaseClient,
  submitCommunityHackInDb,
  toggleRecipeLikeInDb,
} from './supabaseRepository';

test('requireSupabaseClient throws explicit SupabaseRepositoryError when client is null', () => {
  assert.throws(
    () => requireSupabaseClient(null, 'testOp'),
    (err: unknown) => {
      assert.ok(err instanceof SupabaseRepositoryError);
      assert.equal(err.operation, 'testOp');
      assert.equal(err.code, 'SUPABASE_NOT_CONFIGURED');
      return true;
    }
  );
});

test('assertNoSupabaseError throws SupabaseRepositoryError with PostgREST metadata', () => {
  assert.throws(
    () =>
      assertNoSupabaseError(
        {
          message: 'new row violates row-level security policy',
          code: '42501',
          details: 'Policy failed for table recipes',
          hint: 'Verify admin OTP session',
        },
        'saveRecipe'
      ),
    (err: unknown) => {
      assert.ok(err instanceof SupabaseRepositoryError);
      assert.equal(err.operation, 'saveRecipe');
      assert.equal(err.code, '42501');
      assert.equal(err.details, 'Policy failed for table recipes');
      assert.equal(err.hint, 'Verify admin OTP session');
      return true;
    }
  );
});

test('mapProductRowToDomain parses PostgreSQL numeric strings accurately', () => {
  const mapped = mapProductRowToDomain({
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Kopiko Lucky Day Iced Coffee 180ml',
    photo_url: 'https://example.supabase.co/storage/v1/object/public/verified-products/kopiko.jpg',
    purchase_price: '29.50',
    barcode: '4800361390804',
    is_archived: false,
    last_updated_at: '2026-11-20T00:00:00Z',
  });

  assert.equal(mapped.purchasePrice, 29.5);
  assert.equal(mapped.barcode, '4800361390804');
  assert.equal(mapped.isArchived, false);
  assert.equal(mapped.isDemoRecord, false);
});

test('mapRecipeRowToDomain sorts ingredients by sort_order and preserves nullable totals', () => {
  const mapped = mapRecipeRowToDomain({
    id: '22222222-2222-2222-2222-222222222222',
    slug: 'kopiko-chuckie-dirty-mocha',
    name: 'Kopiko Chuckie Dirty Mocha',
    category: 'Coffee Mixes',
    status: 'Published',
    photo_url: 'https://example.supabase.co/storage/v1/object/public/published-drinks/dirty-mocha.jpg',
    submitter_name: 'Marco P.',
    taste_notes: 'Bold coffee balanced with creamy chocolate',
    total_purchase_cost: '80.00',
    price_verified: true,
    needs_price_review: false,
    last_price_verified_at: '2026-11-18T10:00:00Z',
    is_editors_pick: true,
    is_trending: true,
    likes_count: 14,
    pending_draft_json: null,
    published_at: '2026-11-18T10:00:00Z',
    created_at: '2026-11-17T10:00:00Z',
    updated_at: '2026-11-18T10:00:00Z',
    recipe_ingredients: [
      {
        id: 'ing-b',
        recipe_id: '22222222-2222-2222-2222-222222222222',
        product_id: 'prod-2',
        product_name_snapshot: 'Nestle Chuckie 250ml',
        product_photo_snapshot: '/chuckie.jpg',
        quantity_used: 'Half pack (125ml)',
        units_to_purchase: 1,
        price_snapshot: '36.00',
        price_verified: true,
        sort_order: 2,
      },
      {
        id: 'ing-a',
        recipe_id: '22222222-2222-2222-2222-222222222222',
        product_id: 'prod-1',
        product_name_snapshot: 'Kopiko Lucky Day 180ml',
        product_photo_snapshot: '/kopiko.jpg',
        quantity_used: '1 bottle (180ml)',
        units_to_purchase: 1,
        price_snapshot: '29.00',
        price_verified: true,
        sort_order: 1,
      },
    ],
  });

  assert.equal(mapped.totalPurchaseCost, 80);
  assert.equal(mapped.ingredients.length, 2);
  assert.equal(mapped.ingredients[0].id, 'ing-a');
  assert.equal(mapped.ingredients[1].id, 'ing-b');
  assert.equal(mapped.ingredients[0].priceSnapshot, 29);
  assert.equal(mapped.isDemoRecord, false);
});

test('mapRecipePriceSnapshotRowToDomain and mapBackupRecordRowToDomain map Phase 2A types cleanly', () => {
  const snapshot = mapRecipePriceSnapshotRowToDomain({
    id: 'snap-1',
    recipe_id: 'rec-1',
    total_purchase_cost: '80.00',
    ingredient_breakdown: [
      {
        productId: 'prod-1',
        productNameSnapshot: 'Kopiko Lucky Day 180ml',
        quantityUsed: '1 bottle',
        unitsToPurchase: 1,
        priceSnapshot: 29,
        lineTotal: 29,
      },
    ],
    verified_by: 'admin-uuid',
    verified_at: '2026-11-20T05:00:00Z',
  });

  assert.equal(snapshot.totalPurchaseCost, 80);
  assert.equal(snapshot.ingredientBreakdown.length, 1);
  assert.equal(snapshot.ingredientBreakdown[0].lineTotal, 29);

  const backup = mapBackupRecordRowToDomain({
    id: 'bak-1',
    backup_filename: '711acks-full-backup-2026-11-20.json',
    record_counts: { recipes: 6, products: 12 },
    includes_storage_manifest: true,
    checksum: 'chk_abc123',
    created_by: 'admin-uuid',
    created_at: '2026-11-20T06:00:00Z',
  });

  assert.equal(backup.backupFilename, '711acks-full-backup-2026-11-20.json');
  assert.deepEqual(backup.recordCounts, { recipes: 6, products: 12 });
  assert.equal(backup.includesStorageManifest, true);
});

test('remaining entity mappers map relational joins and defaults cleanly', () => {
  const history = mapProductPriceHistoryRowToDomain({
    id: 'pph-1',
    product_id: 'prod-1',
    previous_price: '29.00',
    new_price: '32.00',
    changed_by: 'admin-1',
    changed_at: '2026-11-20T01:00:00Z',
    products: { name: 'Kopiko Lucky Day 180ml' },
  });
  assert.equal(history.productName, 'Kopiko Lucky Day 180ml');
  assert.equal(history.previousPrice, 29);
  assert.equal(history.newPrice, 32);

  const submission = mapCommunitySubmissionRowToDomain({
    id: 'sub-1',
    drink_name: 'Yakult Lychee Sparkler',
    category: 'Fruity & Soda',
    submitter_name: '',
    taste_notes: null,
    finished_photo_storage_path: 'pending-submissions/sub-1.jpg',
    status: 'Pending',
    duplicate_warning_notes: null,
    admin_review_notes: null,
    approved_recipe_id: null,
    submitted_at: '2026-11-20T02:00:00Z',
    reviewed_at: null,
    submission_ingredients: [
      {
        id: 'si-1',
        submission_id: 'sub-1',
        product_id: null,
        suggested_product_name: 'New Citrus Soda',
        suggested_product_price: '35.00',
        suggested_product_photo_path: 'pending-submissions/ing-1.jpg',
        quantity_used: '1 can',
        units_to_purchase: 1,
      },
    ],
  });
  assert.equal(submission.submitterName, 'Anonymous Creator');
  assert.equal(submission.ingredients[0].suggestedProductPrice, 35);

  const suggestion = mapProductSuggestionRowToDomain({
    id: 'ps-1',
    submission_id: 'sub-1',
    suggested_name: 'New Citrus Soda',
    suggested_price: '35.00',
    photo_storage_path: 'pending-submissions/ing-1.jpg',
    status: 'Pending',
    approved_product_id: null,
    created_at: '2026-11-20T02:00:00Z',
  });
  assert.equal(suggestion.suggestedPrice, 35);

  const revision = mapRecipeRevisionRowToDomain({
    id: 'rev-1',
    recipe_id: 'rec-1',
    version_number: 2,
    changed_fields: ['totalPurchaseCost'],
    previous_values: { totalPurchaseCost: 65 },
    new_values: { totalPurchaseCost: 70 },
    change_summary: 'Verified updated price snapshot',
    restored_from_revision_id: null,
    created_by: 'admin@711acks.ph',
    created_at: '2026-11-20T03:00:00Z',
    recipes: { name: 'Kopiko Chuckie Dirty Mocha' },
  });
  assert.equal(revision.recipeName, 'Kopiko Chuckie Dirty Mocha');

  const report = mapContactReportRowToDomain({
    id: 'rep-1',
    reporter_name: null,
    reporter_email: null,
    category: 'Incorrect or Outdated Product Price',
    message: 'Kopiko is now 32 pesos in Makati branch.',
    related_recipe_slug: 'kopiko-chuckie-dirty-mocha',
    status: 'Open',
    admin_notes: null,
    created_at: '2026-11-20T04:00:00Z',
    resolved_at: null,
  });
  assert.equal(report.status, 'Open');

  const settings = mapWebsiteSettingsRowToDomain({
    id: 1,
    maintenance_mode: false,
    maintenance_title: 'Scheduled Inventory & Price Verification',
    maintenance_message: 'Updating verified prices.',
    session_timeout_minutes: 30,
    require_admin_otp: true,
    updated_at: '2026-11-20T04:00:00Z',
  });
  assert.equal(settings.sessionTimeoutMinutes, 30);

  const secEvent = mapSecurityEventRowToDomain({
    id: 'sec-1',
    event_type: 'ADMIN_OTP_VERIFIED',
    actor: 'admin@711acks.ph',
    details: 'OTP verified.',
    ip_hash: null,
    created_at: '2026-11-20T04:00:00Z',
  });
  assert.equal(secEvent.eventType, 'ADMIN_OTP_VERIFIED');
});

test('repository queries and RPCs propagate database errors explicitly instead of swallowing them', async () => {
  const failingClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: null,
            error: { message: 'permission denied for table recipes', code: '42501' },
          }),
          single: async () => ({
            data: null,
            error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
          }),
        }),
      }),
    }),
    rpc: async (fnName: string) => {
      if (fnName === 'toggle_recipe_like') {
        return {
          data: null,
          error: {
            message: 'RATE_LIMIT_EXCEEDED: Please wait a moment before toggling likes again.',
            code: 'P0001',
          },
        };
      }
      return {
        data: null,
        error: { message: 'MAINTENANCE_MODE: Community submissions are temporarily paused.', code: 'P0001' },
      };
    },
  } as unknown as SupabaseClient;

  await assert.rejects(
    () => fetchPublishedRecipes(failingClient),
    (err: unknown) => err instanceof SupabaseRepositoryError && err.code === '42501'
  );

  await assert.rejects(
    () => fetchWebsiteSettings(failingClient),
    (err: unknown) => err instanceof SupabaseRepositoryError && err.code === 'PGRST116'
  );

  await assert.rejects(
    () => toggleRecipeLikeInDb(failingClient, 'rec-1', 'anon_1234567890abcdef'),
    (err: unknown) =>
      err instanceof SupabaseRepositoryError && err.message.includes('RATE_LIMIT_EXCEEDED')
  );

  await assert.rejects(
    () =>
      submitCommunityHackInDb(failingClient, {
        drinkName: 'Test Drink Hack',
        category: 'Coffee Mixes',
        ingredients: [
          {
            productId: null,
            suggestedProductName: 'Test Coffee',
            quantityUsed: '1 bottle',
            unitsToPurchase: 1,
          },
        ],
      }),
    (err: unknown) =>
      err instanceof SupabaseRepositoryError && err.message.includes('MAINTENANCE_MODE')
  );
});

test('toggleRecipeLikeInDb returns parsed boolean and updated count on success', async () => {
  const okClient = {
    rpc: async () => ({
      data: [{ liked: true, likes_count: 43 }],
      error: null,
    }),
  } as unknown as SupabaseClient;

  const res = await toggleRecipeLikeInDb(okClient, 'rec-1', 'anon_1234567890abcdef');
  assert.deepEqual(res, { liked: true, likesCount: 43 });
});
