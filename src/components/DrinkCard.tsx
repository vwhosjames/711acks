import React, { useState } from 'react';
import { CupSoda, Heart, Receipt } from 'lucide-react';
import { DrinkRecipe } from '../types/domain';
import { formatPhpCurrency } from '../utils/drinkLogic';
import { formatPluralCount } from '../utils/formatters';
import { useApp } from '../context/AppContext';

interface DrinkCardProps {
  recipe: DrinkRecipe;
  onSelect: (slug: string) => void;
  showExtendedMeta?: boolean;
}

function shortenProductLabel(fullName: string): string {
  return fullName
    .replace(/\s*\([^)]*\)/g, '')
    .replace('7-Eleven Large Cup with Ice', '7-Eleven Ice Cup')
    .replace('Mogu Mogu Lychee with Nata de Coco', 'Mogu Mogu Lychee')
    .replace('Rite n Lite Lychee + Rose No Sugar Soda', 'Rite n Lite Lychee')
    .replace('Rite n Lite Lychee + Rose Zero Soda', 'Rite n Lite Lychee')
    .replace('Rite n Lite Calamansi + Ginger Zero Soda', 'Rite n Lite Calamansi')
    .replace('Nestlé Chuckie Calci-N Chocolate Milk', 'Nestlé Chuckie')
    .replace('Nestlé Chuckie Chocolate Milk', 'Nestlé Chuckie')
    .replace('Nescafé Canned Espresso Roast', 'Nescafé Espresso')
    .replace('Kopiko Lucky Day Thai Iced Coffee', 'Kopiko Lucky Day')
    .replace('Selecta Fortified Full Cream Milk', 'Selecta Milk')
    .replace('Yakult Probiotic Cultured Milk', 'Yakult');
}

function formatLineItemPrice(price: number | null, units: number): string {
  if (price === null) return 'Unverified';
  return formatPhpCurrency(price * units);
}

/**
 * Checkout Receipt Card:
 * - Independent sibling primary navigation overlay (<button className="absolute inset-0 z-0 ...">)
 *   and independent sibling Like pill button (44px min touch target, aria-pressed, zero nesting).
 * - Compact 16:9 drink photo header with missing-image Midnight fallback.
 * - Always-visible itemized mono 7-Eleven checkout receipt listing individual full-unit products
 *   and prices, summing to the bold PHP total at the bottom.
 */
export const DrinkCard: React.FC<DrinkCardProps> = ({
  recipe,
  onSelect,
  showExtendedMeta = true,
}) => {
  const { hasLiked, toggleLike, isLikePending } = useApp();
  const [imgError, setImgError] = useState(false);

  const liked = hasLiked(recipe.id);
  const likeBusy = isLikePending(recipe.id);
  const formattedLikes = recipe.likesCount.toLocaleString('en-US');

  const handleLikeClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (likeBusy) return;
    await toggleLike(recipe.id);
  };

  return (
    <article className="group relative flex flex-col bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card-interactive rounded-xl overflow-hidden text-left">
      {/* Primary Click Action Overlay (independent sibling of Like button) */}
      <button
        type="button"
        onClick={() => onSelect(recipe.slug)}
        aria-label={`View ${recipe.name} details, total purchase cost ${formatPhpCurrency(
          recipe.totalPurchaseCost
        )}`}
        className="absolute inset-0 z-0 w-full h-full cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
      >
        <span className="sr-only">View {recipe.name} details</span>
      </button>

      {/* Compact 16:9 Drink Photo Header with Missing-Image Resilience */}
      <div className="relative aspect-16/9 w-full bg-[#17201B] overflow-hidden pointer-events-none">
        {imgError || !recipe.photoUrl ? (
          <div
            role="img"
            aria-label={`${recipe.name} — photo unavailable`}
            className="w-full h-full bg-gradient-to-br from-[#1E2B23] via-[#17201B] to-[#0E1411] flex flex-col items-center justify-center gap-1.5 text-[#C9C5B8]/65 p-4 select-none"
          >
            <div className="w-10 h-10 rounded-full border border-[#D7E07A]/20 bg-[#17201B]/60 flex items-center justify-center">
              <CupSoda className="w-4 h-4 text-[#D7E07A]/75" />
            </div>
            <span className="font-mono-tabular text-[10px] uppercase tracking-[0.2em]">
              Photo Unavailable
            </span>
          </div>
        ) : (
          <img
            src={recipe.photoUrl}
            alt={recipe.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center hover-zoom-img"
            onError={() => setImgError(true)}
          />
        )}

        {/* Multi-stop eased dark scrim for lower-edge drink title legibility */}
        <div
          aria-hidden="true"
          className="absolute inset-0 card-scrim-bottom opacity-85 pointer-events-none"
        />

        {/* Category Pill (Top-Left) */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 max-w-[calc(100%-108px)]">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#17201B]/80 backdrop-blur-md border border-[#F5F3EC]/15 font-mono-tabular text-[10px] uppercase tracking-wider text-[#F5F3EC] truncate">
            {recipe.category}
          </span>
        </div>

        {/* Thin Uppercase Drink Title Anchored Over Lower Photo Scrim */}
        <div className="absolute inset-x-0 bottom-0 p-3.5 sm:p-4">
          <h3 className="font-display text-lg font-light uppercase tracking-[-0.01em] text-[#F5F3EC] leading-snug line-clamp-2">
            {recipe.name}
          </h3>
        </div>
      </div>

      {/* Independent Sibling 44px Floating Like Button (Top-Right) */}
      <button
        type="button"
        disabled={likeBusy}
        aria-pressed={liked}
        onClick={handleLikeClick}
        aria-label={
          liked
            ? `Unlike ${recipe.name} (${formatPluralCount(recipe.likesCount, 'like')})`
            : `Like ${recipe.name} (${formatPluralCount(recipe.likesCount, 'like')})`
        }
        className={`hit-target-44 pressable absolute top-3 right-3 z-20 w-auto min-w-[44px] min-h-[44px] px-3 rounded-full text-xs font-mono-tabular flex items-center justify-center gap-1.5 transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A] pointer-events-auto ${
          likeBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
        } ${
          liked
            ? 'bg-[#D7E07A] text-[#17201B] font-semibold border border-[#D7E07A] shadow-sm'
            : 'bg-[#17201B]/78 backdrop-blur-md text-[#F5F3EC] border border-[#F5F3EC]/25 hover:border-[#D7E07A]/60 hover:bg-[#17201B]'
        }`}
      >
        <Heart
          className={`w-3.5 h-3.5 shrink-0 ${
            liked ? 'fill-[#17201B] text-[#17201B]' : 'text-[#F5F3EC]'
          }`}
        />
        <span className="tabular-nums-strict">{formattedLikes}</span>
      </button>

      {/* Itemized Checkout Receipt Ledger */}
      <div className="p-4 flex-1 flex flex-col justify-between bg-[#FAF9F5] dark:bg-[#151E19] font-mono-tabular text-xs pointer-events-none">
        <div className="space-y-3">
          {/* Receipt Header Strip */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-dashed border-[#17201B]/18 dark:border-[#C9C5B8]/25 text-[10px] uppercase tracking-[0.16em] text-[#17201B]/65 dark:text-[#C9C5B8]">
            <span className="inline-flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-[#294735] dark:text-[#D7E07A] shrink-0" />
              <span>7&#8209;Eleven Checkout</span>
            </span>
            {showExtendedMeta && (
              <span className="tabular-nums-strict">
                {formatPluralCount(recipe.ingredients.length, 'item')}
              </span>
            )}
          </div>

          {/* Itemized Shelf Products & Individual Full-Unit Prices */}
          <ul className="space-y-2">
            {recipe.ingredients.map((ing) => (
              <li
                key={ing.id}
                className="flex items-baseline justify-between gap-2 text-[11px] leading-snug"
              >
                <span className="text-[#17201B]/90 dark:text-[#F5F3EC]/90 min-w-0 flex-1">
                  <span className="text-[#294735] dark:text-[#D7E07A] font-semibold mr-1.5">
                    {ing.unitsToPurchase}×
                  </span>
                  <span className="break-words">
                    {shortenProductLabel(ing.productNameSnapshot)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="hidden sm:inline-block flex-1 max-w-[32px] border-b border-dotted border-[#17201B]/20 dark:border-[#C9C5B8]/25 self-center"
                />
                <span className="text-[#17201B] dark:text-[#F5F3EC] font-medium shrink-0 tabular-nums-strict whitespace-nowrap">
                  {ing.priceVerified
                    ? formatLineItemPrice(ing.priceSnapshot, ing.unitsToPurchase)
                    : 'Unverified'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Receipt Total Footer */}
        <div className="mt-4 pt-3 border-t-2 border-dashed border-[#294735]/20 dark:border-[#D7E07A]/25 flex items-baseline justify-between gap-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#17201B]/65 dark:text-[#C9C5B8]">
            Total Checkout
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#294735] dark:text-[#D7E07A] tabular-nums-strict leading-none whitespace-nowrap">
            {recipe.priceVerified && recipe.totalPurchaseCost !== null
              ? formatPhpCurrency(recipe.totalPurchaseCost)
              : 'Unverified Price'}
          </div>
        </div>
      </div>
    </article>
  );
};
