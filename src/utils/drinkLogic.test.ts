import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProductCatalogPriceUpdate,
  calculateFullPurchaseCost,
  detectDuplicateRecipes,
  filterAndSortRecipes,
  formatPhpCurrency,
  isApprovedCategory,
  validateBackupPackage,
  validateBarcode,
} from './drinkLogic';
import { DrinkRecipe } from '../types/domain';

test('Full product purchase cost charges whole units rather than fractional amounts used', () => {
  // Example: uses only half a bottle of ₱45 coffee + 2 packs of ₱15 Milo
  const result = calculateFullPurchaseCost([
    {
      productNameSnapshot: 'Kopiko Lucky Day Iced Coffee 180ml',
      unitsToPurchase: 1, // Even if recipe uses 1/2 bottle, visitor must purchase 1 bottle
      priceSnapshot: 29.0,
      priceVerified: true,
    },
    {
      productNameSnapshot: 'Nestlé Chuckie Calci-N 250ml',
      unitsToPurchase: 1,
      priceSnapshot: 36.0,
      priceVerified: true,
    },
    {
      productNameSnapshot: '7-Eleven Cup with Ice',
      unitsToPurchase: 1,
      priceSnapshot: 15.0,
      priceVerified: true,
    },
  ]);

  assert.equal(result.allPricesVerified, true);
  assert.equal(result.totalPurchaseCost, 80.0);
  assert.equal(result.unverifiedCount, 0);
});

test('Missing or unverified ingredient price prevents displaying a misleading confirmed total', () => {
  const result = calculateFullPurchaseCost([
    {
      productNameSnapshot: '7-Eleven Bottled Coffee',
      unitsToPurchase: 1,
      priceSnapshot: 45.0,
      priceVerified: true,
    },
    {
      productNameSnapshot: 'New Suggested Syrup',
      unitsToPurchase: 1,
      priceSnapshot: null,
      priceVerified: false,
    },
  ]);

  assert.equal(result.allPricesVerified, false);
  assert.equal(result.totalPurchaseCost, null);
  assert.equal(result.unverifiedCount, 1);
  assert.deepEqual(result.missingPriceIngredients, ['New Suggested Syrup']);
  assert.equal(formatPhpCurrency(result.totalPurchaseCost), 'Price Pending Verification');
});

test('Approved categories strictly allow only Coffee Mixes, Chocolate-Based, and Fruity & Soda', () => {
  assert.equal(isApprovedCategory('Coffee Mixes'), true);
  assert.equal(isApprovedCategory('Chocolate-Based'), true);
  assert.equal(isApprovedCategory('Fruity & Soda'), true);
  assert.equal(isApprovedCategory('Matcha & Tea'), false);
  assert.equal(isApprovedCategory('Milk-Based'), false);
});

const sampleRecipes: DrinkRecipe[] = [
  {
    id: 'rec-1',
    slug: 'kopiko-chuckie-dirty-mocha',
    name: 'Kopiko Chuckie Dirty Mocha',
    category: 'Coffee Mixes',
    status: 'Published',
    photoUrl: '/demo1.jpg',
    submitterName: 'Marco P.',
    ingredients: [
      {
        id: 'ing-1',
        productId: 'prod-kopiko',
        productNameSnapshot: 'Kopiko Lucky Day 180ml',
        productPhotoSnapshot: '/kopiko.svg',
        quantityUsed: '1 bottle (180ml)',
        unitsToPurchase: 1,
        priceSnapshot: 29,
        priceVerified: true,
      },
      {
        id: 'ing-2',
        productId: 'prod-chuckie',
        productNameSnapshot: 'Nestlé Chuckie 250ml',
        productPhotoSnapshot: '/chuckie.svg',
        quantityUsed: 'Half pack (125ml)',
        unitsToPurchase: 1,
        priceSnapshot: 36,
        priceVerified: true,
      },
    ],
    totalPurchaseCost: 65,
    priceVerified: true,
    needsPriceReview: false,
    lastPriceVerifiedAt: '2026-11-15T00:00:00Z',
    isEditorsPick: true,
    isTrending: true,
    likesCount: 42,
    publishedAt: '2026-11-10T00:00:00Z',
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
  },
  {
    id: 'rec-2',
    slug: 'mogu-yakult-pink-fizz',
    name: 'Mogu Yakult Pink Fizz',
    category: 'Fruity & Soda',
    status: 'Published',
    photoUrl: '/demo2.jpg',
    submitterName: 'Bea L.',
    ingredients: [
      {
        id: 'ing-3',
        productId: 'prod-mogu',
        productNameSnapshot: 'Mogu Mogu Lychee 320ml',
        productPhotoSnapshot: '/mogu.svg',
        quantityUsed: '1 bottle',
        unitsToPurchase: 1,
        priceSnapshot: 52,
        priceVerified: true,
      },
    ],
    totalPurchaseCost: 52,
    priceVerified: true,
    needsPriceReview: false,
    lastPriceVerifiedAt: '2026-11-16T00:00:00Z',
    isEditorsPick: false,
    isTrending: true,
    likesCount: 88,
    publishedAt: '2026-11-16T00:00:00Z',
    createdAt: '2026-11-16T00:00:00Z',
    updatedAt: '2026-11-16T00:00:00Z',
  },
];

test('Product catalog price change marks affected recipes for review without altering historical totalPurchaseCost', () => {
  const { updatedRecipes, flaggedRecipeIds } = applyProductCatalogPriceUpdate(
    sampleRecipes,
    'prod-kopiko',
    34 // Price increased from ₱29 to ₱34
  );

  assert.deepEqual(flaggedRecipeIds, ['rec-1']);
  const updatedRec1 = updatedRecipes.find((r) => r.id === 'rec-1')!;
  // Historical verified total must remain 65 until admin reviews and updates!
  assert.equal(updatedRec1.totalPurchaseCost, 65);
  assert.equal(updatedRec1.ingredients[0].priceSnapshot, 29);
  assert.equal(updatedRec1.needsPriceReview, true);

  // Unaffected recipe stays untouched
  const updatedRec2 = updatedRecipes.find((r) => r.id === 'rec-2')!;
  assert.equal(updatedRec2.needsPriceReview, false);
});

test('Duplicate detection warns when a submission matches existing product combinations or drink names', () => {
  const warnings = detectDuplicateRecipes(
    'Dirty Mocha Kopiko Chuckie',
    ['prod-kopiko', 'prod-chuckie'],
    ['Kopiko Lucky Day 180ml', 'Nestlé Chuckie 250ml'],
    sampleRecipes
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].recipeId, 'rec-1');
  assert.ok(warnings[0].similarityScore >= 0.7);
});

test('Explore filtering searches by ingredient name and sorts by lowest price', () => {
  const byIngredient = filterAndSortRecipes(sampleRecipes, {
    searchQuery: 'lychee',
  });
  assert.equal(byIngredient.length, 1);
  assert.equal(byIngredient[0].id, 'rec-2');

  const sortedLowestPrice = filterAndSortRecipes(sampleRecipes, {
    sortBy: 'price_asc',
  });
  assert.equal(sortedLowestPrice[0].id, 'rec-2'); // ₱52 before ₱65
  assert.equal(sortedLowestPrice[1].id, 'rec-1');
});

test('Barcode validation enforces numeric EAN/UPC format and uniqueness', () => {
  assert.equal(validateBarcode('4800361390804', ['4800011122233']).valid, true);
  assert.equal(validateBarcode('4800361390804', ['4800361390804']).valid, false);
  assert.equal(validateBarcode('ABC-123', []).valid, false);
});

test('Backup validation rejects backups without storageAssetManifest', () => {
  const invalid = validateBackupPackage({
    schemaVersion: '711acks-v1.0',
    data: {},
  });
  assert.equal(invalid.valid, false);
});
