// =============================================================================
// 711ACKS — SUPABASE EDGE FUNCTION: approve-community-submission
// =============================================================================
// Trusted server-side workflow for approving a pending community submission and
// promoting its private `pending-submissions` image to `published-drinks`.
//
// REQUIRED SERVER-SIDE SECRETS (Supabase Edge Function environment only — NEVER
// exposed in frontend bundles or VITE_* variables):
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
//
// SECURITY & TRANSACTIONAL GUARANTEES:
//   1. Authenticates caller JWT via `userClient.auth.getUser()` (401 on failure).
//   2. Verifies OTP-verified admin status via `userClient.rpc('is_verified_admin')`
//      against PostgreSQL (403 on failure — never trusts client role flags).
//   3. Loads the submission record and ensures status === 'Pending' (404/409).
//   4. If the submission includes a private `pending-submissions` photo:
//      - Downloads bytes server-side from `pending-submissions` (never generates
//        a public URL for `pending-submissions`).
//      - Validates MIME type (JPEG/PNG/WebP) and size (<= 5 MB).
//      - Uploads to deterministic path `community/<submissionId>/<filename>` in
//        `published-drinks` (`upsert: true` for idempotent retries).
//      - Aborts BEFORE publishing if promotion fails (no broken public recipe).
//   5. Executes transactional `approve_community_submission` RPC using the
//      caller's user JWT so PostgreSQL re-verifies `is_verified_admin()`, records
//      `auth.uid()`, allocates a deterministic unique slug, and commits atomically.
//   6. Compensating rollback: if the DB RPC fails after promoting the image,
//      deletes the newly uploaded `published-drinks` object while keeping the
//      original `pending-submissions` file intact for retry.
//   7. Best-effort cleanup: after DB commit succeeds, deletes the original private
//      object from `pending-submissions` and reports any cleanup warning without
//      failing the already-committed approval.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  handleAdminPreflight,
  jsonAdminResponse,
  rejectIfDisallowedOrigin,
} from '../_shared/adminAuthShared.ts';

const PENDING_BUCKET = 'pending-submissions';
const PUBLISHED_BUCKET = 'published-drinks';
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PENDING_PHOTO_REGEX =
  /^finished-drink\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f]{32}\.(jpg|png|webp)$/;

function isApprovedPublicPhotoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase().startsWith('data:')) return false;
  if (trimmed.includes('..')) return false;
  if (trimmed.toLowerCase().includes(PENDING_BUCKET)) return false;
  if (/^(finished-drink|suggested-product)\//.test(trimmed)) return false;
  return trimmed.startsWith('https://') || trimmed.startsWith('/');
}

function buildPromotedDestinationPath(
  submissionId: string,
  sourcePath: string
): string {
  const safeId = submissionId.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const filename = sourcePath.split('/').pop() || '';
  return `community/${safeId}/${filename}`;
}

function inferMimeFromPath(path: string, blobType?: string): string {
  if (blobType && ALLOWED_IMAGE_MIME_TYPES.has(blobType)) {
    return blobType;
  }
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleAdminPreflight(req);
  }

  const originRejection = rejectIfDisallowedOrigin(req);
  if (originRejection) {
    return originRejection;
  }

  if (req.method !== 'POST') {
    return jsonAdminResponse(req, { error: 'Method not allowed. Use POST.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonAdminResponse(
      req,
      { error: 'Server environment is missing required Supabase credentials.' },
      500
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonAdminResponse(
      req,
      { error: 'Unauthorized: Missing bearer authentication token.' },
      401
    );
  }

  // 1. Verify caller identity & OTP-verified admin status with user-scoped client
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
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
      { error: 'Unauthorized: Invalid or expired authentication session.' },
      401
    );
  }

  const { data: isAdmin, error: adminCheckError } = await userClient.rpc(
    'is_verified_admin'
  );

  if (adminCheckError || isAdmin !== true) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Forbidden: Active OTP-verified owner administrator session is required.',
      },
      403
    );
  }

  // 2. Parse and validate request payload
  let payload: {
    submissionId?: string;
    name?: string;
    slug?: string;
    category?: string;
    photoUrl?: string;
    tasteNotes?: string | null;
    ingredients?: unknown[];
    adminNotes?: string | null;
  };

  try {
    payload = await req.json();
  } catch {
    return jsonAdminResponse(req, { error: 'Invalid JSON request payload.' }, 400);
  }

  const submissionId = payload.submissionId?.trim();
  const cleanName = payload.name?.trim();
  const cleanSlug = payload.slug?.trim();
  const category = payload.category?.trim();
  const requestedPhotoUrl = payload.photoUrl?.trim() || '';

  if (!submissionId || !cleanName || !cleanSlug || !category) {
    return jsonAdminResponse(
      req,
      {
        error:
          'Missing required approval fields: submissionId, name, slug, and category are required.',
      },
      400
    );
  }

  if (!Array.isArray(payload.ingredients) || payload.ingredients.length === 0) {
    return jsonAdminResponse(req, 
      { error: 'At least one verified ingredient is required.' },
      400
    );
  }

  // 3. Trusted server-side client (service_role) strictly for private->public bucket promotion
  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: submission, error: subError } = await serviceClient
    .from('community_submissions')
    .select('id, status, finished_photo_storage_path')
    .eq('id', submissionId)
    .maybeSingle();

  if (subError) {
    return jsonAdminResponse(req, 
      { error: `Could not load submission record: ${subError.message}` },
      500
    );
  }

  if (!submission) {
    return jsonAdminResponse(req, { error: 'Community submission not found.' }, 404);
  }

  if (submission.status !== 'Pending') {
    return jsonAdminResponse(req, 
      {
        error: `Submission is already ${submission.status} and cannot be approved again.`,
      },
      409
    );
  }

  const pendingSourcePath: string | null =
    typeof submission.finished_photo_storage_path === 'string' &&
    submission.finished_photo_storage_path.trim().length > 0
      ? submission.finished_photo_storage_path.trim()
      : null;

  let promotedDestinationPath: string | null = null;
  let finalPublishedPhotoUrl = requestedPhotoUrl;

  // Determine whether we must promote the submission's private pending photo
  const shouldPromotePendingPhoto =
    pendingSourcePath !== null &&
    (requestedPhotoUrl === '' || requestedPhotoUrl === pendingSourcePath);

  if (shouldPromotePendingPhoto && pendingSourcePath) {
    if (
      !PENDING_PHOTO_REGEX.test(pendingSourcePath) ||
      pendingSourcePath.includes('..') ||
      pendingSourcePath.includes('//')
    ) {
      return jsonAdminResponse(req, 
        {
          error:
            'Submission contains an invalid private storage path and cannot be promoted.',
        },
        400
      );
    }

    // Step A: Download private bytes from pending-submissions
    const { data: downloadedBlob, error: downloadError } =
      await serviceClient.storage.from(PENDING_BUCKET).download(pendingSourcePath);

    if (downloadError || !downloadedBlob) {
      return jsonAdminResponse(req, 
        {
          error: `Image promotion failed while reading pending photo: ${
            downloadError?.message || 'File not found'
          }`,
        },
        502
      );
    }

    const mimeType = inferMimeFromPath(pendingSourcePath, downloadedBlob.type);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      return jsonAdminResponse(req, 
        { error: 'Image promotion aborted: unsupported image MIME type.' },
        400
      );
    }

    if (downloadedBlob.size <= 0 || downloadedBlob.size > MAX_IMAGE_BYTES) {
      return jsonAdminResponse(req, 
        {
          error:
            'Image promotion aborted: file size violates the 5 MB image limit.',
        },
        400
      );
    }

    // Step B: Upload to deterministic destination inside published-drinks (retry-safe upsert)
    promotedDestinationPath = buildPromotedDestinationPath(
      submissionId,
      pendingSourcePath
    );

    const { error: uploadError } = await serviceClient.storage
      .from(PUBLISHED_BUCKET)
      .upload(promotedDestinationPath, downloadedBlob, {
        contentType: mimeType,
        upsert: true,
        cacheControl: '31536000',
      });

    if (uploadError) {
      return jsonAdminResponse(req, 
        {
          error: `Image promotion failed while publishing to ${PUBLISHED_BUCKET}: ${uploadError.message}`,
        },
        502
      );
    }

    const { data: pubUrlData } = serviceClient.storage
      .from(PUBLISHED_BUCKET)
      .getPublicUrl(promotedDestinationPath);

    if (!pubUrlData?.publicUrl) {
      await serviceClient.storage
        .from(PUBLISHED_BUCKET)
        .remove([promotedDestinationPath]);
      return jsonAdminResponse(req, 
        {
          error:
            'Image promotion failed: could not resolve published public URL.',
        },
        502
      );
    }

    finalPublishedPhotoUrl = pubUrlData.publicUrl;
  } else if (!isApprovedPublicPhotoUrl(finalPublishedPhotoUrl)) {
    return jsonAdminResponse(req, 
      {
        error:
          'Approved recipe photo must be an approved public URL or promoted from the submission pending photo.',
      },
      400
    );
  }

  // 4. Execute transactional DB approval via user-scoped RPC (double-checks is_verified_admin & records auth.uid)
  const { data: rpcData, error: rpcError } = await userClient.rpc(
    'approve_community_submission',
    {
      p_submission_id: submissionId,
      p_name: cleanName,
      p_slug: cleanSlug,
      p_category: category,
      p_photo_url: finalPublishedPhotoUrl,
      p_taste_notes: payload.tasteNotes ?? null,
      p_ingredients: payload.ingredients,
      p_admin_notes: payload.adminNotes ?? null,
      p_actor_email: user.email ?? null,
    }
  );

  if (rpcError) {
    // Compensating rollback: remove newly promoted public object so no orphan remains
    if (promotedDestinationPath) {
      await serviceClient.storage
        .from(PUBLISHED_BUCKET)
        .remove([promotedDestinationPath]);
    }
    return jsonAdminResponse(req, 
      { error: `Approval transaction failed: ${rpcError.message}` },
      400
    );
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row || typeof row.recipe_id !== 'string') {
    if (promotedDestinationPath) {
      await serviceClient.storage
        .from(PUBLISHED_BUCKET)
        .remove([promotedDestinationPath]);
    }
    return jsonAdminResponse(req, 
      { error: 'Unexpected empty response from approval transaction.' },
      500
    );
  }

  // 5. Post-commit cleanup: remove promoted source file from private pending-submissions
  let cleanupWarning: string | null = null;
  if (promotedDestinationPath && pendingSourcePath) {
    const { error: removeError } = await serviceClient.storage
      .from(PENDING_BUCKET)
      .remove([pendingSourcePath]);
    if (removeError) {
      cleanupWarning = `Published successfully, but pending source cleanup failed: ${removeError.message}`;
    }
  }

  return jsonAdminResponse(req, 
    {
      recipeId: row.recipe_id,
      slug: row.slug,
      totalPurchaseCost: row.total_purchase_cost,
      publishedPhotoUrl: finalPublishedPhotoUrl,
      promotedDestinationPath,
      cleanupWarning,
    },
    200
  );
});
