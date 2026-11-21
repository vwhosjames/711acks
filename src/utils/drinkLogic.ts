import {
  APPROVED_CATEGORIES,
  BackupPackage,
  DrinkCategory,
  DrinkRecipe,
  RecipeIngredient,
  SortOption,
} from '../types/domain';

export interface PurchaseCostCalculationResult {
  totalPurchaseCost: number | null;
  allPricesVerified: boolean;
  unverifiedCount: number;
  missingPriceIngredients: string[];
}

/**
 * Section 8 Requirement:
 * IMPORTANT: Use FULL PRODUCT PURCHASE COST.
 * Do not calculate the price based on the fraction or amount consumed.
 * Formula: Total Purchase Cost = Sum of (Product Purchase Price * Number of Units to Purchase)
 * If one or more ingredient prices are missing or unverified, do not display a misleading confirmed total.
 */
export function calculateFullPurchaseCost(
  ingredients: Pick<
    RecipeIngredient,
    'productNameSnapshot' | 'unitsToPurchase' | 'priceSnapshot' | 'priceVerified'
  >[]
): PurchaseCostCalculationResult {
  if (!ingredients || ingredients.length === 0) {
    return {
      totalPurchaseCost: null,
      allPricesVerified: false,
      unverifiedCount: 0,
      missingPriceIngredients: [],
    };
  }

  const missingPriceIngredients: string[] = [];
  let sum = 0;

  for (const ing of ingredients) {
    const units = Math.max(1, Math.floor(Number(ing.unitsToPurchase) || 1));
    const hasValidPrice =
      ing.priceVerified &&
      typeof ing.priceSnapshot === 'number' &&
      !Number.isNaN(ing.priceSnapshot) &&
      ing.priceSnapshot >= 0;

    if (!hasValidPrice) {
      missingPriceIngredients.push(ing.productNameSnapshot || 'Unnamed Ingredient');
    } else {
      sum += ing.priceSnapshot! * units;
    }
  }

  const allPricesVerified = missingPriceIngredients.length === 0;

  return {
    totalPurchaseCost: allPricesVerified ? Number(sum.toFixed(2)) : null,
    allPricesVerified,
    unverifiedCount: missingPriceIngredients.length,
    missingPriceIngredients,
  };
}

/**
 * Formats Philippine Peso currency with tabular precision
 */
export function formatPhpCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return 'Price Pending Verification';
  }
  return `₱${amount.toFixed(2)}`;
}

/**
 * Validates that a category is strictly one of the 3 approved categories
 */
export function isApprovedCategory(category: string): category is DrinkCategory {
  return (APPROVED_CATEGORIES as string[]).includes(category);
}

/**
 * Generates URL-friendly unique slug for drink details pages (/drinks/example-drink-slug)
 */
export function generateDrinkSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface ResolveUniqueSlugOptions {
  editingRecipeId?: string;
  explicitSlug?: string;
  fallbackPrefix?: string;
}

export interface ResolveUniqueSlugResult {
  success: boolean;
  slug?: string;
  error?: string;
}

/**
 * Deterministically resolves a unique URL slug for a recipe:
 * - Editing an existing Published recipe (or already-published recipe) ALWAYS
 *   preserves its existing slug so public URLs and QR codes never break.
 * - Editing a Draft/Pending/Archived recipe preserves its existing slug by default;
 *   if an explicit different slug is supplied and owned by another recipe, returns
 *   an explicit collision error instead of silently overwriting another recipe.
 * - Creating a new recipe allocates `base`, `base-2`, `base-3`, ... deterministically.
 */
export function resolveUniqueRecipeSlug(
  candidateName: string,
  existingRecipes: Pick<DrinkRecipe, 'id' | 'slug' | 'status' | 'publishedAt'>[],
  options: ResolveUniqueSlugOptions = {}
): ResolveUniqueSlugResult {
  const {
    editingRecipeId,
    explicitSlug,
    fallbackPrefix = 'drink-recipe',
  } = options;

  const existingTarget = editingRecipeId
    ? existingRecipes.find((r) => r.id === editingRecipeId)
    : undefined;

  if (existingTarget) {
    // Preserve stable public URLs for published recipes
    if (
      existingTarget.status === 'Published' ||
      existingTarget.publishedAt !== null
    ) {
      return { success: true, slug: existingTarget.slug };
    }

    const requestedSlug = explicitSlug ? generateDrinkSlug(explicitSlug) : '';
    if (!requestedSlug || requestedSlug === existingTarget.slug) {
      return { success: true, slug: existingTarget.slug };
    }

    const ownedByOther = existingRecipes.some(
      (r) => r.id !== existingTarget.id && r.slug === requestedSlug
    );
    if (ownedByOther) {
      return {
        success: false,
        error: `Slug "${requestedSlug}" is already assigned to another recipe.`,
      };
    }

    return { success: true, slug: requestedSlug };
  }

  const baseCandidate = generateDrinkSlug(explicitSlug || candidateName);
  const baseSlug =
    baseCandidate.length >= 2 ? baseCandidate : generateDrinkSlug(fallbackPrefix) || 'drink-recipe';

  const takenSlugs = new Set(existingRecipes.map((r) => r.slug));
  if (!takenSlugs.has(baseSlug)) {
    return { success: true, slug: baseSlug };
  }

  for (let suffix = 2; suffix <= 1000; suffix++) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!takenSlugs.has(candidate)) {
      return { success: true, slug: candidate };
    }
  }

  return {
    success: false,
    error: `Unable to allocate a unique recipe slug for "${baseSlug}".`,
  };
}

/**
 * Normalizes string tokens for duplicate detection
 */
function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTokenSet(input: string): Set<string> {
  const stopWords = new Set(['the', 'and', 'with', 'hack', 'drink', 'iced', 'mix', '711', 'seven', 'eleven']);
  const tokens = normalizeText(input)
    .split(' ')
    .filter((t) => t.length > 2 && !stopWords.has(t));
  return new Set(tokens);
}

export interface DuplicateMatchWarning {
  recipeId: string;
  recipeName: string;
  recipeSlug: string;
  similarityScore: number;
  reasons: string[];
}

/**
 * Section 12 Requirement:
 * Automatic duplicate detection checking:
 * - Similar drink names
 * - Matching ingredient combinations
 * - Similar product selections
 */
export function detectDuplicateRecipes(
  candidateName: string,
  candidateProductIds: (string | null)[],
  candidateIngredientNames: string[],
  existingRecipes: DrinkRecipe[]
): DuplicateMatchWarning[] {
  const warnings: DuplicateMatchWarning[] = [];
  const candidateNameNorm = normalizeText(candidateName);
  const candidateTokens = getTokenSet(candidateName);
  const validCandidateProductIds = new Set(
    candidateProductIds.filter((id): id is string => Boolean(id))
  );
  const candidateIngTokens = new Set(
    candidateIngredientNames.flatMap((name) => Array.from(getTokenSet(name)))
  );

  for (const recipe of existingRecipes) {
    if (recipe.status === 'Rejected' || recipe.status === 'Archived') continue;

    const reasons: string[] = [];
    let score = 0;

    // 1. Check similar drink names
    const existingNameNorm = normalizeText(recipe.name);
    if (
      candidateNameNorm.length >= 3 &&
      (existingNameNorm === candidateNameNorm ||
        existingNameNorm.includes(candidateNameNorm) ||
        candidateNameNorm.includes(existingNameNorm))
    ) {
      score += 0.6;
      reasons.push(`Similar drink name to "${recipe.name}"`);
    } else if (candidateTokens.size > 0) {
      const existingTokens = getTokenSet(recipe.name);
      let sharedNameTokens = 0;
      for (const token of candidateTokens) {
        if (existingTokens.has(token)) sharedNameTokens++;
      }
      const nameOverlap =
        sharedNameTokens / Math.max(candidateTokens.size, existingTokens.size, 1);
      if (nameOverlap >= 0.5) {
        score += 0.45;
        reasons.push(`Overlapping keywords with "${recipe.name}"`);
      }
    }

    // 2. Check matching product catalog selections
    const existingProductIds = new Set(
      recipe.ingredients
        .map((i) => i.productId)
        .filter((id): id is string => Boolean(id))
    );

    if (validCandidateProductIds.size > 0 && existingProductIds.size > 0) {
      let sharedProducts = 0;
      for (const pid of validCandidateProductIds) {
        if (existingProductIds.has(pid)) sharedProducts++;
      }
      const unionSize = new Set([...validCandidateProductIds, ...existingProductIds]).size;
      const jaccard = sharedProducts / Math.max(unionSize, 1);

      if (sharedProducts === existingProductIds.size && sharedProducts === validCandidateProductIds.size) {
        score += 0.7;
        reasons.push('Exact same 7-Eleven product combination');
      } else if (jaccard >= 0.6 || sharedProducts >= 2) {
        score += 0.45;
        reasons.push(`Shares ${sharedProducts} catalog product(s) with "${recipe.name}"`);
      }
    }

    // 3. Check ingredient name overlap (for custom suggested products)
    const existingIngTokens = new Set(
      recipe.ingredients.flatMap((i) => Array.from(getTokenSet(i.productNameSnapshot)))
    );
    if (candidateIngTokens.size > 0 && existingIngTokens.size > 0) {
      let sharedIngWords = 0;
      for (const w of candidateIngTokens) {
        if (existingIngTokens.has(w)) sharedIngWords++;
      }
      const ratio = sharedIngWords / Math.max(candidateIngTokens.size, existingIngTokens.size, 1);
      if (ratio >= 0.65 && reasons.length === 0) {
        score += 0.4;
        reasons.push('Highly similar ingredient keywords');
      }
    }

    if (score >= 0.45 && reasons.length > 0) {
      warnings.push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        recipeSlug: recipe.slug,
        similarityScore: Math.min(1, Number(score.toFixed(2))),
        reasons,
      });
    }
  }

  return warnings.sort((a, b) => b.similarityScore - a.similarityScore);
}

/**
 * Section 7 Requirement:
 * Filter and sort published recipes by search query (drink name or ingredient/product name),
 * primary category, and sort order.
 */
export function filterAndSortRecipes(
  recipes: DrinkRecipe[],
  options: {
    searchQuery?: string;
    category?: DrinkCategory | 'ALL';
    sortBy?: SortOption;
    onlyPublished?: boolean;
  }
): DrinkRecipe[] {
  const {
    searchQuery = '',
    category = 'ALL',
    sortBy = 'newest',
    onlyPublished = true,
  } = options;

  const query = searchQuery.trim().toLowerCase();

  const filtered = recipes.filter((recipe) => {
    if (onlyPublished && recipe.status !== 'Published') {
      return false;
    }
    if (category !== 'ALL' && recipe.category !== category) {
      return false;
    }
    if (query.length > 0) {
      const matchesName = recipe.name.toLowerCase().includes(query);
      const matchesIngredient = recipe.ingredients.some((ing) =>
        ing.productNameSnapshot.toLowerCase().includes(query)
      );
      const matchesNotes = recipe.tasteNotes?.toLowerCase().includes(query) ?? false;
      if (!matchesName && !matchesIngredient && !matchesNotes) {
        return false;
      }
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (sortBy === 'popular') {
      if (b.likesCount !== a.likesCount) return b.likesCount - a.likesCount;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    if (sortBy === 'price_asc') {
      const priceA = a.priceVerified && a.totalPurchaseCost !== null ? a.totalPurchaseCost : Number.MAX_SAFE_INTEGER;
      const priceB = b.priceVerified && b.totalPurchaseCost !== null ? b.totalPurchaseCost : Number.MAX_SAFE_INTEGER;
      return priceA - priceB;
    }
    if (sortBy === 'price_desc') {
      const priceA = a.priceVerified && a.totalPurchaseCost !== null ? a.totalPurchaseCost : -1;
      const priceB = b.priceVerified && b.totalPurchaseCost !== null ? b.totalPurchaseCost : -1;
      return priceB - priceA;
    }
    // Default: newest
    const dateA = new Date(a.publishedAt || a.createdAt).getTime();
    const dateB = new Date(b.publishedAt || b.createdAt).getTime();
    return dateB - dateA;
  });
}

/**
 * Section 15 Requirement:
 * When a Product Catalog price changes, mark affected recipes for price review
 * without silently rewriting their previously verified historical purchase cost!
 */
export function applyProductCatalogPriceUpdate(
  recipes: DrinkRecipe[],
  productId: string,
  newPrice: number
): {
  updatedRecipes: DrinkRecipe[];
  flaggedRecipeIds: string[];
} {
  const flaggedRecipeIds: string[] = [];

  const updatedRecipes = recipes.map((recipe) => {
    const usesProduct = recipe.ingredients.some((ing) => ing.productId === productId);
    if (!usesProduct) return recipe;

    const hadDifferentSnapshot = recipe.ingredients.some(
      (ing) => ing.productId === productId && ing.priceSnapshot !== newPrice
    );

    if (!hadDifferentSnapshot) return recipe;

    flaggedRecipeIds.push(recipe.id);
    // Notice we DO NOT overwrite recipe.totalPurchaseCost or ingredient.priceSnapshot!
    // We only mark needsPriceReview = true so the admin can review and confirm.
    return {
      ...recipe,
      needsPriceReview: true,
      updatedAt: new Date().toISOString(),
    };
  });

  return { updatedRecipes, flaggedRecipeIds };
}

/**
 * Validates barcode format (EAN-8, UPC-A 12, or EAN-13 numeric strings) and uniqueness
 */
export function validateBarcode(
  barcode: string | undefined,
  existingBarcodes: string[]
): { valid: boolean; error?: string } {
  if (!barcode || barcode.trim() === '') {
    return { valid: true };
  }
  const clean = barcode.trim();
  if (!/^\d{8,14}$/.test(clean)) {
    return {
      valid: false,
      error: 'Barcode must be an 8 to 14-digit numeric EAN/UPC code.',
    };
  }
  if (existingBarcodes.includes(clean)) {
    return {
      valid: false,
      error: 'This barcode is already assigned to another product in the catalog.',
    };
  }
  return { valid: true };
}

/**
 * Validates backup package structure before destructive restoration (Section 20)
 */
export function validateBackupPackage(payload: unknown): {
  valid: boolean;
  error?: string;
  parsed?: BackupPackage;
} {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Backup file is not a valid JSON object.' };
  }
  const candidate = payload as Partial<BackupPackage>;
  if (candidate.schemaVersion !== '711acks-v1.0') {
    return {
      valid: false,
      error: `Unsupported or missing backup schemaVersion. Expected "711acks-v1.0".`,
    };
  }
  if (!candidate.storageAssetManifest || typeof candidate.storageAssetManifest.totalAssets !== 'number') {
    return {
      valid: false,
      error: 'Backup is incomplete: missing storageAssetManifest for uploaded images.',
    };
  }
  if (
    !candidate.data ||
    !Array.isArray(candidate.data.products) ||
    !Array.isArray(candidate.data.recipes) ||
    !Array.isArray(candidate.data.communitySubmissions) ||
    !Array.isArray(candidate.data.recipeRevisions) ||
    !Array.isArray(candidate.data.contactReports)
  ) {
    return {
      valid: false,
      error: 'Backup data payload is missing required relational collections.',
    };
  }
  return { valid: true, parsed: candidate as BackupPackage };
}
