import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BackupRecordMetadata,
  CommunitySubmission,
  CommunitySubmissionIngredient,
  ContactReport,
  DrinkCategory,
  DrinkRecipe,
  ProductCatalogItem,
  ProductPriceHistoryEntry,
  ProductSuggestion,
  RecipeIngredient,
  RecipePriceSnapshot,
  RecipePriceSnapshotIngredient,
  RecipeRevision,
  RecipeStatus,
  ReportCategory,
  SecurityEvent,
  WebsiteSettings,
} from '../types/domain';

// =============================================================================
// EXPLICIT REPOSITORY ERROR HANDLING
// =============================================================================

export class SupabaseRepositoryError extends Error {
  public readonly operation: string;
  public readonly code?: string;
  public readonly details?: string;
  public readonly hint?: string;
  public readonly status?: number;

  constructor(
    operation: string,
    message: string,
    options?: { code?: string; details?: string; hint?: string; status?: number }
  ) {
    super(`[${operation}] ${message}`);
    this.name = 'SupabaseRepositoryError';
    this.operation = operation;
    this.code = options?.code;
    this.details = options?.details;
    this.hint = options?.hint;
    this.status = options?.status;
  }
}

interface SupabaseErrorLike {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
}

const UNAUTHORIZED_ERROR_CODES = new Set([
  'UNAUTHORIZED',
  'PGRST301',
  '42501',
]);

const UNAUTHORIZED_MESSAGE_PATTERNS = [
  /\bUNAUTHORIZED\b/i,
  /verified admin session required/i,
  /jwt expired/i,
  /invalid jwt/i,
  /row-level security policy/i,
  /permission denied/i,
];

/**
 * H-01: Reliably detects server-side unauthorized or expired-session rejections
 * across PostgREST/PostgreSQL responses — including PostgreSQL `RAISE EXCEPTION`
 * errors returned with SQLSTATE `P0001` and an `UNAUTHORIZED:` message prefix,
 * JWT rejections (`PGRST301`), RLS denials (`42501`), and HTTP 401/403 statuses.
 */
export function isUnauthorizedSupabaseError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return typeof err === 'string'
      ? UNAUTHORIZED_MESSAGE_PATTERNS.some((re) => re.test(err))
      : false;
  }

  const candidate = err as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    status?: unknown;
  };

  if (candidate.status === 401 || candidate.status === 403) {
    return true;
  }

  const normalizedCode =
    typeof candidate.code === 'string' ? candidate.code.trim().toUpperCase() : '';
  if (normalizedCode && UNAUTHORIZED_ERROR_CODES.has(normalizedCode)) {
    return true;
  }

  const combinedText = [
    typeof candidate.message === 'string' ? candidate.message : '',
    typeof candidate.details === 'string' ? candidate.details : '',
    typeof candidate.hint === 'string' ? candidate.hint : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (normalizedCode === 'P0001') {
    return UNAUTHORIZED_MESSAGE_PATTERNS.some((re) => re.test(combinedText));
  }

  return UNAUTHORIZED_MESSAGE_PATTERNS.some((re) => re.test(combinedText));
}

export function requireSupabaseClient(
  client: SupabaseClient | null | undefined,
  operation: string
): SupabaseClient {
  if (!client) {
    throw new SupabaseRepositoryError(
      operation,
      'Supabase client is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      { code: 'SUPABASE_NOT_CONFIGURED' }
    );
  }
  return client;
}

export function assertNoSupabaseError(
  error: SupabaseErrorLike | null | undefined,
  operation: string
): void {
  if (!error) return;
  throw new SupabaseRepositoryError(operation, error.message || 'Database operation failed.', {
    code: error.code,
    details: error.details ?? undefined,
    hint: error.hint ?? undefined,
    status: error.status,
  });
}

// =============================================================================
// RAW POSTGRESQL / POSTGREST ROW TYPES (MIRRORING 001 + 002 MIGRATIONS)
// =============================================================================

export interface DbProductRow {
  id: string;
  name: string;
  photo_url: string;
  purchase_price: number | string;
  barcode: string | null;
  is_archived: boolean;
  last_updated_at: string;
  created_at?: string;
}

export interface DbProductPriceHistoryRow {
  id: string;
  product_id: string;
  previous_price: number | string;
  new_price: number | string;
  changed_by: string | null;
  changed_at: string;
  products?: { name: string } | { name: string }[] | null;
}

export interface DbRecipeIngredientRow {
  id: string;
  recipe_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  product_photo_snapshot: string;
  quantity_used: string;
  units_to_purchase: number | string;
  price_snapshot: number | string | null;
  price_verified: boolean;
  sort_order?: number | null;
}

export interface DbRecipeRow {
  id: string;
  slug: string;
  name: string;
  category: DrinkCategory;
  status: RecipeStatus;
  photo_url: string;
  submitter_name: string;
  taste_notes: string | null;
  total_purchase_cost: number | string | null;
  price_verified: boolean;
  needs_price_review: boolean;
  last_price_verified_at: string | null;
  is_editors_pick: boolean;
  is_trending: boolean;
  likes_count: number;
  pending_draft_json: unknown;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  recipe_ingredients?: DbRecipeIngredientRow[] | null;
}

export interface DbRecipePriceSnapshotRow {
  id: string;
  recipe_id: string;
  total_purchase_cost: number | string;
  ingredient_breakdown: unknown;
  verified_by: string | null;
  verified_at: string;
}

export interface DbSubmissionIngredientRow {
  id: string;
  submission_id: string;
  product_id: string | null;
  suggested_product_name: string | null;
  suggested_product_price: number | string | null;
  suggested_product_photo_path: string | null;
  quantity_used: string;
  units_to_purchase: number | string;
}

export interface DbCommunitySubmissionRow {
  id: string;
  drink_name: string;
  category: DrinkCategory;
  submitter_name: string;
  taste_notes: string | null;
  finished_photo_storage_path: string | null;
  status: 'Pending' | 'Published' | 'Rejected';
  duplicate_warning_notes: string | null;
  admin_review_notes: string | null;
  approved_recipe_id: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  submission_ingredients?: DbSubmissionIngredientRow[] | null;
}

export interface DbProductSuggestionRow {
  id: string;
  submission_id: string | null;
  suggested_name: string;
  suggested_price: number | string | null;
  photo_storage_path: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  approved_product_id: string | null;
  created_at: string;
}

export interface DbRecipeRevisionRow {
  id: string;
  recipe_id: string;
  version_number: number;
  changed_fields: string[] | null;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  change_summary: string;
  restored_from_revision_id: string | null;
  created_by: string;
  created_at: string;
  recipes?: { name: string } | { name: string }[] | null;
}

export interface DbContactReportRow {
  id: string;
  reporter_name: string | null;
  reporter_email: string | null;
  category: ReportCategory;
  message: string;
  related_recipe_slug: string | null;
  status: 'Open' | 'In Review' | 'Resolved' | 'Archived';
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface DbWebsiteSettingsRow {
  id: number;
  maintenance_mode: boolean;
  maintenance_title: string;
  maintenance_message: string;
  session_timeout_minutes: number;
  require_admin_otp: boolean;
  updated_at: string;
}

export interface DbSecurityEventRow {
  id: string;
  event_type: string;
  actor: string;
  details: string;
  ip_hash: string | null;
  created_at: string;
}

export interface DbBackupRecordRow {
  id: string;
  backup_filename: string;
  record_counts: Record<string, unknown> | null;
  includes_storage_manifest: boolean;
  checksum: string;
  created_by: string | null;
  created_at: string;
}

// =============================================================================
// PURE ROW-TO-DOMAIN MAPPERS
// =============================================================================

function parseRequiredNumeric(value: number | string, fieldName: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new SupabaseRepositoryError(
      'mapNumeric',
      `Invalid numeric value for column "${fieldName}".`,
      { code: 'INVALID_NUMERIC_DATA' }
    );
  }
  return num;
}

function parseNullableNumeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function extractJoinedName(
  relation: { name: string } | { name: string }[] | null | undefined,
  fallback: string
): string {
  if (!relation) return fallback;
  if (Array.isArray(relation)) {
    return relation[0]?.name || fallback;
  }
  return relation.name || fallback;
}

function parsePendingDraft(raw: unknown): DrinkRecipe['pendingDraft'] {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.name !== 'string' ||
    typeof candidate.category !== 'string' ||
    typeof candidate.photoUrl !== 'string' ||
    !Array.isArray(candidate.ingredients)
  ) {
    return null;
  }
  return {
    name: candidate.name,
    category: candidate.category as DrinkCategory,
    tasteNotes: typeof candidate.tasteNotes === 'string' ? candidate.tasteNotes : undefined,
    photoUrl: candidate.photoUrl,
    ingredients: candidate.ingredients as RecipeIngredient[],
    savedAt:
      typeof candidate.savedAt === 'string' ? candidate.savedAt : new Date(0).toISOString(),
  };
}

export function mapProductRowToDomain(row: DbProductRow): ProductCatalogItem {
  return {
    id: row.id,
    name: row.name,
    photoUrl: row.photo_url,
    purchasePrice: parseRequiredNumeric(row.purchase_price, 'products.purchase_price'),
    barcode: row.barcode ?? undefined,
    isArchived: Boolean(row.is_archived),
    lastUpdatedAt: row.last_updated_at,
    isDemoRecord: false,
  };
}

export function mapProductPriceHistoryRowToDomain(
  row: DbProductPriceHistoryRow
): ProductPriceHistoryEntry {
  return {
    id: row.id,
    productId: row.product_id,
    productName: extractJoinedName(row.products, 'Unknown Product'),
    previousPrice: parseRequiredNumeric(
      row.previous_price,
      'product_price_history.previous_price'
    ),
    newPrice: parseRequiredNumeric(row.new_price, 'product_price_history.new_price'),
    changedAt: row.changed_at,
  };
}

export function mapRecipeIngredientRowToDomain(
  row: DbRecipeIngredientRow
): RecipeIngredient {
  const unitsRaw = typeof row.units_to_purchase === 'number'
    ? row.units_to_purchase
    : Number(row.units_to_purchase);
  return {
    id: row.id,
    productId: row.product_id,
    productNameSnapshot: row.product_name_snapshot,
    productPhotoSnapshot: row.product_photo_snapshot,
    quantityUsed: row.quantity_used,
    unitsToPurchase: Number.isFinite(unitsRaw) && unitsRaw >= 1 ? Math.floor(unitsRaw) : 1,
    priceSnapshot: parseNullableNumeric(row.price_snapshot),
    priceVerified: Boolean(row.price_verified),
  };
}

export function mapRecipeRowToDomain(row: DbRecipeRow): DrinkRecipe {
  const sortedIngredients = [...(row.recipe_ingredients ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(mapRecipeIngredientRowToDomain);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    status: row.status,
    photoUrl: row.photo_url,
    submitterName: row.submitter_name || 'Anonymous Creator',
    tasteNotes: row.taste_notes ?? undefined,
    ingredients: sortedIngredients,
    totalPurchaseCost: parseNullableNumeric(row.total_purchase_cost),
    priceVerified: Boolean(row.price_verified),
    needsPriceReview: Boolean(row.needs_price_review),
    lastPriceVerifiedAt: row.last_price_verified_at,
    isEditorsPick: Boolean(row.is_editors_pick),
    isTrending: Boolean(row.is_trending),
    likesCount: Math.max(0, Number(row.likes_count) || 0),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDemoRecord: false,
    pendingDraft: parsePendingDraft(row.pending_draft_json),
  };
}

export function mapRecipePriceSnapshotRowToDomain(
  row: DbRecipePriceSnapshotRow
): RecipePriceSnapshot {
  const rawList = Array.isArray(row.ingredient_breakdown) ? row.ingredient_breakdown : [];
  const ingredientBreakdown: RecipePriceSnapshotIngredient[] = rawList
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const units = Math.max(1, Math.floor(Number(item.unitsToPurchase ?? item.units_to_purchase ?? 1) || 1));
      const unitPrice = parseNullableNumeric(
        (item.priceSnapshot ?? item.price_snapshot) as number | string | null | undefined
      ) ?? 0;
      const lineTotal =
        parseNullableNumeric(
          (item.lineTotal ?? item.line_total) as number | string | null | undefined
        ) ?? Number((unitPrice * units).toFixed(2));
      return {
        productId:
          typeof item.productId === 'string'
            ? item.productId
            : typeof item.product_id === 'string'
            ? item.product_id
            : null,
        productNameSnapshot: String(
          item.productNameSnapshot ?? item.product_name_snapshot ?? 'Unknown Product'
        ),
        quantityUsed: String(item.quantityUsed ?? item.quantity_used ?? ''),
        unitsToPurchase: units,
        priceSnapshot: unitPrice,
        lineTotal,
      };
    });

  return {
    id: row.id,
    recipeId: row.recipe_id,
    totalPurchaseCost: parseRequiredNumeric(
      row.total_purchase_cost,
      'recipe_price_snapshots.total_purchase_cost'
    ),
    ingredientBreakdown,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
  };
}

export function mapSubmissionIngredientRowToDomain(
  row: DbSubmissionIngredientRow
): CommunitySubmissionIngredient {
  const unitsRaw = typeof row.units_to_purchase === 'number'
    ? row.units_to_purchase
    : Number(row.units_to_purchase);
  return {
    id: row.id,
    productId: row.product_id,
    suggestedProductName: row.suggested_product_name ?? undefined,
    suggestedProductPrice: parseNullableNumeric(row.suggested_product_price),
    suggestedProductPhotoUrl: row.suggested_product_photo_path ?? undefined,
    quantityUsed: row.quantity_used,
    unitsToPurchase: Number.isFinite(unitsRaw) && unitsRaw >= 1 ? Math.floor(unitsRaw) : 1,
  };
}

export function mapCommunitySubmissionRowToDomain(
  row: DbCommunitySubmissionRow
): CommunitySubmission {
  return {
    id: row.id,
    drinkName: row.drink_name,
    category: row.category,
    submitterName: row.submitter_name || 'Anonymous Creator',
    tasteNotes: row.taste_notes ?? undefined,
    finishedPhotoUrl: row.finished_photo_storage_path ?? undefined,
    ingredients: (row.submission_ingredients ?? []).map(mapSubmissionIngredientRowToDomain),
    status: row.status,
    duplicateWarningNotes: row.duplicate_warning_notes ?? undefined,
    adminReviewNotes: row.admin_review_notes ?? undefined,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? undefined,
  };
}

export function mapProductSuggestionRowToDomain(
  row: DbProductSuggestionRow
): ProductSuggestion {
  return {
    id: row.id,
    submissionId: row.submission_id ?? '',
    suggestedName: row.suggested_name,
    suggestedPrice: parseNullableNumeric(row.suggested_price),
    photoUrl: row.photo_storage_path ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function mapRecipeRevisionRowToDomain(row: DbRecipeRevisionRow): RecipeRevision {
  const fallbackNameFromSnapshot =
    typeof row.new_values?.name === 'string'
      ? row.new_values.name
      : typeof row.previous_values?.name === 'string'
      ? row.previous_values.name
      : 'Recipe';

  return {
    id: row.id,
    recipeId: row.recipe_id,
    recipeName: extractJoinedName(row.recipes, fallbackNameFromSnapshot),
    versionNumber: row.version_number,
    changedFields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
    previousValues: row.previous_values ?? {},
    newValues: row.new_values ?? {},
    changeSummary: row.change_summary,
    restoredFromRevisionId: row.restored_from_revision_id ?? undefined,
    createdBy: row.created_by || 'Admin',
    createdAt: row.created_at,
  };
}

export function mapContactReportRowToDomain(row: DbContactReportRow): ContactReport {
  return {
    id: row.id,
    reporterName: row.reporter_name ?? undefined,
    reporterEmail: row.reporter_email ?? undefined,
    category: row.category,
    message: row.message,
    relatedRecipeSlug: row.related_recipe_slug ?? undefined,
    status: row.status,
    adminNotes: row.admin_notes ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

export function mapWebsiteSettingsRowToDomain(row: DbWebsiteSettingsRow): WebsiteSettings {
  return {
    maintenanceMode: Boolean(row.maintenance_mode),
    maintenanceTitle: row.maintenance_title,
    maintenanceMessage: row.maintenance_message,
    sessionTimeoutMinutes: row.session_timeout_minutes || 30,
    requireAdminOtp: Boolean(row.require_admin_otp),
    updatedAt: row.updated_at,
  };
}

const KNOWN_SECURITY_EVENT_TYPES = new Set<SecurityEvent['eventType']>([
  'ADMIN_PASSWORD_VERIFIED',
  'ADMIN_LOGIN_FAILED',
  'ADMIN_LOCKOUT_TRIGGERED',
  'ADMIN_OTP_ISSUED',
  'ADMIN_OTP_VERIFIED',
  'ADMIN_OTP_FAILED',
  'ADMIN_SESSION_TIMEOUT',
  'ADMIN_LOGOUT',
  'MAINTENANCE_MODE_CHANGED',
  'BACKUP_EXPORTED',
  'BACKUP_RESTORED',
]);

export function mapSecurityEventRowToDomain(row: DbSecurityEventRow): SecurityEvent {
  const eventType = KNOWN_SECURITY_EVENT_TYPES.has(
    row.event_type as SecurityEvent['eventType']
  )
    ? (row.event_type as SecurityEvent['eventType'])
    : 'ADMIN_LOGIN_FAILED';

  return {
    id: row.id,
    eventType,
    actor: row.actor,
    details: row.details,
    createdAt: row.created_at,
  };
}

export function mapBackupRecordRowToDomain(row: DbBackupRecordRow): BackupRecordMetadata {
  const recordCounts: Record<string, number> = {};
  if (row.record_counts && typeof row.record_counts === 'object') {
    for (const [key, val] of Object.entries(row.record_counts)) {
      const numeric = Number(val);
      if (Number.isFinite(numeric)) {
        recordCounts[key] = numeric;
      }
    }
  }

  return {
    id: row.id,
    backupFilename: row.backup_filename,
    recordCounts,
    includesStorageManifest: Boolean(row.includes_storage_manifest),
    checksum: row.checksum,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// =============================================================================
// PUBLIC READS (ANONYMOUS / VISITOR SCOPE)
// =============================================================================

export async function fetchPublishedRecipes(
  client: SupabaseClient | null
): Promise<DrinkRecipe[]> {
  const db = requireSupabaseClient(client, 'fetchPublishedRecipes');
  const { data, error } = await db
    .from('recipes')
    .select('*, recipe_ingredients(*)')
    .eq('status', 'Published')
    .order('published_at', { ascending: false, nullsFirst: false });

  assertNoSupabaseError(error, 'fetchPublishedRecipes');
  return ((data ?? []) as DbRecipeRow[]).map(mapRecipeRowToDomain);
}

export async function fetchPublishedRecipeBySlug(
  client: SupabaseClient | null,
  slug: string
): Promise<DrinkRecipe | null> {
  const db = requireSupabaseClient(client, 'fetchPublishedRecipeBySlug');
  const { data, error } = await db
    .from('recipes')
    .select('*, recipe_ingredients(*)')
    .eq('status', 'Published')
    .eq('slug', slug)
    .maybeSingle();

  assertNoSupabaseError(error, 'fetchPublishedRecipeBySlug');
  return data ? mapRecipeRowToDomain(data as DbRecipeRow) : null;
}

export async function fetchActiveProducts(
  client: SupabaseClient | null
): Promise<ProductCatalogItem[]> {
  const db = requireSupabaseClient(client, 'fetchActiveProducts');
  const { data, error } = await db
    .from('products')
    .select('*')
    .eq('is_archived', false)
    .order('name', { ascending: true });

  assertNoSupabaseError(error, 'fetchActiveProducts');
  return ((data ?? []) as DbProductRow[]).map(mapProductRowToDomain);
}

export async function fetchWebsiteSettings(
  client: SupabaseClient | null
): Promise<WebsiteSettings> {
  const db = requireSupabaseClient(client, 'fetchWebsiteSettings');
  const { data, error } = await db
    .from('website_settings')
    .select('*')
    .eq('id', 1)
    .single();

  assertNoSupabaseError(error, 'fetchWebsiteSettings');
  return mapWebsiteSettingsRowToDomain(data as DbWebsiteSettingsRow);
}

export async function fetchLikedRecipeIds(
  client: SupabaseClient | null,
  anonymousBrowserId: string
): Promise<string[]> {
  const db = requireSupabaseClient(client, 'fetchLikedRecipeIds');
  const { data, error } = await db.rpc('get_liked_recipe_ids', {
    p_anonymous_browser_id: anonymousBrowserId,
  });

  assertNoSupabaseError(error, 'fetchLikedRecipeIds');
  return ((data ?? []) as { recipe_id: string }[]).map((row) => row.recipe_id);
}

export interface PublicBootstrapData {
  recipes: DrinkRecipe[];
  products: ProductCatalogItem[];
  websiteSettings: WebsiteSettings;
  likedRecipeIds: string[];
}

export async function fetchPublicBootstrapData(
  client: SupabaseClient | null,
  anonymousBrowserId?: string
): Promise<PublicBootstrapData> {
  const db = requireSupabaseClient(client, 'fetchPublicBootstrapData');
  const [recipes, products, websiteSettings, likedRecipeIds] = await Promise.all([
    fetchPublishedRecipes(db),
    fetchActiveProducts(db),
    fetchWebsiteSettings(db),
    anonymousBrowserId ? fetchLikedRecipeIds(db, anonymousBrowserId) : Promise.resolve([]),
  ]);

  return { recipes, products, websiteSettings, likedRecipeIds };
}

// =============================================================================
// PUBLIC CONTROLLED WRITES (VIA HARDENED RPCs)
// =============================================================================

export async function toggleRecipeLikeInDb(
  client: SupabaseClient | null,
  recipeId: string,
  anonymousBrowserId: string
): Promise<{ liked: boolean; likesCount: number }> {
  const db = requireSupabaseClient(client, 'toggleRecipeLikeInDb');
  const { data, error } = await db.rpc('toggle_recipe_like', {
    p_recipe_id: recipeId,
    p_anonymous_browser_id: anonymousBrowserId,
  });

  assertNoSupabaseError(error, 'toggleRecipeLikeInDb');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.liked !== 'boolean' || typeof row.likes_count !== 'number') {
    throw new SupabaseRepositoryError(
      'toggleRecipeLikeInDb',
      'Unexpected response from toggle_recipe_like RPC.'
    );
  }
  return {
    liked: row.liked,
    likesCount: row.likes_count,
  };
}

export interface SubmitCommunityHackInput {
  drinkName: string;
  category: DrinkCategory;
  submitterName?: string;
  tasteNotes?: string;
  finishedPhotoStoragePath?: string;
  duplicateWarningNotes?: string;
  ingredients: Array<{
    productId: string | null;
    suggestedProductName?: string;
    suggestedProductPrice?: number | null;
    suggestedProductPhotoPath?: string;
    quantityUsed: string;
    unitsToPurchase: number;
  }>;
}

export async function submitCommunityHackInDb(
  client: SupabaseClient | null,
  input: SubmitCommunityHackInput
): Promise<{ submissionId: string }> {
  const db = requireSupabaseClient(client, 'submitCommunityHackInDb');
  const { data, error } = await db.rpc('submit_community_hack', {
    p_drink_name: input.drinkName,
    p_category: input.category,
    p_submitter_name: input.submitterName ?? null,
    p_taste_notes: input.tasteNotes ?? null,
    p_finished_photo_storage_path: input.finishedPhotoStoragePath ?? null,
    p_duplicate_warning_notes: input.duplicateWarningNotes ?? null,
    p_ingredients: input.ingredients.map((ing) => ({
      product_id: ing.productId,
      suggested_product_name: ing.suggestedProductName ?? null,
      suggested_product_price: ing.suggestedProductPrice ?? null,
      suggested_product_photo_path: ing.suggestedProductPhotoPath ?? null,
      quantity_used: ing.quantityUsed,
      units_to_purchase: ing.unitsToPurchase,
    })),
  });

  assertNoSupabaseError(error, 'submitCommunityHackInDb');
  if (typeof data !== 'string' || !data) {
    throw new SupabaseRepositoryError(
      'submitCommunityHackInDb',
      'Database did not return a submission identifier.'
    );
  }
  return { submissionId: data };
}

export interface SubmitContactReportInput {
  reporterName?: string;
  reporterEmail?: string;
  category: ReportCategory;
  message: string;
  relatedRecipeSlug?: string;
}

export async function submitContactReportInDb(
  client: SupabaseClient | null,
  input: SubmitContactReportInput
): Promise<{ reportId: string }> {
  const db = requireSupabaseClient(client, 'submitContactReportInDb');
  const { data, error } = await db.rpc('submit_contact_report', {
    p_category: input.category,
    p_message: input.message,
    p_reporter_name: input.reporterName ?? null,
    p_reporter_email: input.reporterEmail ?? null,
    p_related_recipe_slug: input.relatedRecipeSlug ?? null,
  });

  assertNoSupabaseError(error, 'submitContactReportInDb');
  if (typeof data !== 'string' || !data) {
    throw new SupabaseRepositoryError(
      'submitContactReportInDb',
      'Database did not return a contact report identifier.'
    );
  }
  return { reportId: data };
}

// =============================================================================
// PROTECTED ADMIN READS (ENFORCED BY RLS + is_verified_admin())
// =============================================================================

export async function fetchAllRecipesAdmin(
  client: SupabaseClient | null
): Promise<DrinkRecipe[]> {
  const db = requireSupabaseClient(client, 'fetchAllRecipesAdmin');
  const { data, error } = await db
    .from('recipes')
    .select('*, recipe_ingredients(*)')
    .order('updated_at', { ascending: false });

  assertNoSupabaseError(error, 'fetchAllRecipesAdmin');
  return ((data ?? []) as DbRecipeRow[]).map(mapRecipeRowToDomain);
}

export async function fetchAllProductsAdmin(
  client: SupabaseClient | null
): Promise<ProductCatalogItem[]> {
  const db = requireSupabaseClient(client, 'fetchAllProductsAdmin');
  const { data, error } = await db
    .from('products')
    .select('*')
    .order('name', { ascending: true });

  assertNoSupabaseError(error, 'fetchAllProductsAdmin');
  return ((data ?? []) as DbProductRow[]).map(mapProductRowToDomain);
}

export async function fetchProductPriceHistoryAdmin(
  client: SupabaseClient | null
): Promise<ProductPriceHistoryEntry[]> {
  const db = requireSupabaseClient(client, 'fetchProductPriceHistoryAdmin');
  const { data, error } = await db
    .from('product_price_history')
    .select('*, products(name)')
    .order('changed_at', { ascending: false });

  assertNoSupabaseError(error, 'fetchProductPriceHistoryAdmin');
  return ((data ?? []) as DbProductPriceHistoryRow[]).map(
    mapProductPriceHistoryRowToDomain
  );
}

export async function fetchRecipePriceSnapshotsAdmin(
  client: SupabaseClient | null,
  recipeId?: string
): Promise<RecipePriceSnapshot[]> {
  const db = requireSupabaseClient(client, 'fetchRecipePriceSnapshotsAdmin');
  let query = db
    .from('recipe_price_snapshots')
    .select('*')
    .order('verified_at', { ascending: false });

  if (recipeId) {
    query = query.eq('recipe_id', recipeId);
  }

  const { data, error } = await query;
  assertNoSupabaseError(error, 'fetchRecipePriceSnapshotsAdmin');
  return ((data ?? []) as DbRecipePriceSnapshotRow[]).map(
    mapRecipePriceSnapshotRowToDomain
  );
}

export async function fetchCommunitySubmissionsAdmin(
  client: SupabaseClient | null
): Promise<CommunitySubmission[]> {
  const db = requireSupabaseClient(client, 'fetchCommunitySubmissionsAdmin');
  const { data, error } = await db
    .from('community_submissions')
    .select('*, submission_ingredients(*)')
    .order('submitted_at', { ascending: false });

  assertNoSupabaseError(error, 'fetchCommunitySubmissionsAdmin');
  return ((data ?? []) as DbCommunitySubmissionRow[]).map(
    mapCommunitySubmissionRowToDomain
  );
}

export async function fetchProductSuggestionsAdmin(
  client: SupabaseClient | null
): Promise<ProductSuggestion[]> {
  const db = requireSupabaseClient(client, 'fetchProductSuggestionsAdmin');
  const { data, error } = await db
    .from('product_suggestions')
    .select('*')
    .order('created_at', { ascending: false });

  assertNoSupabaseError(error, 'fetchProductSuggestionsAdmin');
  return ((data ?? []) as DbProductSuggestionRow[]).map(
    mapProductSuggestionRowToDomain
  );
}

export async function fetchRecipeRevisionsAdmin(
  client: SupabaseClient | null,
  recipeId?: string
): Promise<RecipeRevision[]> {
  const db = requireSupabaseClient(client, 'fetchRecipeRevisionsAdmin');
  let query = db
    .from('recipe_revisions')
    .select('*, recipes(name)')
    .order('created_at', { ascending: false });

  if (recipeId) {
    query = query.eq('recipe_id', recipeId);
  }

  const { data, error } = await query;
  assertNoSupabaseError(error, 'fetchRecipeRevisionsAdmin');
  return ((data ?? []) as DbRecipeRevisionRow[]).map(mapRecipeRevisionRowToDomain);
}

export async function fetchContactReportsAdmin(
  client: SupabaseClient | null
): Promise<ContactReport[]> {
  const db = requireSupabaseClient(client, 'fetchContactReportsAdmin');
  const { data, error } = await db
    .from('contact_reports')
    .select('*')
    .order('created_at', { ascending: false });

  assertNoSupabaseError(error, 'fetchContactReportsAdmin');
  return ((data ?? []) as DbContactReportRow[]).map(mapContactReportRowToDomain);
}

export async function fetchSecurityEventsAdmin(
  client: SupabaseClient | null,
  limit = 100
): Promise<SecurityEvent[]> {
  const db = requireSupabaseClient(client, 'fetchSecurityEventsAdmin');
  const { data, error } = await db
    .from('security_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  assertNoSupabaseError(error, 'fetchSecurityEventsAdmin');
  return ((data ?? []) as DbSecurityEventRow[]).map(mapSecurityEventRowToDomain);
}

export async function fetchBackupRecordsAdmin(
  client: SupabaseClient | null
): Promise<BackupRecordMetadata[]> {
  const db = requireSupabaseClient(client, 'fetchBackupRecordsAdmin');
  const { data, error } = await db
    .from('backup_records')
    .select('*')
    .order('created_at', { ascending: false });

  assertNoSupabaseError(error, 'fetchBackupRecordsAdmin');
  return ((data ?? []) as DbBackupRecordRow[]).map(mapBackupRecordRowToDomain);
}

export interface AdminBootstrapData {
  recipes: DrinkRecipe[];
  products: ProductCatalogItem[];
  priceHistory: ProductPriceHistoryEntry[];
  recipePriceSnapshots: RecipePriceSnapshot[];
  communitySubmissions: CommunitySubmission[];
  productSuggestions: ProductSuggestion[];
  recipeRevisions: RecipeRevision[];
  contactReports: ContactReport[];
  websiteSettings: WebsiteSettings;
  securityEvents: SecurityEvent[];
  backupRecords: BackupRecordMetadata[];
}

export async function fetchAdminBootstrapData(
  client: SupabaseClient | null
): Promise<AdminBootstrapData> {
  const db = requireSupabaseClient(client, 'fetchAdminBootstrapData');
  const [
    recipes,
    products,
    priceHistory,
    recipePriceSnapshots,
    communitySubmissions,
    productSuggestions,
    recipeRevisions,
    contactReports,
    websiteSettings,
    securityEvents,
    backupRecords,
  ] = await Promise.all([
    fetchAllRecipesAdmin(db),
    fetchAllProductsAdmin(db),
    fetchProductPriceHistoryAdmin(db),
    fetchRecipePriceSnapshotsAdmin(db),
    fetchCommunitySubmissionsAdmin(db),
    fetchProductSuggestionsAdmin(db),
    fetchRecipeRevisionsAdmin(db),
    fetchContactReportsAdmin(db),
    fetchWebsiteSettings(db),
    fetchSecurityEventsAdmin(db),
    fetchBackupRecordsAdmin(db),
  ]);

  return {
    recipes,
    products,
    priceHistory,
    recipePriceSnapshots,
    communitySubmissions,
    productSuggestions,
    recipeRevisions,
    contactReports,
    websiteSettings,
    securityEvents,
    backupRecords,
  };
}

// =============================================================================
// PROTECTED ADMIN WRITES (ENFORCED BY RLS + is_verified_admin() RPCs)
// =============================================================================

export async function touchAdminActivityInDb(
  client: SupabaseClient | null
): Promise<string> {
  const db = requireSupabaseClient(client, 'touchAdminActivityInDb');
  const { data, error } = await db.rpc('touch_admin_activity');
  assertNoSupabaseError(error, 'touchAdminActivityInDb');
  return typeof data === 'string' ? data : new Date().toISOString();
}

export async function upsertProductAdmin(
  client: SupabaseClient | null,
  input: {
    id?: string;
    name: string;
    photoUrl: string;
    purchasePrice: number;
    barcode?: string;
    isArchived: boolean;
  }
): Promise<ProductCatalogItem> {
  const db = requireSupabaseClient(client, 'upsertProductAdmin');
  const nowIso = new Date().toISOString();
  const payload = {
    name: input.name.trim(),
    photo_url: input.photoUrl,
    purchase_price: Number(input.purchasePrice.toFixed(2)),
    barcode: input.barcode?.trim() || null,
    is_archived: input.isArchived,
    last_updated_at: nowIso,
  };

  if (input.id) {
    const { data, error } = await db
      .from('products')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single();

    assertNoSupabaseError(error, 'upsertProductAdmin.update');
    return mapProductRowToDomain(data as DbProductRow);
  }

  const { data, error } = await db
    .from('products')
    .insert(payload)
    .select('*')
    .single();

  assertNoSupabaseError(error, 'upsertProductAdmin.insert');
  return mapProductRowToDomain(data as DbProductRow);
}

export async function setProductArchivedAdmin(
  client: SupabaseClient | null,
  productId: string,
  isArchived: boolean
): Promise<ProductCatalogItem> {
  const db = requireSupabaseClient(client, 'setProductArchivedAdmin');
  const { data, error } = await db
    .from('products')
    .update({
      is_archived: isArchived,
      last_updated_at: new Date().toISOString(),
    })
    .eq('id', productId)
    .select('*')
    .single();

  assertNoSupabaseError(error, 'setProductArchivedAdmin');
  return mapProductRowToDomain(data as DbProductRow);
}

export interface SaveRecipeAdminInput {
  id?: string;
  slug: string;
  name: string;
  category: DrinkCategory;
  status: RecipeStatus;
  photoUrl: string;
  submitterName: string;
  tasteNotes?: string;
  isEditorsPick: boolean;
  isTrending: boolean;
  ingredients: RecipeIngredient[];
  changeSummary?: string;
  actorEmail?: string;
}

export async function saveRecipeWithIngredientsAdmin(
  client: SupabaseClient | null,
  input: SaveRecipeAdminInput
): Promise<{
  recipeId: string;
  slug: string;
  totalPurchaseCost: number | null;
  priceVerified: boolean;
}> {
  const db = requireSupabaseClient(client, 'saveRecipeWithIngredientsAdmin');
  const { data, error } = await db.rpc('save_recipe_with_ingredients', {
    p_recipe_id: input.id ?? null,
    p_slug: input.slug,
    p_name: input.name,
    p_category: input.category,
    p_status: input.status,
    p_photo_url: input.photoUrl,
    p_submitter_name: input.submitterName,
    p_taste_notes: input.tasteNotes ?? null,
    p_is_editors_pick: input.isEditorsPick,
    p_is_trending: input.isTrending,
    p_ingredients: input.ingredients.map((ing) => ({
      product_id: ing.productId,
      product_name_snapshot: ing.productNameSnapshot,
      product_photo_snapshot: ing.productPhotoSnapshot,
      quantity_used: ing.quantityUsed,
      units_to_purchase: ing.unitsToPurchase,
      price_snapshot: ing.priceSnapshot,
      price_verified: ing.priceVerified,
    })),
    p_change_summary: input.changeSummary ?? null,
    p_actor_email: input.actorEmail ?? null,
  });

  assertNoSupabaseError(error, 'saveRecipeWithIngredientsAdmin');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.recipe_id !== 'string') {
    throw new SupabaseRepositoryError(
      'saveRecipeWithIngredientsAdmin',
      'Unexpected response from save_recipe_with_ingredients RPC.'
    );
  }

  return {
    recipeId: row.recipe_id,
    slug: row.slug,
    totalPurchaseCost: parseNullableNumeric(row.total_purchase_cost),
    priceVerified: Boolean(row.price_verified),
  };
}

export async function saveRecipePendingDraftAdmin(
  client: SupabaseClient | null,
  recipeId: string,
  pendingDraft: NonNullable<DrinkRecipe['pendingDraft']> | null
): Promise<void> {
  const db = requireSupabaseClient(client, 'saveRecipePendingDraftAdmin');
  const { error } = await db
    .from('recipes')
    .update({
      pending_draft_json: pendingDraft,
      updated_at: new Date().toISOString(),
    })
    .eq('id', recipeId);

  assertNoSupabaseError(error, 'saveRecipePendingDraftAdmin');
}

export async function verifyRecipeCatalogPricesAdmin(
  client: SupabaseClient | null,
  recipeId: string,
  actorEmail?: string
): Promise<{
  recipeId: string;
  totalPurchaseCost: number | null;
  priceVerified: boolean;
}> {
  const db = requireSupabaseClient(client, 'verifyRecipeCatalogPricesAdmin');
  const { data, error } = await db.rpc('verify_recipe_catalog_prices', {
    p_recipe_id: recipeId,
    p_actor_email: actorEmail ?? null,
  });

  assertNoSupabaseError(error, 'verifyRecipeCatalogPricesAdmin');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.recipe_id !== 'string') {
    throw new SupabaseRepositoryError(
      'verifyRecipeCatalogPricesAdmin',
      'Unexpected response from verify_recipe_catalog_prices RPC.'
    );
  }

  return {
    recipeId: row.recipe_id,
    totalPurchaseCost: parseNullableNumeric(row.total_purchase_cost),
    priceVerified: Boolean(row.price_verified),
  };
}

export async function restoreRecipeRevisionAdmin(
  client: SupabaseClient | null,
  revisionId: string,
  actorEmail?: string
): Promise<{ recipeId: string; newVersionNumber: number }> {
  const db = requireSupabaseClient(client, 'restoreRecipeRevisionAdmin');
  const { data, error } = await db.rpc('restore_recipe_revision', {
    p_revision_id: revisionId,
    p_actor_email: actorEmail ?? null,
  });

  assertNoSupabaseError(error, 'restoreRecipeRevisionAdmin');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.recipe_id !== 'string') {
    throw new SupabaseRepositoryError(
      'restoreRecipeRevisionAdmin',
      'Unexpected response from restore_recipe_revision RPC.'
    );
  }

  return {
    recipeId: row.recipe_id,
    newVersionNumber: Number(row.new_version_number),
  };
}

export async function approveCommunitySubmissionAdmin(
  client: SupabaseClient | null,
  input: {
    submissionId: string;
    name: string;
    slug: string;
    category: DrinkCategory;
    photoUrl: string;
    tasteNotes?: string;
    ingredients: RecipeIngredient[];
    adminNotes?: string;
    actorEmail?: string;
  }
): Promise<{ recipeId: string; slug: string; totalPurchaseCost: number | null }> {
  const db = requireSupabaseClient(client, 'approveCommunitySubmissionAdmin');
  const { data, error } = await db.rpc('approve_community_submission', {
    p_submission_id: input.submissionId,
    p_name: input.name,
    p_slug: input.slug,
    p_category: input.category,
    p_photo_url: input.photoUrl,
    p_taste_notes: input.tasteNotes ?? null,
    p_ingredients: input.ingredients.map((ing) => ({
      product_id: ing.productId,
      product_name_snapshot: ing.productNameSnapshot,
      product_photo_snapshot: ing.productPhotoSnapshot,
      quantity_used: ing.quantityUsed,
      units_to_purchase: ing.unitsToPurchase,
      price_snapshot: ing.priceSnapshot,
      price_verified: ing.priceVerified,
    })),
    p_admin_notes: input.adminNotes ?? null,
    p_actor_email: input.actorEmail ?? null,
  });

  assertNoSupabaseError(error, 'approveCommunitySubmissionAdmin');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.recipe_id !== 'string') {
    throw new SupabaseRepositoryError(
      'approveCommunitySubmissionAdmin',
      'Unexpected response from approve_community_submission RPC.'
    );
  }

  return {
    recipeId: row.recipe_id,
    slug: row.slug,
    totalPurchaseCost: parseNullableNumeric(row.total_purchase_cost),
  };
}

export async function rejectCommunitySubmissionAdmin(
  client: SupabaseClient | null,
  submissionId: string,
  adminReviewNotes: string
): Promise<void> {
  const db = requireSupabaseClient(client, 'rejectCommunitySubmissionAdmin');
  const { error } = await db
    .from('community_submissions')
    .update({
      status: 'Rejected',
      admin_review_notes:
        adminReviewNotes.trim() || 'Submission rejected during editorial review.',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', submissionId);

  assertNoSupabaseError(error, 'rejectCommunitySubmissionAdmin');
}

export async function updateContactReportStatusAdmin(
  client: SupabaseClient | null,
  reportId: string,
  status: ContactReport['status'],
  adminNotes?: string
): Promise<ContactReport> {
  const db = requireSupabaseClient(client, 'updateContactReportStatusAdmin');
  const patch: Record<string, unknown> = { status };
  if (adminNotes !== undefined) {
    patch.admin_notes = adminNotes;
  }
  if (status === 'Resolved') {
    patch.resolved_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from('contact_reports')
    .update(patch)
    .eq('id', reportId)
    .select('*')
    .single();

  assertNoSupabaseError(error, 'updateContactReportStatusAdmin');
  return mapContactReportRowToDomain(data as DbContactReportRow);
}

export async function updateWebsiteSettingsAdmin(
  client: SupabaseClient | null,
  partial: Partial<Omit<WebsiteSettings, 'updatedAt'>>
): Promise<WebsiteSettings> {
  const db = requireSupabaseClient(client, 'updateWebsiteSettingsAdmin');
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (partial.maintenanceMode !== undefined) {
    patch.maintenance_mode = partial.maintenanceMode;
  }
  if (partial.maintenanceTitle !== undefined) {
    patch.maintenance_title = partial.maintenanceTitle;
  }
  if (partial.maintenanceMessage !== undefined) {
    patch.maintenance_message = partial.maintenanceMessage;
  }
  if (partial.sessionTimeoutMinutes !== undefined) {
    patch.session_timeout_minutes = partial.sessionTimeoutMinutes;
  }
  if (partial.requireAdminOtp !== undefined) {
    patch.require_admin_otp = partial.requireAdminOtp;
  }

  const { data, error } = await db
    .from('website_settings')
    .update(patch)
    .eq('id', 1)
    .select('*')
    .single();

  assertNoSupabaseError(error, 'updateWebsiteSettingsAdmin');
  return mapWebsiteSettingsRowToDomain(data as DbWebsiteSettingsRow);
}

export async function recordBackupMetadataAdmin(
  client: SupabaseClient | null,
  input: {
    backupFilename: string;
    recordCounts: Record<string, number>;
    includesStorageManifest: boolean;
    checksum: string;
    createdBy?: string | null;
  }
): Promise<BackupRecordMetadata> {
  const db = requireSupabaseClient(client, 'recordBackupMetadataAdmin');
  const { data, error } = await db
    .from('backup_records')
    .insert({
      backup_filename: input.backupFilename,
      record_counts: input.recordCounts,
      includes_storage_manifest: input.includesStorageManifest,
      checksum: input.checksum,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single();

  assertNoSupabaseError(error, 'recordBackupMetadataAdmin');
  return mapBackupRecordRowToDomain(data as DbBackupRecordRow);
}

export async function recordSecurityEventAdmin(
  client: SupabaseClient | null,
  input: {
    eventType: SecurityEvent['eventType'];
    actor: string;
    details: string;
    ipHash?: string | null;
  }
): Promise<SecurityEvent> {
  const db = requireSupabaseClient(client, 'recordSecurityEventAdmin');
  const { data, error } = await db
    .from('security_events')
    .insert({
      event_type: input.eventType,
      actor: input.actor,
      details: input.details,
      ip_hash: input.ipHash ?? null,
    })
    .select('*')
    .single();

  assertNoSupabaseError(error, 'recordSecurityEventAdmin');
  return mapSecurityEventRowToDomain(data as DbSecurityEventRow);
}
