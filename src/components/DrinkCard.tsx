import React from 'react';
import { Heart } from 'lucide-react';
import { DrinkRecipe } from '../types/domain';
import { formatPhpCurrency } from '../utils/drinkLogic';
import { formatPluralCount } from '../utils/formatters';
import { useApp } from '../context/AppContext';

interface DrinkCardProps {
  recipe: DrinkRecipe;
  onSelect: (slug: string) => void;
  showExtendedMeta?: boolean;
}

/**
 * Section 7 Requirement:
 * Each drink card on the Explore grid should show only:
 * - Finished drink image
 * - Drink name
 * - Total purchase cost
 * Keep cards clean and uncluttered.
 * Desktop: Subtle image zoom, soft lighting effect, Like button appears on hover.
 * Mobile: Like button remains visible, touch-friendly interaction.
 */
export const DrinkCard: React.FC<DrinkCardProps> = ({
  recipe,
  onSelect,
  showExtendedMeta = false,
}) => {
  const { hasLiked, toggleLike, isLikePending } = useApp();
  const liked = hasLiked(recipe.id);
  const likeBusy = isLikePending(recipe.id);

  const handleLikeClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (likeBusy) return;
    await toggleLike(recipe.id);
  };

  return (
    <article
      onClick={() => onSelect(recipe.slug)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(recipe.slug);
        }
      }}
      aria-label={`View ${recipe.name} details, total purchase cost ${formatPhpCurrency(
        recipe.totalPurchaseCost
      )}`}
      className="group relative flex flex-col bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card-interactive rounded-xl overflow-hidden cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
    >
      {/* Finished Drink Image (4:3 ratio) */}
      <div className="relative aspect-4/3 w-full bg-[#17201B] overflow-hidden">
        <img
          src={recipe.photoUrl}
          alt={recipe.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-center hover-zoom-img"
          onError={(e) => {
            const target = e.currentTarget;
            target.style.display = 'none';
          }}
        />
        {/* Multi-stop eased scrim to eliminate banding */}
        <div
          aria-hidden="true"
          className="absolute inset-0 card-scrim-bottom opacity-65 group-hover:opacity-45 transition-[opacity] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] pointer-events-none"
        />

        {/* Like button: Always visible on mobile (with 44x44px invisible touch hitbox), appears on hover/focus on desktop */}
        <button
          type="button"
          disabled={likeBusy}
          onClick={handleLikeClick}
          aria-label={
            liked
              ? `Unlike ${recipe.name} (${formatPluralCount(recipe.likesCount, 'like')})`
              : `Like ${recipe.name} (${formatPluralCount(recipe.likesCount, 'like')})`
          }
          className={`hit-target-44 pressable absolute top-3 right-3 z-10 px-2.5 py-1.5 rounded-lg text-xs font-mono-tabular flex items-center gap-1.5 transition-[transform,opacity,background-color,border-color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A] ${
            likeBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
          } ${
            liked
              ? 'bg-[#D7E07A] text-[#17201B] opacity-100 font-semibold shadow-sm'
              : 'bg-[#17201B]/85 backdrop-blur-sm text-[#F5F3EC] border border-[#F5F3EC]/20 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 hover:border-[#D7E07A]'
          }`}
        >
          <Heart
            className={`w-3.5 h-3.5 shrink-0 ${
              liked ? 'fill-[#17201B] text-[#17201B]' : 'text-[#D7E07A]'
            }`}
          />
          <span>{recipe.likesCount}</span>
        </button>
      </div>

      {/* Card Body: Strictly Drink Name + Total Purchase Cost (plus quiet inline metadata only when requested on homepage editorial rows) */}
      <div className="p-4 flex flex-col justify-between flex-1 gap-2">
        {showExtendedMeta && (
          <div className="flex items-center gap-2 text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
            <span>{recipe.category}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums-strict">
              {formatPluralCount(recipe.ingredients.length, 'product')}
            </span>
          </div>
        )}

        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-base font-semibold text-[#17201B] dark:text-[#F5F3EC] group-hover:text-[#294735] dark:group-hover:text-[#D7E07A] transition-[color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)]">
            {recipe.name}
          </h3>

          <span className="font-mono-tabular text-sm font-semibold text-[#294735] dark:text-[#D7E07A] whitespace-nowrap shrink-0">
            {recipe.priceVerified && recipe.totalPurchaseCost !== null
              ? formatPhpCurrency(recipe.totalPurchaseCost)
              : 'Unverified Price'}
          </span>
        </div>
      </div>
    </article>
  );
};
