import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DrinkCategory,
  DrinkRecipe,
  ProductCatalogItem,
  ReportCategory,
  WebsiteSettings,
} from '../types/domain';
import {
  PublicBootstrapData,
  SubmitCommunityHackInput,
  SubmitContactReportInput,
  SupabaseRepositoryError,
  fetchPublicBootstrapData,
  submitCommunityHackInDb,
  submitContactReportInDb,
  toggleRecipeLikeInDb,
} from './supabaseRepository';
import { isInlineDataUrl } from './supabaseStorage';

// =============================================================================
// CONCURRENT REQUEST / DUPLICATE SUBMISSION GUARD
// =============================================================================

export interface InFlightGuard {
  isLocked: (key: string) => boolean;
  runExclusive: <T>(
    key: string,
    fn: () => Promise<T>,
    onDuplicateMessage?: string
  ) => Promise<
    | { executed: true; result: T }
    | { executed: false; error: string }
  >;
}

export function createInFlightGuard(): InFlightGuard {
  const activeKeys = new Set<string>();

  return {
    isLocked: (key: string) => activeKeys.has(key),
    runExclusive: async <T>(
      key: string,
      fn: () => Promise<T>,
      onDuplicateMessage = 'A request is already in progress. Please wait.'
    ) => {
      if (activeKeys.has(key)) {
        return { executed: false as const, error: onDuplicateMessage };
      }
      activeKeys.add(key);
      try {
        const result = await fn();
        return { executed: true as const, result };
      } finally {
        activeKeys.delete(key);
      }
    },
  };
}

// =============================================================================
// DUAL-MODE ORCHESTRATION HELPERS (LIVE SUPABASE VS. LOCAL PREVIEW)
// =============================================================================

export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof SupabaseRepositoryError) {
    return err.message;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return fallback;
}

export async function loadPublicDataByMode(params: {
  isLiveSupabase: boolean;
  client: SupabaseClient | null;
  anonymousBrowserId: string;
  getLocalPreviewData: () => PublicBootstrapData;
}): Promise<
  | { success: true; mode: 'supabase' | 'local-preview'; data: PublicBootstrapData }
  | { success: false; mode: 'supabase'; error: string }
> {
  if (!params.isLiveSupabase) {
    return {
      success: true,
      mode: 'local-preview',
      data: params.getLocalPreviewData(),
    };
  }

  // Live Supabase mode: NEVER silently fall back to LocalStorage / demo data on failure
  try {
    const data = await fetchPublicBootstrapData(
      params.client,
      params.anonymousBrowserId
    );
    return { success: true, mode: 'supabase', data };
  } catch (err) {
    return {
      success: false,
      mode: 'supabase',
      error: extractErrorMessage(
        err,
        'Unable to load live 711acks data from Supabase.'
      ),
    };
  }
}

export async function executeToggleLikeByMode(params: {
  isLiveSupabase: boolean;
  client: SupabaseClient | null;
  guard: InFlightGuard;
  recipeId: string;
  anonymousBrowserId: string;
  localToggle: () => {
    success: boolean;
    liked?: boolean;
    likesCount?: number;
    message?: string;
  };
}): Promise<{
  success: boolean;
  liked?: boolean;
  likesCount?: number;
  message?: string;
}> {
  const lockKey = `like:${params.recipeId}`;
  const guarded = await params.guard.runExclusive(
    lockKey,
    async () => {
      if (!params.isLiveSupabase) {
        return params.localToggle();
      }

      try {
        const res = await toggleRecipeLikeInDb(
          params.client,
          params.recipeId,
          params.anonymousBrowserId
        );
        return {
          success: true,
          liked: res.liked,
          likesCount: res.likesCount,
        };
      } catch (err) {
        return {
          success: false,
          message: extractErrorMessage(
            err,
            'Could not update like status in Supabase.'
          ),
        };
      }
    },
    'Updating like status… please wait.'
  );

  if (!guarded.executed) {
    return { success: false, message: guarded.error };
  }
  return guarded.result;
}

export async function executeSubmitCommunityHackByMode(params: {
  isLiveSupabase: boolean;
  client: SupabaseClient | null;
  guard: InFlightGuard;
  input: SubmitCommunityHackInput;
  localSubmit: () => { success: boolean; submissionId?: string; error?: string };
}): Promise<{ success: boolean; submissionId?: string; error?: string }> {
  const guarded = await params.guard.runExclusive(
    'submit-community-hack',
    async () => {
      if (!params.isLiveSupabase) {
        return params.localSubmit();
      }

      // Security/Storage rule: Never store inline base64 data URLs in PostgreSQL
      if (isInlineDataUrl(params.input.finishedPhotoStoragePath)) {
        return {
          success: false,
          error:
            'Finished drink photo must be uploaded to private pending-submissions storage before submitting.',
        };
      }
      for (const ing of params.input.ingredients) {
        if (isInlineDataUrl(ing.suggestedProductPhotoPath)) {
          return {
            success: false,
            error:
              'Suggested product photo must be uploaded to private pending-submissions storage before submitting.',
          };
        }
      }

      try {
        const res = await submitCommunityHackInDb(params.client, params.input);
        return {
          success: true,
          submissionId: res.submissionId,
        };
      } catch (err) {
        return {
          success: false,
          error: extractErrorMessage(
            err,
            'Failed to save community submission to Supabase.'
          ),
        };
      }
    },
    'Your submission is already being sent. Please wait.'
  );

  if (!guarded.executed) {
    return { success: false, error: guarded.error };
  }
  return guarded.result;
}

export async function executeSubmitContactReportByMode(params: {
  isLiveSupabase: boolean;
  client: SupabaseClient | null;
  guard: InFlightGuard;
  input: SubmitContactReportInput;
  localSubmit: () => { success: boolean; reportId?: string; error?: string };
}): Promise<{ success: boolean; reportId?: string; error?: string }> {
  const guarded = await params.guard.runExclusive(
    'submit-contact-report',
    async () => {
      const cleanMessage = params.input.message.trim();
      if (cleanMessage.length < 10) {
        return {
          success: false,
          error: 'Please provide at least 10 characters describing your report or feedback.',
        };
      }

      const cleanEmail = params.input.reporterEmail?.trim();
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return {
          success: false,
          error: 'Please enter a valid email address or leave the optional email field blank.',
        };
      }

      if (!params.isLiveSupabase) {
        return params.localSubmit();
      }

      try {
        const res = await submitContactReportInDb(params.client, {
          ...params.input,
          reporterName: params.input.reporterName?.trim() || undefined,
          reporterEmail: cleanEmail || undefined,
          message: cleanMessage,
          relatedRecipeSlug: params.input.relatedRecipeSlug?.trim() || undefined,
        });
        return {
          success: true,
          reportId: res.reportId,
        };
      } catch (err) {
        return {
          success: false,
          error: extractErrorMessage(
            err,
            'Failed to save contact report to Supabase.'
          ),
        };
      }
    },
    'Your report is already being submitted. Please wait.'
  );

  if (!guarded.executed) {
    return { success: false, error: guarded.error };
  }
  return guarded.result;
}

export const EMPTY_LIVE_SETTINGS: WebsiteSettings = {
  maintenanceMode: false,
  maintenanceTitle: 'Scheduled Inventory & Price Verification',
  maintenanceMessage:
    '711acks is currently updating verified 7-Eleven Philippines product prices and drink combinations. Please check back shortly.',
  sessionTimeoutMinutes: 30,
  requireAdminOtp: true,
  updatedAt: new Date(0).toISOString(),
};

export type { DrinkCategory, DrinkRecipe, ProductCatalogItem, ReportCategory };
