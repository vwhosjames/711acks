export type DrinkCategory = 'Coffee Mixes' | 'Chocolate-Based' | 'Fruity & Soda';

export const APPROVED_CATEGORIES: DrinkCategory[] = [
  'Coffee Mixes',
  'Chocolate-Based',
  'Fruity & Soda',
];

export type RecipeStatus = 'Draft' | 'Pending' | 'Published' | 'Rejected' | 'Archived';

export type SortOption = 'newest' | 'popular' | 'price_asc' | 'price_desc';

export type ReportCategory =
  | 'Incorrect Recipe Information'
  | 'Incorrect or Outdated Product Price'
  | 'Website Problem'
  | 'General Feedback'
  | 'Other';

export const REPORT_CATEGORIES: ReportCategory[] = [
  'Incorrect Recipe Information',
  'Incorrect or Outdated Product Price',
  'Website Problem',
  'General Feedback',
  'Other',
];

export interface ProductCatalogItem {
  id: string;
  name: string;
  photoUrl: string;
  purchasePrice: number;
  barcode?: string;
  isArchived: boolean;
  lastUpdatedAt: string;
  isDemoRecord?: boolean;
}

export interface ProductPriceHistoryEntry {
  id: string;
  productId: string;
  productName: string;
  previousPrice: number;
  newPrice: number;
  changedAt: string;
}

export interface RecipeIngredient {
  id: string;
  productId: string | null;
  productNameSnapshot: string;
  productPhotoSnapshot: string;
  quantityUsed: string; // e.g., "1 bottle (240ml)" or "Half pack (100ml used)"
  unitsToPurchase: number; // Full whole units visitor must buy at 7-Eleven
  priceSnapshot: number | null; // Unit price snapshot at time of verification
  priceVerified: boolean;
}

export interface DrinkRecipe {
  id: string;
  slug: string;
  name: string;
  category: DrinkCategory;
  status: RecipeStatus;
  photoUrl: string;
  submitterName: string;
  tasteNotes?: string;
  ingredients: RecipeIngredient[];
  totalPurchaseCost: number | null;
  priceVerified: boolean;
  needsPriceReview: boolean;
  lastPriceVerifiedAt: string | null;
  isEditorsPick: boolean;
  isTrending: boolean;
  likesCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isDemoRecord?: boolean;
  pendingDraft?: {
    name: string;
    category: DrinkCategory;
    tasteNotes?: string;
    photoUrl: string;
    ingredients: RecipeIngredient[];
    savedAt: string;
  } | null;
}

export interface CommunitySubmissionIngredient {
  id: string;
  productId: string | null;
  suggestedProductName?: string;
  suggestedProductPrice?: number | null;
  suggestedProductPhotoUrl?: string;
  quantityUsed: string;
  unitsToPurchase: number;
}

export interface CommunitySubmission {
  id: string;
  drinkName: string;
  category: DrinkCategory;
  submitterName: string;
  tasteNotes?: string;
  finishedPhotoUrl?: string;
  ingredients: CommunitySubmissionIngredient[];
  status: 'Pending' | 'Published' | 'Rejected';
  duplicateWarningNotes?: string;
  adminReviewNotes?: string;
  submittedAt: string;
  reviewedAt?: string;
}

export interface ProductSuggestion {
  id: string;
  submissionId: string;
  suggestedName: string;
  suggestedPrice: number | null;
  photoUrl?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
}

export interface RecipeRevision {
  id: string;
  recipeId: string;
  recipeName: string;
  versionNumber: number;
  changedFields: string[];
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changeSummary: string;
  restoredFromRevisionId?: string;
  createdBy: string;
  createdAt: string;
}

export interface ContactReport {
  id: string;
  reporterName?: string;
  reporterEmail?: string;
  category: ReportCategory;
  message: string;
  relatedRecipeSlug?: string;
  status: 'Open' | 'In Review' | 'Resolved' | 'Archived';
  adminNotes?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface WebsiteSettings {
  maintenanceMode: boolean;
  maintenanceTitle: string;
  maintenanceMessage: string;
  sessionTimeoutMinutes: number;
  requireAdminOtp: boolean;
  updatedAt: string;
}

export interface SecurityEvent {
  id: string;
  eventType:
    | 'ADMIN_PASSWORD_VERIFIED'
    | 'ADMIN_LOGIN_FAILED'
    | 'ADMIN_LOCKOUT_TRIGGERED'
    | 'ADMIN_OTP_ISSUED'
    | 'ADMIN_OTP_VERIFIED'
    | 'ADMIN_OTP_FAILED'
    | 'ADMIN_SESSION_TIMEOUT'
    | 'ADMIN_LOGOUT'
    | 'MAINTENANCE_MODE_CHANGED'
    | 'BACKUP_EXPORTED'
    | 'BACKUP_RESTORED';
  actor: string;
  details: string;
  createdAt: string;
}

export interface RecipePriceSnapshotIngredient {
  productId: string | null;
  productNameSnapshot: string;
  quantityUsed: string;
  unitsToPurchase: number;
  priceSnapshot: number;
  lineTotal: number;
}

export interface RecipePriceSnapshot {
  id: string;
  recipeId: string;
  totalPurchaseCost: number;
  ingredientBreakdown: RecipePriceSnapshotIngredient[];
  verifiedBy: string | null;
  verifiedAt: string;
}

export interface BackupRecordMetadata {
  id: string;
  backupFilename: string;
  recordCounts: Record<string, number>;
  includesStorageManifest: boolean;
  checksum: string;
  createdBy: string | null;
  createdAt: string;
}

export interface BackupPackage {
  schemaVersion: '711acks-v1.0';
  exportedAt: string;
  checksum: string;
  storageAssetManifest: {
    totalAssets: number;
    publishedDrinkImages: string[];
    verifiedProductPhotos: string[];
    pendingSubmissionImages: string[];
  };
  data: {
    products: ProductCatalogItem[];
    productPriceHistory: ProductPriceHistoryEntry[];
    recipes: DrinkRecipe[];
    communitySubmissions: CommunitySubmission[];
    productSuggestions: ProductSuggestion[];
    recipeRevisions: RecipeRevision[];
    contactReports: ContactReport[];
    likesMap: Record<string, string[]>;
    websiteSettings: WebsiteSettings;
  };
}
