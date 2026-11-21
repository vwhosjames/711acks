import {
  CommunitySubmission,
  ContactReport,
  DrinkRecipe,
  ProductCatalogItem,
  ProductPriceHistoryEntry,
  ProductSuggestion,
  RecipeRevision,
  SecurityEvent,
  WebsiteSettings,
} from '../types/domain';

function createProductPhotoDataUrl(opts: {
  brand: string;
  title: string;
  subtitle: string;
  volume: string;
  bgPrimary: string;
  bgSecondary: string;
  accentColor: string;
  containerType: 'bottle' | 'carton' | 'can' | 'cup';
}): string {
  const { brand, title, subtitle, volume, bgPrimary, bgSecondary, accentColor, containerType } = opts;

  let shapeSvg = '';
  if (containerType === 'bottle') {
    shapeSvg = `
      <rect x="170" y="52" width="60" height="24" rx="4" fill="${accentColor}" />
      <rect x="164" y="76" width="72" height="14" rx="3" fill="#2A2A2A" />
      <path d="M166 90 L234 90 L256 145 L256 335 C256 348 245 356 232 356 L168 356 C155 356 144 348 144 335 L144 145 Z" fill="url(#pkgGrad)" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
      <rect x="145" y="155" width="110" height="135" fill="rgba(15,20,17,0.75)" />
    `;
  } else if (containerType === 'carton') {
    shapeSvg = `
      <rect x="192" y="55" width="16" height="32" rx="3" fill="${accentColor}" transform="rotate(12 200 55)" />
      <path d="M148 92 L252 92 L264 125 L136 125 Z" fill="${bgSecondary}" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <rect x="136" y="125" width="128" height="225" rx="6" fill="url(#pkgGrad)" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
      <rect x="137" y="160" width="126" height="125" fill="rgba(15,20,17,0.72)" />
    `;
  } else if (containerType === 'can') {
    shapeSvg = `
      <ellipse cx="200" cy="88" rx="56" ry="10" fill="#D4D4D8" />
      <rect x="144" y="88" width="112" height="255" rx="14" fill="url(#pkgGrad)" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
      <rect x="145" y="148" width="110" height="130" fill="rgba(15,20,17,0.75)" />
      <ellipse cx="200" cy="343" rx="52" ry="8" fill="#A1A1AA" />
    `;
  } else {
    shapeSvg = `
      <path d="M134 86 L266 86 L274 102 L126 102 Z" fill="#F5F3EC" />
      <path d="M138 102 L262 102 L244 348 C243 355 236 360 228 360 L172 360 C164 360 157 355 156 348 Z" fill="url(#pkgGrad)" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
      <rect x="148" y="162" width="104" height="118" rx="4" fill="rgba(15,20,17,0.78)" />
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#17201B"/>
        <stop offset="100%" stop-color="#0E1411"/>
      </linearGradient>
      <linearGradient id="pkgGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bgPrimary}"/>
        <stop offset="100%" stop-color="${bgSecondary}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="400" height="400" fill="url(#bg)"/>
    <circle cx="200" cy="210" r="160" fill="url(#glow)"/>
    <ellipse cx="200" cy="364" rx="75" ry="12" fill="rgba(0,0,0,0.55)"/>
    ${shapeSvg}
    <text x="200" y="188" text-anchor="middle" fill="${accentColor}" font-family="sans-serif" font-size="11" font-weight="700" letter-spacing="2">${brand}</text>
    <text x="200" y="216" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="16" font-weight="700">${title}</text>
    <text x="200" y="238" text-anchor="middle" fill="#C9C5B8" font-family="sans-serif" font-size="11">${subtitle}</text>
    <text x="200" y="272" text-anchor="middle" fill="${accentColor}" font-family="monospace" font-size="11" font-weight="600">${volume}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * NOTE ON DEMO DATA vs VERIFIED DATA (Rule 6, 7 & 8):
 * Each initial catalog record is explicitly marked `isDemoRecord: true` and uses realistic
 * Philippine Peso reference values so the portfolio app works out-of-the-box before Supabase
 * credentials are connected. The UI clearly labels Demo Snapshot vs Live Supabase records.
 */
export const INITIAL_PRODUCT_CATALOG: ProductCatalogItem[] = [
  {
    id: 'prod-kopiko-lucky-day',
    name: 'Kopiko Lucky Day Thai Iced Coffee (180ml Bottle)',
    photoUrl: createProductPhotoDataUrl({
      brand: 'KOPIKO',
      title: 'LUCKY DAY',
      subtitle: 'Creamy Thai Coffee',
      volume: '180mL BOTTLE',
      bgPrimary: '#5C2C16',
      bgSecondary: '#2E1509',
      accentColor: '#F59E0B',
      containerType: 'bottle',
    }),
    purchasePrice: 29.0,
    barcode: '8996001600146',
    isArchived: false,
    lastUpdatedAt: '2026-11-15T09:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'prod-nestle-chuckie-250',
    name: 'Nestlé Chuckie Calci-N Chocolate Milk (250ml Carton)',
    photoUrl: createProductPhotoDataUrl({
      brand: 'NESTLÉ',
      title: 'CHUCKIE',
      subtitle: 'Chocolate Milk Drink',
      volume: '250mL PACK',
      bgPrimary: '#4A2511',
      bgSecondary: '#2B1306',
      accentColor: '#FBBF24',
      containerType: 'carton',
    }),
    purchasePrice: 36.0,
    barcode: '4800361390804',
    isArchived: false,
    lastUpdatedAt: '2026-11-15T09:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'prod-city-blends-iced-cup',
    name: '7-Eleven Large Cup with Ice (16oz Store Cup)',
    photoUrl: createProductPhotoDataUrl({
      brand: '7-ELEVEN PH',
      title: 'ICE CUP',
      subtitle: 'Crystal Cube Ice Cup',
      volume: '16oz CUP',
      bgPrimary: '#294735',
      bgSecondary: '#17201B',
      accentColor: '#D7E07A',
      containerType: 'cup',
    }),
    purchasePrice: 15.0,
    barcode: '4800711000162',
    isArchived: false,
    lastUpdatedAt: '2026-11-15T09:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'prod-mogu-mogu-lychee',
    name: 'Mogu Mogu Lychee with Nata de Coco (320ml Bottle)',
    photoUrl: createProductPhotoDataUrl({
      brand: 'MOGU MOGU',
      title: 'LYCHEE',
      subtitle: 'With Nata de Coco',
      volume: '320mL BOTTLE',
      bgPrimary: '#9D174D',
      bgSecondary: '#500724',
      accentColor: '#F472B6',
      containerType: 'bottle',
    }),
    purchasePrice: 52.0,
    barcode: '8850389102519',
    isArchived: false,
    lastUpdatedAt: '2026-11-14T14:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'prod-yakult-single',
    name: 'Yakult Probiotic Cultured Milk (80ml Single Bottle)',
    photoUrl: createProductPhotoDataUrl({
      brand: 'YAKULT PH',
      title: 'PROBIOTIC',
      subtitle: 'Cultured Milk Drink',
      volume: '80mL BOTTLE',
      bgPrimary: '#B91C1C',
      bgSecondary: '#7F1D1D',
      accentColor: '#FCA5A5',
      containerType: 'bottle',
    }),
    purchasePrice: 16.0,
    barcode: '4806502720013',
    isArchived: false,
    lastUpdatedAt: '2026-11-14T14:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'prod-rite-n-lite-lychee',
    name: 'Rite n Lite Lychee + Rose No Sugar Soda (250ml Can)',
    photoUrl: createProductPhotoDataUrl({
      brand: 'RITE N LITE',
      title: 'LYCHEE ROSE',
      subtitle: 'Zero Sugar Carbonated',
      volume: '250mL CAN',
      bgPrimary: '#831843',
      bgSecondary: '#3B0764',
      accentColor: '#F9A8D4',
      containerType: 'can',
    }),
    purchasePrice: 32.0,
    barcode: '4806526480115',
    isArchived: false,
    lastUpdatedAt: '2026-11-16T08:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'prod-rite-n-lite-calamansi',
    name: 'Rite n Lite Calamansi + Ginger Zero Soda (250ml Can)',
    photoUrl: createProductPhotoDataUrl({
      brand: 'RITE N LITE',
      title: 'CALAMANSI',
      subtitle: 'Zero Sugar Carbonated',
      volume: '250mL CAN',
      bgPrimary: '#15803D',
      bgSecondary: '#14532D',
      accentColor: '#D7E07A',
      containerType: 'can',
    }),
    purchasePrice: 32.0,
    barcode: '4806526480092',
    isArchived: false,
    lastUpdatedAt: '2026-11-16T08:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'prod-nescafe-espresso-roast',
    name: 'Nescafé Canned Espresso Roast (240ml Can)',
    photoUrl: createProductPhotoDataUrl({
      brand: 'NESCAFÉ',
      title: 'ESPRESSO',
      subtitle: 'Bold Dark Roast Coffee',
      volume: '240mL CAN',
      bgPrimary: '#1E293B',
      bgSecondary: '#0F172A',
      accentColor: '#D7E07A',
      containerType: 'can',
    }),
    purchasePrice: 44.0,
    barcode: '4800361410229',
    isArchived: false,
    lastUpdatedAt: '2026-11-15T11:30:00Z',
    isDemoRecord: true,
  },
  {
    id: 'prod-selecta-fortified-milk',
    name: 'Selecta Fortified Full Cream Milk (245ml Carton)',
    photoUrl: createProductPhotoDataUrl({
      brand: 'SELECTA',
      title: 'FARM FRESH',
      subtitle: 'Full Cream Dairy Milk',
      volume: '245mL PACK',
      bgPrimary: '#1D4ED8',
      bgSecondary: '#1E3A8A',
      accentColor: '#93C5FD',
      containerType: 'carton',
    }),
    purchasePrice: 35.0,
    barcode: '4800086035118',
    isArchived: false,
    lastUpdatedAt: '2026-11-15T11:30:00Z',
    isDemoRecord: true,
  },
];

export const INITIAL_RECIPES: DrinkRecipe[] = [
  {
    id: 'rec-kopiko-caramel-macchiato',
    slug: 'kopiko-lucky-cream-macchiato',
    name: 'Kopiko Lucky Cream Macchiato',
    category: 'Coffee Mixes',
    status: 'Published',
    photoUrl: '/src/assets/images/drink_kopiko_caramel_macchiato_1795010585218.jpg',
    submitterName: 'Miguel Santos',
    tasteNotes: 'Rich Thai coffee sweetness balanced by cold full-cream dairy over 7-Eleven cube ice.',
    ingredients: [
      {
        id: 'ri-101',
        productId: 'prod-kopiko-lucky-day',
        productNameSnapshot: 'Kopiko Lucky Day Thai Iced Coffee (180ml Bottle)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[0].photoUrl,
        quantityUsed: '1 full bottle (180ml)',
        unitsToPurchase: 1,
        priceSnapshot: 29.0,
        priceVerified: true,
      },
      {
        id: 'ri-102',
        productId: 'prod-selecta-fortified-milk',
        productNameSnapshot: 'Selecta Fortified Full Cream Milk (245ml Carton)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[8].photoUrl,
        quantityUsed: 'Half carton (~120ml poured first)',
        unitsToPurchase: 1, // Full unit purchase cost rule enforced
        priceSnapshot: 35.0,
        priceVerified: true,
      },
      {
        id: 'ri-103',
        productId: 'prod-city-blends-iced-cup',
        productNameSnapshot: '7-Eleven Large Cup with Ice (16oz Store Cup)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[2].photoUrl,
        quantityUsed: '1 cup filled with ice',
        unitsToPurchase: 1,
        priceSnapshot: 15.0,
        priceVerified: true,
      },
    ],
    totalPurchaseCost: 79.0,
    priceVerified: true,
    needsPriceReview: false,
    lastPriceVerifiedAt: '2026-11-16T10:00:00Z',
    isEditorsPick: true,
    isTrending: true,
    likesCount: 142,
    publishedAt: '2026-11-12T08:30:00Z',
    createdAt: '2026-11-12T08:00:00Z',
    updatedAt: '2026-11-16T10:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'rec-chuckie-dirty-float',
    slug: 'chuckie-dirty-espresso-mudslide',
    name: 'Chuckie Dirty Espresso Mudslide',
    category: 'Chocolate-Based',
    status: 'Published',
    photoUrl: '/src/assets/images/drink_chuckie_dirty_float_1795010587123.jpg',
    submitterName: 'Clarisse Tan',
    tasteNotes: 'Nostalgic malty chocolate milk cut with a sharp dark espresso roast float.',
    ingredients: [
      {
        id: 'ri-201',
        productId: 'prod-nestle-chuckie-250',
        productNameSnapshot: 'Nestlé Chuckie Calci-N Chocolate Milk (250ml Carton)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[1].photoUrl,
        quantityUsed: '1 full carton (250ml)',
        unitsToPurchase: 1,
        priceSnapshot: 36.0,
        priceVerified: true,
      },
      {
        id: 'ri-202',
        productId: 'prod-nescafe-espresso-roast',
        productNameSnapshot: 'Nescafé Canned Espresso Roast (240ml Can)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[7].photoUrl,
        quantityUsed: 'Half can (~120ml floated on top)',
        unitsToPurchase: 1,
        priceSnapshot: 44.0,
        priceVerified: true,
      },
      {
        id: 'ri-203',
        productId: 'prod-city-blends-iced-cup',
        productNameSnapshot: '7-Eleven Large Cup with Ice (16oz Store Cup)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[2].photoUrl,
        quantityUsed: '1 cup with ice',
        unitsToPurchase: 1,
        priceSnapshot: 15.0,
        priceVerified: true,
      },
    ],
    totalPurchaseCost: 95.0,
    priceVerified: true,
    needsPriceReview: false,
    lastPriceVerifiedAt: '2026-11-16T12:00:00Z',
    isEditorsPick: true,
    isTrending: true,
    likesCount: 198,
    publishedAt: '2026-11-11T09:15:00Z',
    createdAt: '2026-11-11T09:00:00Z',
    updatedAt: '2026-11-16T12:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'rec-mogumogu-yakult-sparkler',
    slug: 'mogu-lychee-rose-probiotic-fizz',
    name: 'Mogu Lychee Rose Probiotic Fizz',
    category: 'Fruity & Soda',
    status: 'Published',
    photoUrl: '/src/assets/images/drink_mogumogu_yakult_sparkler_1795010588252.jpg',
    submitterName: 'Jules Villanueva',
    tasteNotes: 'Crisp floral lychee carbonation with chewy nata de coco cubes and a tangy Yakult cloud.',
    ingredients: [
      {
        id: 'ri-301',
        productId: 'prod-mogu-mogu-lychee',
        productNameSnapshot: 'Mogu Mogu Lychee with Nata de Coco (320ml Bottle)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[3].photoUrl,
        quantityUsed: 'Half bottle + all nata cubes',
        unitsToPurchase: 1,
        priceSnapshot: 52.0,
        priceVerified: true,
      },
      {
        id: 'ri-302',
        productId: 'prod-rite-n-lite-lychee',
        productNameSnapshot: 'Rite n Lite Lychee + Rose No Sugar Soda (250ml Can)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[5].photoUrl,
        quantityUsed: '1 full can (250ml)',
        unitsToPurchase: 1,
        priceSnapshot: 32.0,
        priceVerified: true,
      },
      {
        id: 'ri-303',
        productId: 'prod-yakult-single',
        productNameSnapshot: 'Yakult Probiotic Cultured Milk (80ml Single Bottle)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[4].photoUrl,
        quantityUsed: '1 bottle (80ml)',
        unitsToPurchase: 1,
        priceSnapshot: 16.0,
        priceVerified: true,
      },
    ],
    totalPurchaseCost: 100.0,
    priceVerified: true,
    needsPriceReview: false,
    lastPriceVerifiedAt: '2026-11-17T08:00:00Z',
    isEditorsPick: true,
    isTrending: true,
    likesCount: 165,
    publishedAt: '2026-11-14T15:00:00Z',
    createdAt: '2026-11-14T14:30:00Z',
    updatedAt: '2026-11-17T08:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'rec-midnight-mocha-velvet',
    slug: 'midnight-chuckie-lucky-mocha',
    name: 'Midnight Chuckie Lucky Mocha',
    category: 'Chocolate-Based',
    status: 'Published',
    photoUrl: '/src/assets/images/drink_city_blends_mocha_freeze_1795010590964.jpg',
    submitterName: 'Anonymous Creator',
    tasteNotes: 'Ultra-budget two-bottle combo that tastes like a café iced mocha without the ₱180 price tag.',
    ingredients: [
      {
        id: 'ri-401',
        productId: 'prod-nestle-chuckie-250',
        productNameSnapshot: 'Nestlé Chuckie Calci-N Chocolate Milk (250ml Carton)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[1].photoUrl,
        quantityUsed: '1 carton (250ml)',
        unitsToPurchase: 1,
        priceSnapshot: 36.0,
        priceVerified: true,
      },
      {
        id: 'ri-402',
        productId: 'prod-kopiko-lucky-day',
        productNameSnapshot: 'Kopiko Lucky Day Thai Iced Coffee (180ml Bottle)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[0].photoUrl,
        quantityUsed: '1 bottle (180ml)',
        unitsToPurchase: 1,
        priceSnapshot: 29.0,
        priceVerified: true,
      },
    ],
    totalPurchaseCost: 65.0,
    priceVerified: true,
    needsPriceReview: false,
    lastPriceVerifiedAt: '2026-11-17T09:00:00Z',
    isEditorsPick: false,
    isTrending: false,
    likesCount: 119,
    publishedAt: '2026-11-16T18:00:00Z',
    createdAt: '2026-11-16T17:30:00Z',
    updatedAt: '2026-11-17T09:00:00Z',
    isDemoRecord: true,
  },
  {
    id: 'rec-calamansi-yakult-spritz',
    slug: 'calamansi-ginger-yakult-spritz',
    name: 'Calamansi Ginger Yakult Spritz',
    category: 'Fruity & Soda',
    status: 'Published',
    photoUrl: '/src/assets/images/drink_rite_n_lite_citrus_yakult_1795010590256.jpg',
    submitterName: 'Paolo Reyes',
    tasteNotes: 'Zesty zero-sugar calamansi ginger fizz softened by one chilled bottle of Yakult.',
    ingredients: [
      {
        id: 'ri-501',
        productId: 'prod-rite-n-lite-calamansi',
        productNameSnapshot: 'Rite n Lite Calamansi + Ginger Zero Soda (250ml Can)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[6].photoUrl,
        quantityUsed: '1 can (250ml)',
        unitsToPurchase: 1,
        priceSnapshot: 32.0,
        priceVerified: true,
      },
      {
        id: 'ri-502',
        productId: 'prod-yakult-single',
        productNameSnapshot: 'Yakult Probiotic Cultured Milk (80ml Single Bottle)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[4].photoUrl,
        quantityUsed: '1 bottle (80ml)',
        unitsToPurchase: 1,
        priceSnapshot: 16.0,
        priceVerified: true,
      },
      {
        id: 'ri-503',
        productId: 'prod-city-blends-iced-cup',
        productNameSnapshot: '7-Eleven Large Cup with Ice (16oz Store Cup)',
        productPhotoSnapshot: INITIAL_PRODUCT_CATALOG[2].photoUrl,
        quantityUsed: '1 cup with ice',
        unitsToPurchase: 1,
        priceSnapshot: 15.0,
        priceVerified: true,
      },
    ],
    totalPurchaseCost: 63.0,
    priceVerified: true,
    needsPriceReview: false,
    lastPriceVerifiedAt: '2026-11-17T11:00:00Z',
    isEditorsPick: false,
    isTrending: true,
    likesCount: 94,
    publishedAt: '2026-11-17T11:30:00Z',
    createdAt: '2026-11-17T10:00:00Z',
    updatedAt: '2026-11-17T11:00:00Z',
    isDemoRecord: true,
  },
];

export const INITIAL_COMMUNITY_SUBMISSIONS: CommunitySubmission[] = [
  {
    id: 'sub-pending-101',
    drinkName: 'Double Shot Kopiko Sweet Foam',
    category: 'Coffee Mixes',
    submitterName: 'Katrina D.',
    tasteNotes: 'Extra strong night-shift study fuel with double espresso and creamy milk.',
    finishedPhotoUrl: '/src/assets/images/drink_kopiko_caramel_macchiato_1795010585218.jpg',
    ingredients: [
      {
        id: 'sub-ing-1',
        productId: 'prod-nescafe-espresso-roast',
        quantityUsed: '1 full can (240ml)',
        unitsToPurchase: 1,
      },
      {
        id: 'sub-ing-2',
        productId: null,
        suggestedProductName: 'Bear Brand Sterilized Milk 200ml',
        suggestedProductPrice: 34.0,
        quantityUsed: 'Half bottle (100ml)',
        unitsToPurchase: 1,
      },
    ],
    status: 'Pending',
    duplicateWarningNotes: 'Requires price verification for suggested product: Bear Brand Sterilized Milk 200ml',
    submittedAt: '2026-11-17T19:20:00Z',
  },
];

export const INITIAL_PRODUCT_SUGGESTIONS: ProductSuggestion[] = [
  {
    id: 'psug-1',
    submissionId: 'sub-pending-101',
    suggestedName: 'Bear Brand Sterilized Milk 200ml',
    suggestedPrice: 34.0,
    status: 'Pending',
    createdAt: '2026-11-17T19:20:00Z',
  },
];

export const INITIAL_REVISIONS: RecipeRevision[] = [
  {
    id: 'rev-1001',
    recipeId: 'rec-kopiko-caramel-macchiato',
    recipeName: 'Kopiko Lucky Cream Macchiato',
    versionNumber: 1,
    changedFields: ['totalPurchaseCost', 'priceVerified'],
    previousValues: { totalPurchaseCost: null, priceVerified: false },
    newValues: { totalPurchaseCost: 79.0, priceVerified: true },
    changeSummary: 'Initial price verification of all 3 catalog ingredients (₱29 + ₱35 + ₱15 = ₱79.00).',
    createdBy: 'Admin Owner',
    createdAt: '2026-11-16T10:00:00Z',
  },
];

export const INITIAL_PRICE_HISTORY: ProductPriceHistoryEntry[] = [
  {
    id: 'pph-1',
    productId: 'prod-kopiko-lucky-day',
    productName: 'Kopiko Lucky Day Thai Iced Coffee (180ml Bottle)',
    previousPrice: 27.0,
    newPrice: 29.0,
    changedAt: '2026-11-15T09:00:00Z',
  },
];

export const INITIAL_CONTACT_REPORTS: ContactReport[] = [
  {
    id: 'rep-101',
    reporterName: 'enzomnl',
    reporterEmail: 'enzo.sample@example.com',
    category: 'Incorrect or Outdated Product Price',
    message: 'Heads up! Mogu Mogu Lychee 320ml was ₱54.00 at the BGC branch yesterday, might be worth checking if prices went up.',
    relatedRecipeSlug: 'mogu-lychee-rose-probiotic-fizz',
    status: 'Open',
    createdAt: '2026-11-17T16:40:00Z',
  },
];

export const INITIAL_WEBSITE_SETTINGS: WebsiteSettings = {
  maintenanceMode: false,
  maintenanceTitle: 'Scheduled Price & Catalog Verification',
  maintenanceMessage:
    '711acks is temporarily offline while the administrator verifies updated 7-Eleven Philippines product prices. All saved recipes and community submissions remain safe.',
  sessionTimeoutMinutes: 30,
  requireAdminOtp: true,
  updatedAt: '2026-11-17T08:00:00Z',
};

export const INITIAL_SECURITY_EVENTS: SecurityEvent[] = [
  {
    id: 'sec-1',
    eventType: 'ADMIN_OTP_VERIFIED',
    actor: 'admin@711acks.ph',
    details: 'Two-factor email OTP challenge verified and 30-minute session started.',
    createdAt: '2026-11-17T08:00:00Z',
  },
];
