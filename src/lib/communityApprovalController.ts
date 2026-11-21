import type { SupabaseClient } from '@supabase/supabase-js';
import type { DrinkCategory, RecipeIngredient } from '../types/domain';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE_BYTES,
  PENDING_SUBMISSION_PATH_PATTERN,
  STORAGE_BUCKETS,
  isInlineDataUrl,
} from './supabaseStorage';
import {
  SupabaseRepositoryError,
  requireSupabaseClient,
} from './supabaseRepository';

export const APPROVE_SUBMISSION_EDGE_FUNCTION = 'approve-community-submission';

export interface ApproveCommunitySubmissionRequest {
  submissionId: string;
  name: string;
  slug: string;
  category: DrinkCategory;
  photoUrl: string;
  tasteNotes?: string;
  ingredients: RecipeIngredient[];
  adminNotes?: string;
}

export interface ApproveCommunitySubmissionResponse {
  recipeId: string;
  slug: string;
  totalPurchaseCost: number | null;
  publishedPhotoUrl: string;
  promotedDestinationPath: string | null;
  cleanupWarning: string | null;
}

/**
 * Validates whether a photo URL is safe for storage in `public.recipes.photo_url`.
 * Rejects private `pending-submissions` relative paths, `pending-submissions` URLs,
 * inline base64 `data:` URLs, and path traversal sequences.
 */
export function isApprovedPublishedPhotoUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isInlineDataUrl(trimmed)) return false;
  if (trimmed.includes('..')) return false;
  if (trimmed.toLowerCase().includes(STORAGE_BUCKETS.PENDING_SUBMISSIONS)) {
    return false;
  }
  if (/^(finished-drink|suggested-product)\//.test(trimmed)) {
    return false;
  }
  return trimmed.startsWith('https://') || trimmed.startsWith('/');
}

/**
 * Builds a deterministic, retry-safe destination path inside `published-drinks`
 * matching `003_storage_setup.sql` (`^[a-z0-9][a-z0-9/_-]*\.(jpg|jpeg|png|webp)$`).
 */
export function buildPromotedPublishedDrinkPath(
  submissionId: string,
  pendingSourcePath: string
): string {
  const safeId = submissionId.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const filename = pendingSourcePath.split('/').pop() || '';
  return `community/${safeId}/${filename}`;
}

// =============================================================================
// TESTABLE SERVER-SIDE PROMOTION ORCHESTRATOR (MIRRORS EDGE FUNCTION CONTRACT)
// =============================================================================

export interface TrustedApprovalServerAdapters {
  verifyAdminCaller: () => Promise<
    | { ok: true; adminEmail: string | null }
    | { ok: false; status: 401 | 403; error: string }
  >;
  loadSubmission: (submissionId: string) => Promise<{
    id: string;
    status: string;
    finishedPhotoStoragePath: string | null;
  } | null>;
  downloadPendingImage: (
    path: string
  ) => Promise<{ bytes: Uint8Array; mimeType: string }>;
  uploadPublishedImage: (
    destinationPath: string,
    bytes: Uint8Array,
    mimeType: string
  ) => Promise<{ publicUrl: string }>;
  removePublishedImage: (destinationPath: string) => Promise<void>;
  removePendingImage: (sourcePath: string) => Promise<void>;
  commitApprovalRpc: (args: {
    submissionId: string;
    name: string;
    slug: string;
    category: DrinkCategory;
    publishedPhotoUrl: string;
    tasteNotes?: string;
    ingredients: RecipeIngredient[];
    adminNotes?: string;
    actorEmail: string | null;
  }) => Promise<{
    recipeId: string;
    slug: string;
    totalPurchaseCost: number | null;
  }>;
}

export type TrustedApprovalOutcome =
  | { ok: true; status: 200; data: ApproveCommunitySubmissionResponse }
  | { ok: false; status: number; error: string };

/**
 * Pure server-side approval & image promotion workflow used to verify every
 * security invariant, rollback branch, retry path, and cleanup behavior.
 */
export async function executeTrustedSubmissionApproval(
  request: ApproveCommunitySubmissionRequest,
  adapters: TrustedApprovalServerAdapters
): Promise<TrustedApprovalOutcome> {
  const auth = await adapters.verifyAdminCaller();
  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.error };
  }

  const submission = await adapters.loadSubmission(request.submissionId);
  if (!submission) {
    return { ok: false, status: 404, error: 'Community submission not found.' };
  }
  if (submission.status !== 'Pending') {
    return {
      ok: false,
      status: 409,
      error: `Submission is already ${submission.status} and cannot be approved again.`,
    };
  }

  const pendingSourcePath = submission.finishedPhotoStoragePath?.trim() || null;
  const requestedPhotoUrl = request.photoUrl.trim();
  const shouldPromotePendingPhoto =
    pendingSourcePath !== null &&
    (requestedPhotoUrl === '' || requestedPhotoUrl === pendingSourcePath);

  let promotedDestinationPath: string | null = null;
  let finalPublishedPhotoUrl = requestedPhotoUrl;

  if (shouldPromotePendingPhoto && pendingSourcePath) {
    if (
      !PENDING_SUBMISSION_PATH_PATTERN.test(pendingSourcePath) ||
      !pendingSourcePath.startsWith('finished-drink/') ||
      pendingSourcePath.includes('..') ||
      pendingSourcePath.includes('//')
    ) {
      return {
        ok: false,
        status: 400,
        error:
          'Submission contains an invalid private storage path and cannot be promoted.',
      };
    }

    let downloaded: { bytes: Uint8Array; mimeType: string };
    try {
      downloaded = await adapters.downloadPendingImage(pendingSourcePath);
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: `Image promotion failed while reading pending photo: ${
          err instanceof Error ? err.message : 'Download error'
        }`,
      };
    }

    if (
      !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(
        downloaded.mimeType
      )
    ) {
      return {
        ok: false,
        status: 400,
        error: 'Image promotion aborted: unsupported image MIME type.',
      };
    }

    if (
      downloaded.bytes.byteLength <= 0 ||
      downloaded.bytes.byteLength > MAX_IMAGE_FILE_SIZE_BYTES
    ) {
      return {
        ok: false,
        status: 400,
        error:
          'Image promotion aborted: file size violates the 5 MB image limit.',
      };
    }

    promotedDestinationPath = buildPromotedPublishedDrinkPath(
      request.submissionId,
      pendingSourcePath
    );

    try {
      const uploaded = await adapters.uploadPublishedImage(
        promotedDestinationPath,
        downloaded.bytes,
        downloaded.mimeType
      );
      if (!isApprovedPublishedPhotoUrl(uploaded.publicUrl)) {
        await adapters.removePublishedImage(promotedDestinationPath);
        return {
          ok: false,
          status: 502,
          error:
            'Image promotion failed: resolved public URL failed safety validation.',
        };
      }
      finalPublishedPhotoUrl = uploaded.publicUrl;
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: `Image promotion failed while publishing to ${STORAGE_BUCKETS.PUBLISHED_DRINKS}: ${
          err instanceof Error ? err.message : 'Upload error'
        }`,
      };
    }
  } else if (!isApprovedPublishedPhotoUrl(finalPublishedPhotoUrl)) {
    return {
      ok: false,
      status: 400,
      error:
        'Approved recipe photo must be an approved public URL or promoted from the submission pending photo.',
    };
  }

  let committed: {
    recipeId: string;
    slug: string;
    totalPurchaseCost: number | null;
  };
  try {
    committed = await adapters.commitApprovalRpc({
      submissionId: request.submissionId,
      name: request.name,
      slug: request.slug,
      category: request.category,
      publishedPhotoUrl: finalPublishedPhotoUrl,
      tasteNotes: request.tasteNotes,
      ingredients: request.ingredients,
      adminNotes: request.adminNotes,
      actorEmail: auth.adminEmail,
    });
  } catch (err) {
    // Compensating rollback of newly uploaded public object
    if (promotedDestinationPath) {
      try {
        await adapters.removePublishedImage(promotedDestinationPath);
      } catch {
        // Preserve original DB transaction failure message
      }
    }
    return {
      ok: false,
      status: 400,
      error: `Approval transaction failed: ${
        err instanceof Error ? err.message : 'Database RPC error'
      }`,
    };
  }

  let cleanupWarning: string | null = null;
  if (promotedDestinationPath && pendingSourcePath) {
    try {
      await adapters.removePendingImage(pendingSourcePath);
    } catch (err) {
      cleanupWarning = `Published successfully, but pending source cleanup failed: ${
        err instanceof Error ? err.message : 'Cleanup error'
      }`;
    }
  }

  return {
    ok: true,
    status: 200,
    data: {
      recipeId: committed.recipeId,
      slug: committed.slug,
      totalPurchaseCost: committed.totalPurchaseCost,
      publishedPhotoUrl: finalPublishedPhotoUrl,
      promotedDestinationPath,
      cleanupWarning,
    },
  };
}

// =============================================================================
// FRONTEND CLIENT INVOKER (NO SERVICE-ROLE CREDENTIALS — USER JWT ONLY)
// =============================================================================

/**
 * Invokes the trusted server-side `approve-community-submission` Supabase Edge
 * Function using the authenticated admin's Supabase session JWT.
 * Never promotes images from the browser and never calls getPublicUrl on private files.
 */
export async function invokeApproveCommunitySubmissionEdgeFunction(
  client: SupabaseClient | null,
  request: ApproveCommunitySubmissionRequest
): Promise<ApproveCommunitySubmissionResponse> {
  const db = requireSupabaseClient(
    client,
    'invokeApproveCommunitySubmissionEdgeFunction'
  );

  const { data, error } = await db.functions.invoke(
    APPROVE_SUBMISSION_EDGE_FUNCTION,
    {
      body: {
        submissionId: request.submissionId,
        name: request.name,
        slug: request.slug,
        category: request.category,
        photoUrl: request.photoUrl,
        tasteNotes: request.tasteNotes ?? null,
        ingredients: request.ingredients.map((ing) => ({
          product_id: ing.productId,
          product_name_snapshot: ing.productNameSnapshot,
          product_photo_snapshot: ing.productPhotoSnapshot,
          quantity_used: ing.quantityUsed,
          units_to_purchase: ing.unitsToPurchase,
          price_snapshot: ing.priceSnapshot,
          price_verified: ing.priceVerified,
        })),
        adminNotes: request.adminNotes ?? null,
      },
    }
  );

  if (error) {
    throw new SupabaseRepositoryError(
      'invokeApproveCommunitySubmissionEdgeFunction',
      error.message ||
        'Trusted approval Edge Function failed. Pending submission was not published.',
      { code: 'EDGE_FUNCTION_ERROR' }
    );
  }

  const parsed = data as Partial<ApproveCommunitySubmissionResponse> & {
    error?: string;
  };

  if (parsed?.error) {
    throw new SupabaseRepositoryError(
      'invokeApproveCommunitySubmissionEdgeFunction',
      parsed.error
    );
  }

  if (
    !parsed ||
    typeof parsed.recipeId !== 'string' ||
    typeof parsed.slug !== 'string' ||
    typeof parsed.publishedPhotoUrl !== 'string'
  ) {
    throw new SupabaseRepositoryError(
      'invokeApproveCommunitySubmissionEdgeFunction',
      'Unexpected response from approve-community-submission Edge Function.'
    );
  }

  return {
    recipeId: parsed.recipeId,
    slug: parsed.slug,
    totalPurchaseCost:
      typeof parsed.totalPurchaseCost === 'number'
        ? parsed.totalPurchaseCost
        : null,
    publishedPhotoUrl: parsed.publishedPhotoUrl,
    promotedDestinationPath: parsed.promotedDestinationPath ?? null,
    cleanupWarning: parsed.cleanupWarning ?? null,
  };
}
