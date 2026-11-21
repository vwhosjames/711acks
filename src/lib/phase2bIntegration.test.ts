import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EMPTY_LIVE_SETTINGS,
  createInFlightGuard,
  executeSubmitCommunityHackByMode,
  executeSubmitContactReportByMode,
  executeToggleLikeByMode,
  loadPublicDataByMode,
} from './appDataController';
import {
  STORAGE_BUCKETS,
  UploadProgressPhase,
  buildPendingSubmissionStoragePath,
  createPendingSubmissionSignedUrl,
  isInlineDataUrl,
  isRelativeStoragePath,
  uploadPendingSubmissionImage,
  validateImageFileMetadata,
} from './supabaseStorage';
import type { PublicBootstrapData } from './supabaseRepository';

const LOCAL_PREVIEW_FIXTURE: PublicBootstrapData = {
  products: [
    {
      id: 'local-prod-1',
      name: 'Preview Product',
      photoUrl: '/preview.jpg',
      purchasePrice: 29,
      isArchived: false,
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  recipes: [],
  websiteSettings: {
    ...EMPTY_LIVE_SETTINGS,
    maintenanceTitle: 'Local Preview Settings',
  },
  likedRecipeIds: [],
};

// =============================================================================
// 1. LIVE SUPABASE VS. LOCAL PREVIEW MODE (NO SILENT FALLBACK ON LIVE ERROR)
// =============================================================================

test('loadPublicDataByMode uses Local Preview data only when Supabase is not configured', async () => {
  let localCalled = false;
  const result = await loadPublicDataByMode({
    isLiveSupabase: false,
    client: null,
    anonymousBrowserId: 'anon-browser-test-1234',
    getLocalPreviewData: () => {
      localCalled = true;
      return LOCAL_PREVIEW_FIXTURE;
    },
  });

  assert.equal(localCalled, true);
  assert.equal(result.success, true);
  assert.equal(result.mode, 'local-preview');
  if (result.success) {
    assert.equal(result.data.products[0].id, 'local-prod-1');
  }
});

test('loadPublicDataByMode returns explicit error and NEVER falls back to Local Preview when live Supabase fails', async () => {
  let localCalled = false;

  const failingClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: null,
              error: { message: 'connection refused', code: '08006' },
            }),
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: 'connection refused', code: '08006' },
            }),
          maybeSingle: () =>
            Promise.resolve({
              data: null,
              error: { message: 'connection refused', code: '08006' },
            }),
        }),
        in: () => ({
          order: () =>
            Promise.resolve({
              data: null,
              error: { message: 'connection refused', code: '08006' },
            }),
        }),
        maybeSingle: () =>
          Promise.resolve({
            data: null,
            error: { message: 'connection refused', code: '08006' },
          }),
      }),
    }),
    rpc: () =>
      Promise.resolve({
        data: null,
        error: { message: 'connection refused', code: '08006' },
      }),
  } as unknown as SupabaseClient;

  const result = await loadPublicDataByMode({
    isLiveSupabase: true,
    client: failingClient,
    anonymousBrowserId: 'anon-browser-test-1234',
    getLocalPreviewData: () => {
      localCalled = true;
      return LOCAL_PREVIEW_FIXTURE;
    },
  });

  assert.equal(localCalled, false);
  assert.equal(result.success, false);
  assert.equal(result.mode, 'supabase');
  if (!result.success) {
    assert.match(result.error, /connection refused/i);
  }
});

// =============================================================================
// 2. COMMUNITY SUBMISSION RPC & INLINE BASE64 REJECTION IN LIVE MODE
// =============================================================================

test('executeSubmitCommunityHackByMode calls submit_community_hack RPC with private storage path', async () => {
  const capturedCalls: { fn: string; args: Record<string, unknown> }[] = [];

  const mockClient = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      capturedCalls.push({ fn, args });
      return { data: 'sub-uuid-9001', error: null };
    },
  } as unknown as SupabaseClient;

  const res = await executeSubmitCommunityHackByMode({
    isLiveSupabase: true,
    client: mockClient,
    guard: createInFlightGuard(),
    input: {
      drinkName: 'Kopiko Chuckie Midnight',
      category: 'Coffee Mixes',
      submitterName: 'Test Creator',
      finishedPhotoStoragePath: 'finished-drink/2026-11-20/abcdef123456.jpg',
      ingredients: [
        {
          productId: 'prod-1',
          quantityUsed: '1 bottle',
          unitsToPurchase: 1,
        },
      ],
    },
    localSubmit: () => {
      throw new Error('localSubmit must not run in live mode');
    },
  });

  assert.equal(res.success, true);
  assert.equal(res.submissionId, 'sub-uuid-9001');
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].fn, 'submit_community_hack');
  assert.equal(
    capturedCalls[0].args.p_finished_photo_storage_path,
    'finished-drink/2026-11-20/abcdef123456.jpg'
  );
});

test('executeSubmitCommunityHackByMode rejects inline base64 data URLs in live mode', async () => {
  let rpcCalled = false;
  const mockClient = {
    rpc: async () => {
      rpcCalled = true;
      return { data: 'should-not-run', error: null };
    },
  } as unknown as SupabaseClient;

  const finishedRes = await executeSubmitCommunityHackByMode({
    isLiveSupabase: true,
    client: mockClient,
    guard: createInFlightGuard(),
    input: {
      drinkName: 'Inline Photo Reject Test',
      category: 'Coffee Mixes',
      finishedPhotoStoragePath: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      ingredients: [
        { productId: 'prod-1', quantityUsed: '1 bottle', unitsToPurchase: 1 },
      ],
    },
    localSubmit: () => ({ success: true, submissionId: 'local' }),
  });

  assert.equal(finishedRes.success, false);
  assert.equal(rpcCalled, false);
  assert.match(finishedRes.error || '', /pending-submissions/i);

  const suggestedRes = await executeSubmitCommunityHackByMode({
    isLiveSupabase: true,
    client: mockClient,
    guard: createInFlightGuard(),
    input: {
      drinkName: 'Inline Suggested Reject Test',
      category: 'Fruity & Soda',
      ingredients: [
        {
          productId: null,
          suggestedProductName: 'New Soda',
          suggestedProductPhotoPath: 'data:image/png;base64,iVBORw0KGgo=',
          quantityUsed: '1 can',
          unitsToPurchase: 1,
        },
      ],
    },
    localSubmit: () => ({ success: true, submissionId: 'local' }),
  });

  assert.equal(suggestedRes.success, false);
  assert.equal(rpcCalled, false);
  assert.match(suggestedRes.error || '', /pending-submissions/i);
});

test('executeSubmitCommunityHackByMode surfaces live RPC errors without falling back to LocalStorage', async () => {
  let localCalled = false;
  const mockClient = {
    rpc: async () => ({
      data: null,
      error: { message: 'Category must be one of the 3 approved categories', code: '22023' },
    }),
  } as unknown as SupabaseClient;

  const res = await executeSubmitCommunityHackByMode({
    isLiveSupabase: true,
    client: mockClient,
    guard: createInFlightGuard(),
    input: {
      drinkName: 'Error Propagation Test',
      category: 'Coffee Mixes',
      ingredients: [
        { productId: 'prod-1', quantityUsed: '1 bottle', unitsToPurchase: 1 },
      ],
    },
    localSubmit: () => {
      localCalled = true;
      return { success: true, submissionId: 'local-fallback' };
    },
  });

  assert.equal(localCalled, false);
  assert.equal(res.success, false);
  assert.match(res.error || '', /3 approved categories/i);
});

// =============================================================================
// 3. CONTACT REPORT RPC VALIDATION & ERROR HANDLING
// =============================================================================

test('executeSubmitContactReportByMode validates message and email before hitting RPC', async () => {
  let rpcCalled = false;
  const mockClient = {
    rpc: async () => {
      rpcCalled = true;
      return { data: 'rep-1', error: null };
    },
  } as unknown as SupabaseClient;

  const shortMsg = await executeSubmitContactReportByMode({
    isLiveSupabase: true,
    client: mockClient,
    guard: createInFlightGuard(),
    input: {
      category: 'Incorrect or Outdated Product Price',
      message: 'Too short',
    },
    localSubmit: () => ({ success: true, reportId: 'local' }),
  });
  assert.equal(shortMsg.success, false);
  assert.equal(rpcCalled, false);

  const badEmail = await executeSubmitContactReportByMode({
    isLiveSupabase: true,
    client: mockClient,
    guard: createInFlightGuard(),
    input: {
      reporterEmail: 'not-an-email',
      category: 'General Feedback',
      message: 'This message is definitely longer than ten characters.',
    },
    localSubmit: () => ({ success: true, reportId: 'local' }),
  });
  assert.equal(badEmail.success, false);
  assert.equal(rpcCalled, false);
});

test('executeSubmitContactReportByMode succeeds via submit_contact_report RPC and surfaces failures', async () => {
  const okClient = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      assert.equal(fn, 'submit_contact_report');
      assert.equal(args.p_category, 'Incorrect or Outdated Product Price');
      return { data: 'rep-uuid-77', error: null };
    },
  } as unknown as SupabaseClient;

  const ok = await executeSubmitContactReportByMode({
    isLiveSupabase: true,
    client: okClient,
    guard: createInFlightGuard(),
    input: {
      reporterName: 'Alex',
      reporterEmail: 'alex@example.com',
      category: 'Incorrect or Outdated Product Price',
      message: 'Kopiko Lucky Day is now PHP 32.00 in Makati branch.',
    },
    localSubmit: () => {
      throw new Error('should not run in live mode');
    },
  });

  assert.equal(ok.success, true);
  assert.equal(ok.reportId, 'rep-uuid-77');

  const failClient = {
    rpc: async () => ({
      data: null,
      error: { message: 'Database unavailable', code: '53300' },
    }),
  } as unknown as SupabaseClient;

  const fail = await executeSubmitContactReportByMode({
    isLiveSupabase: true,
    client: failClient,
    guard: createInFlightGuard(),
    input: {
      category: 'General Feedback',
      message: 'Detailed bug report message exceeding ten characters.',
    },
    localSubmit: () => ({ success: true, reportId: 'should-not-fallback' }),
  });

  assert.equal(fail.success, false);
  assert.match(fail.error || '', /Database unavailable/i);
});

// =============================================================================
// 4. ANONYMOUS LIKE RPC SUCCESS & RATE-LIMIT FAILURE
// =============================================================================

test('executeToggleLikeByMode invokes toggle_recipe_like RPC and surfaces rate-limit errors', async () => {
  const okClient = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      assert.equal(fn, 'toggle_recipe_like');
      assert.equal(args.p_recipe_id, 'recipe-1');
      assert.equal(args.p_anonymous_browser_id, 'browser-id-12345678');
      return { data: [{ liked: true, likes_count: 42 }], error: null };
    },
  } as unknown as SupabaseClient;

  const ok = await executeToggleLikeByMode({
    isLiveSupabase: true,
    client: okClient,
    guard: createInFlightGuard(),
    recipeId: 'recipe-1',
    anonymousBrowserId: 'browser-id-12345678',
    localToggle: () => {
      throw new Error('should not call localToggle in live mode');
    },
  });

  assert.equal(ok.success, true);
  assert.equal(ok.liked, true);
  assert.equal(ok.likesCount, 42);

  const rateLimitedClient = {
    rpc: async () => ({
      data: null,
      error: { message: 'Rate limit exceeded. Please wait before liking again.', code: 'P0001' },
    }),
  } as unknown as SupabaseClient;

  const limited = await executeToggleLikeByMode({
    isLiveSupabase: true,
    client: rateLimitedClient,
    guard: createInFlightGuard(),
    recipeId: 'recipe-1',
    anonymousBrowserId: 'browser-id-12345678',
    localToggle: () => ({ success: true, liked: true, likesCount: 99 }),
  });

  assert.equal(limited.success, false);
  assert.match(limited.message || '', /Rate limit exceeded/i);
});

// =============================================================================
// 5. SUPABASE STORAGE VALIDATION, PRIVATE UPLOAD & SIGNED URLS
// =============================================================================

test('validateImageFileMetadata enforces MIME type, 5MB cap, and 120px-6000px bounds', () => {
  assert.equal(
    validateImageFileMetadata({
      mimeType: 'image/jpeg',
      sizeBytes: 512_000,
      width: 1200,
      height: 900,
    }).valid,
    true
  );

  assert.equal(
    validateImageFileMetadata({
      mimeType: 'image/gif',
      sizeBytes: 100_000,
      width: 500,
      height: 500,
    }).valid,
    false
  );

  assert.equal(
    validateImageFileMetadata({
      mimeType: 'image/png',
      sizeBytes: 6 * 1024 * 1024,
      width: 800,
      height: 600,
    }).valid,
    false
  );

  assert.equal(
    validateImageFileMetadata({
      mimeType: 'image/webp',
      sizeBytes: 10_000,
      width: 64,
      height: 64,
    }).valid,
    false
  );

  assert.equal(
    validateImageFileMetadata({
      mimeType: 'image/jpeg',
      sizeBytes: 1_000_000,
      width: 6500,
      height: 4000,
    }).valid,
    false
  );
});

test('buildPendingSubmissionStoragePath generates safe non-guessable relative paths', () => {
  const fixedDate = new Date('2026-11-20T12:00:00.000Z');
  const p1 = buildPendingSubmissionStoragePath('finished-drink', 'image/jpeg', fixedDate);
  const p2 = buildPendingSubmissionStoragePath('finished-drink', 'image/jpeg', fixedDate);

  assert.match(p1, /^finished-drink\/2026-11-20\/[0-9a-f]{32}\.jpg$/);
  assert.notEqual(p1, p2);
  assert.equal(isRelativeStoragePath(p1), true);
  assert.equal(isInlineDataUrl(p1), false);
});

test('uploadPendingSubmissionImage uploads privately to pending-submissions with progress phases and never calls getPublicUrl', async () => {
  const phases: UploadProgressPhase[] = [];
  let usedBucket = '';
  let usedUpsert: boolean | undefined;
  let publicUrlCalled = false;

  const mockClient = {
    storage: {
      from: (bucket: string) => {
        usedBucket = bucket;
        return {
          upload: async (
            path: string,
            _body: Blob,
            opts: { upsert?: boolean; contentType?: string }
          ) => {
            usedUpsert = opts.upsert;
            return { data: { path }, error: null };
          },
          getPublicUrl: () => {
            publicUrlCalled = true;
            return { data: { publicUrl: 'https://should-never-be-called' } };
          },
        };
      },
    },
  } as unknown as SupabaseClient;

  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
  const result = await uploadPendingSubmissionImage(mockClient, {
    blob,
    mimeType: 'image/jpeg',
    sizeBytes: 4096,
    width: 1000,
    height: 750,
    kind: 'finished-drink',
    onProgress: (p) => phases.push(p),
  });

  assert.equal(usedBucket, STORAGE_BUCKETS.PENDING_SUBMISSIONS);
  assert.equal(usedUpsert, false);
  assert.equal(publicUrlCalled, false);
  assert.deepEqual(phases, ['validating', 'uploading', 'uploaded']);
  assert.equal(isRelativeStoragePath(result.storagePath), true);
});

test('uploadPendingSubmissionImage reports error phase on Storage failure', async () => {
  const phases: UploadProgressPhase[] = [];
  const failingStorageClient = {
    storage: {
      from: () => ({
        upload: async () => ({
          data: null,
          error: { message: 'new row violates row-level security policy' },
        }),
      }),
    },
  } as unknown as SupabaseClient;

  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  await assert.rejects(
    () =>
      uploadPendingSubmissionImage(failingStorageClient, {
        blob,
        mimeType: 'image/png',
        sizeBytes: 2048,
        width: 500,
        height: 500,
        kind: 'suggested-product',
        onProgress: (p) => phases.push(p),
      }),
    /row-level security/i
  );

  assert.deepEqual(phases, ['validating', 'uploading', 'error']);
});

test('createPendingSubmissionSignedUrl clamps expiry and rejects unsafe paths', async () => {
  let receivedExpiry = 0;
  const mockClient = {
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, STORAGE_BUCKETS.PENDING_SUBMISSIONS);
        return {
          createSignedUrl: async (path: string, expiresIn: number) => {
            receivedExpiry = expiresIn;
            return {
              data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/${path}?token=abc` },
              error: null,
            };
          },
        };
      },
    },
  } as unknown as SupabaseClient;

  const signed = await createPendingSubmissionSignedUrl(
    mockClient,
    'finished-drink/2026-11-20/abcdef1234567890abcdef1234567890.jpg',
    99999
  );
  assert.equal(receivedExpiry, 900);
  assert.match(signed, /object\/sign/);

  await assert.rejects(
    () => createPendingSubmissionSignedUrl(mockClient, '../etc/passwd'),
    /Invalid private storage path/i
  );
  await assert.rejects(
    () =>
      createPendingSubmissionSignedUrl(
        mockClient,
        'data:image/jpeg;base64,/9j/4AAQ=='
      ),
    /Invalid private storage path/i
  );
});

// =============================================================================
// 6. DUPLICATE SUBMISSION / CONCURRENT REQUEST PROTECTION
// =============================================================================

test('createInFlightGuard blocks overlapping duplicate requests and unlocks after completion or error', async () => {
  const guard = createInFlightGuard();
  let releaseFirst!: () => void;
  const firstPending = new Promise<string>((resolve) => {
    releaseFirst = () => resolve('ok');
  });

  const p1 = guard.runExclusive('submit-community-hack', () => firstPending);
  assert.equal(guard.isLocked('submit-community-hack'), true);

  // Concurrent duplicate submission attempt must be rejected immediately
  const p2 = await guard.runExclusive(
    'submit-community-hack',
    async () => 'duplicate',
    'Duplicate blocked'
  );
  assert.equal(p2.executed, false);
  if (!p2.executed) {
    assert.equal(p2.error, 'Duplicate blocked');
  }

  releaseFirst();
  const r1 = await p1;
  assert.equal(r1.executed, true);
  assert.equal(guard.isLocked('submit-community-hack'), false);

  // Also releases lock when task rejects
  await assert.rejects(() =>
    guard.runExclusive('like:rec-1', async () => {
      throw new Error('network error');
    })
  );
  assert.equal(guard.isLocked('like:rec-1'), false);
});
