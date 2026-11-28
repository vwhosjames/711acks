import { DrinkRecipe, RecipeIngredient } from '../types/domain';
import { formatPhpCurrency } from './drinkLogic';

export interface ParsedProductDisplay {
  title: string;
  sizeLabel: string | null;
  partialUseChip: string | null;
}

/**
 * Separates trailing size strings like "(250ml Carton)" from product names
 * and isolates partial pour notes (e.g. "use ½") from purchase quantities.
 */
export function parseProductDisplay(ing: RecipeIngredient): ParsedProductDisplay {
  const rawName = ing.productNameSnapshot.trim();
  const sizeMatch = rawName.match(/\(([^)]+)\)\s*$/);
  const title = sizeMatch ? rawName.slice(0, sizeMatch.index).trim() : rawName;
  const sizeLabel = sizeMatch ? sizeMatch[1].trim() : null;

  const qtyLower = ing.quantityUsed.trim().toLowerCase();
  let partialUseChip: string | null = null;

  if (qtyLower.includes('half') || qtyLower.includes('1/2') || qtyLower.includes('½')) {
    partialUseChip = 'use ½';
  } else if (
    qtyLower.includes('quarter') ||
    qtyLower.includes('1/4') ||
    qtyLower.includes('¼')
  ) {
    partialUseChip = 'use ¼';
  } else if (qtyLower.includes('third') || qtyLower.includes('1/3') || qtyLower.includes('⅓')) {
    partialUseChip = 'use ⅓';
  } else if (qtyLower.includes('splash') || qtyLower.includes('dash')) {
    partialUseChip = ing.quantityUsed.split('(')[0].trim();
  }

  return { title, sizeLabel, partialUseChip };
}

export interface PriceVerificationSummary {
  singleLine: string;
  isStale: boolean;
  isUnverified: boolean;
}

/**
 * Merges verification dates into one plain line and detects >30-day staleness
 * for a gentle inline note instead of heavy alert chrome.
 */
export function getPriceVerificationSummary(
  lastVerifiedAt: string | null,
  priceVerified: boolean,
  nowMs: number = Date.now()
): PriceVerificationSummary {
  if (!lastVerifiedAt || !priceVerified) {
    return {
      singleLine: 'Prices not yet verified · check shelf tag at store',
      isStale: false,
      isUnverified: true,
    };
  }

  const parsed = new Date(lastVerifiedAt);
  if (Number.isNaN(parsed.getTime())) {
    return {
      singleLine: 'Prices not yet verified · check shelf tag at store',
      isStale: false,
      isUnverified: true,
    };
  }

  const ageDays = Math.floor((nowMs - parsed.getTime()) / (24 * 60 * 60 * 1000));
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(parsed);

  if (ageDays > 30) {
    return {
      singleLine: `Prices checked ${formattedDate} (${ageDays}d ago) · shelf price may have changed`,
      isStale: true,
      isUnverified: false,
    };
  }

  return {
    singleLine: `Prices checked ${formattedDate} · may vary by branch`,
    isStale: false,
    isUnverified: false,
  };
}

/**
 * Formats a concise plain-text 7-Eleven checklist for clipboard sharing.
 */
export function buildChecklistPlainText(
  recipe: DrinkRecipe,
  checkedIds?: Record<string, boolean>
): string {
  const header = `${recipe.name} — ${formatPhpCurrency(
    recipe.totalPurchaseCost
  )} at 7-Eleven PH`;
  const lines = recipe.ingredients.map((ing) => {
    const mark = checkedIds?.[ing.id] ? '[x]' : '[ ]';
    const parsed = parseProductDisplay(ing);
    const sizeNote = parsed.sizeLabel ? ` (${parsed.sizeLabel})` : '';
    const partNote = parsed.partialUseChip ? ` [${parsed.partialUseChip}]` : '';
    const linePrice =
      ing.priceVerified && ing.priceSnapshot !== null
        ? formatPhpCurrency(ing.priceSnapshot * ing.unitsToPurchase)
        : 'Unverified';
    return `${mark} Buy ${ing.unitsToPurchase} × ${parsed.title}${sizeNote}${partNote} — ${linePrice}`;
  });
  return [header, ...lines].join('\n');
}

/**
 * Draws an offline 711acks Midnight Bodega PNG checklist image for mobile saves.
 */
export function downloadCheckoutCardPng(recipe: DrinkRecipe): boolean {
  if (typeof document === 'undefined') return false;
  const width = 760;
  const rowHeight = 58;
  const height = 240 + recipe.ingredients.length * rowHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.fillStyle = '#17201B';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(215, 224, 122, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  ctx.fillStyle = '#D7E07A';
  ctx.font = '600 14px monospace';
  ctx.fillText(`711ACKS · ${recipe.category.toUpperCase()}`, 44, 62);

  ctx.fillStyle = '#F5F3EC';
  ctx.font = '300 28px sans-serif';
  ctx.fillText(recipe.name.slice(0, 42), 44, 102);

  ctx.fillStyle = '#C9C5B8';
  ctx.font = '14px monospace';
  ctx.fillText('TOTAL AT CHECKOUT', 44, 146);

  ctx.fillStyle = '#D7E07A';
  ctx.font = '700 30px monospace';
  ctx.fillText(formatPhpCurrency(recipe.totalPurchaseCost), width - 220, 146);

  ctx.strokeStyle = 'rgba(245, 243, 236, 0.16)';
  ctx.beginPath();
  ctx.moveTo(44, 168);
  ctx.lineTo(width - 44, 168);
  ctx.stroke();

  recipe.ingredients.forEach((ing, idx) => {
    const y = 212 + idx * rowHeight;
    const parsed = parseProductDisplay(ing);
    ctx.fillStyle = '#D7E07A';
    ctx.font = '700 13px monospace';
    ctx.fillText(`BUY ${ing.unitsToPurchase}`, 44, y);

    ctx.fillStyle = '#F5F3EC';
    ctx.font = '500 16px sans-serif';
    ctx.fillText(parsed.title.slice(0, 44), 116, y);

    const priceStr =
      ing.priceVerified && ing.priceSnapshot !== null
        ? formatPhpCurrency(ing.priceSnapshot * ing.unitsToPurchase)
        : '—';
    ctx.fillStyle = '#D7E07A';
    ctx.font = '600 16px monospace';
    ctx.fillText(priceStr, width - 130, y);
  });

  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = `711acks-${recipe.slug || 'checklist'}.png`;
  link.href = url;
  link.click();
  return true;
}
