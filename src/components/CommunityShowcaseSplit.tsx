import React, { useEffect, useState } from 'react';
import { ArrowRight, Clock, CupSoda, Heart, Layers, UserRound } from 'lucide-react';
import { DrinkRecipe } from '../types/domain';
import { formatPhpCurrency } from '../utils/drinkLogic';
import { formatPluralCount, formatSmartTimestamp } from '../utils/formatters';

interface CommunityShowcaseSplitProps {
  communityFavorites: DrinkRecipe[];
  newestCreations: DrinkRecipe[];
  hasLiked: (recipeId: string) => boolean;
  isLikePending: (recipeId: string) => boolean;
  likeError: string | null;
  onToggleLike: (recipeId: string) => void;
  onOpenDrink: (slug: string) => void;
  onExploreAll: () => void;
}

function getSubmitterInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'AC';
  const tokens = cleaned
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  return `${tokens[0][0] ?? ''}${tokens[tokens.length - 1][0] ?? ''}`.toUpperCase();
}

interface ThumbProps {
  src: string;
  alt: string;
}

const LeaderboardThumb: React.FC<ThumbProps> = ({ src, alt }) => {
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    setFailed(!src);
  }, [src]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} placeholder`}
        className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center bg-[#294735]/12 dark:bg-[#17201B] border border-[#17201B]/12 dark:border-[#D7E07A]/20 text-[#294735] dark:text-[#D7E07A]"
      >
        <CupSoda size={20} strokeWidth={1.6} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-16 h-16 rounded-xl object-cover shrink-0 bg-[#17201B] border border-[#17201B]/10 dark:border-[#D7E07A]/15"
    />
  );
};

interface LikeButtonProps {
  recipe: DrinkRecipe;
  liked: boolean;
  pending: boolean;
  onToggle: () => void;
}

const ShowcaseLikeButton: React.FC<LikeButtonProps> = ({
  recipe,
  liked,
  pending,
  onToggle,
}) => (
  <button
    type="button"
    disabled={pending}
    aria-pressed={liked}
    aria-label={`${liked ? 'Unlike' : 'Like'} ${recipe.name} (${formatPluralCount(
      recipe.likesCount,
      'like'
    )})`}
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    className={`relative z-10 min-h-[44px] min-w-[44px] pressable px-3 py-1.5 rounded-lg text-xs font-mono-tabular font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 border transition-[background-color,border-color,color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFFFF] dark:focus-visible:ring-offset-[#1E2B23] ${
      pending ? 'opacity-60 cursor-wait' : 'cursor-pointer'
    } ${
      liked
        ? 'bg-[#294735] text-[#D7E07A] border-[#294735] dark:bg-[#D7E07A] dark:text-[#17201B] dark:border-[#D7E07A]'
        : 'bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] border-[#17201B]/20 dark:border-[#F5F3EC]/25 hover:border-[#294735] dark:hover:border-[#D7E07A]'
    }`}
  >
    <Heart
      size={14}
      strokeWidth={2}
      className={liked ? 'fill-current shrink-0' : 'shrink-0'}
      aria-hidden="true"
    />
    <span className="tabular-nums-strict">
      {recipe.likesCount.toLocaleString('en-US')}
    </span>
  </button>
);

/**
 * Promoted Sections 4 & 5:
 * Left: Ranked Community Favorites leaderboard with oversized tabular numerals,
 * proportional like-density bars relative to #1, and right-aligned PHP pricing.
 * Right: Newest Creations avatar feed featuring submitter initials / system glyph,
 * relative publication timestamps, and synced like actions.
 */
export const CommunityShowcaseSplit: React.FC<CommunityShowcaseSplitProps> = ({
  communityFavorites,
  newestCreations,
  hasLiked,
  isLikePending,
  likeError,
  onToggleLike,
  onOpenDrink,
  onExploreAll,
}) => {
  const maxLikes = Math.max(1, communityFavorites[0]?.likesCount ?? 1);
  const favoriteIds = new Set(communityFavorites.map((r) => r.id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
      {/* SECTION 4: Community Favorites Leaderboard */}
      <section
        aria-labelledby="heading-community-favorites"
        className="lg:col-span-7 space-y-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-4">
          <div>
            <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
              04. Ranked By Anonymous Likes
            </p>
            <h2
              id="heading-community-favorites"
              className="font-display text-2xl font-light uppercase heading-tight mt-1"
            >
              Community Favorites
            </h2>
          </div>

          <button
            type="button"
            onClick={onExploreAll}
            className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-mono-tabular uppercase tracking-wider text-[#294735] dark:text-[#D7E07A] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] rounded-md px-2 cursor-pointer"
          >
            <span>See all</span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>

        {likeError && (
          <div
            role="alert"
            className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-xs text-red-700 dark:text-red-300"
          >
            {likeError}
          </div>
        )}

        <ol className="space-y-3">
          {communityFavorites.map((recipe, index) => {
            const rank = index + 1;
            const rankLabel = rank < 10 ? `0${rank}` : `${rank}`;
            const ratioPct =
              recipe.likesCount > 0
                ? Math.max(6, Math.round((recipe.likesCount / maxLikes) * 100))
                : 0;
            const liked = hasLiked(recipe.id);
            const pending = isLikePending(recipe.id);

            return (
              <li key={recipe.id}>
                <article className="relative overflow-hidden rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card border border-[#17201B]/12 dark:border-[#D7E07A]/15 hover:border-[#294735]/40 dark:hover:border-[#D7E07A]/40 transition-colors duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)]">
                  {/* Subtle proportional fill bar behind row showing likes relative to #1 */}
                  <div
                    aria-hidden="true"
                    style={{ width: `${ratioPct}%` }}
                    className="absolute inset-y-0 left-0 bg-[#294735]/[0.06] dark:bg-[#D7E07A]/[0.08] pointer-events-none transition-[width] duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)]"
                  />

                  <button
                    type="button"
                    onClick={() => onOpenDrink(recipe.slug)}
                    aria-label={`View #${rankLabel} community favorite ${recipe.name}`}
                    className="absolute inset-0 z-0 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                  >
                    <span className="sr-only">View {recipe.name}</span>
                  </button>

                  <div className="relative p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <span
                        className={`font-display text-2xl sm:text-3xl font-light tabular-nums-strict w-9 shrink-0 text-center ${
                          rank === 1
                            ? 'text-[#294735] dark:text-[#D7E07A] font-normal'
                            : 'text-[#17201B]/80 dark:text-[#C9C5B8]'
                        }`}
                      >
                        {rankLabel}
                      </span>

                      <LeaderboardThumb src={recipe.photoUrl} alt={recipe.name} />

                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 className="text-sm sm:text-base font-semibold text-[#17201B] dark:text-[#F5F3EC] leading-snug line-clamp-2">
                          {recipe.name}
                        </h3>
                        <p className="text-xs font-mono-tabular text-[#17201B]/80 dark:text-[#C9C5B8] truncate">
                          {recipe.category} ·{' '}
                          {formatPluralCount(recipe.ingredients.length, 'item')} · by{' '}
                          {recipe.submitterName}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-12 sm:pl-0 shrink-0">
                      <span className="font-mono-tabular text-base sm:text-lg font-bold text-[#294735] dark:text-[#D7E07A] tabular-nums-strict">
                        {formatPhpCurrency(recipe.totalPurchaseCost)}
                      </span>
                      <ShowcaseLikeButton
                        recipe={recipe}
                        liked={liked}
                        pending={pending}
                        onToggle={() => onToggleLike(recipe.id)}
                      />
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      {/* SECTION 5: Newest Creations Submitter Avatar Feed */}
      <section aria-labelledby="heading-newest" className="lg:col-span-5 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-4">
          <div>
            <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
              05. Freshly Verified
            </p>
            <h2
              id="heading-newest"
              className="font-display text-2xl font-light uppercase heading-tight mt-1"
            >
              Newest Creations
            </h2>
          </div>

          <button
            type="button"
            onClick={onExploreAll}
            className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-mono-tabular uppercase tracking-wider text-[#294735] dark:text-[#D7E07A] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] rounded-md px-2 cursor-pointer"
          >
            <span>See all</span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>

        <ul className="space-y-3.5">
          {newestCreations.map((recipe) => {
            const isAnon =
              recipe.submitterName.trim().toLowerCase() === 'anonymous creator';
            const initials = getSubmitterInitials(recipe.submitterName);
            const liked = hasLiked(recipe.id);
            const pending = isLikePending(recipe.id);
            const isAlsoRanked = favoriteIds.has(recipe.id);

            return (
              <li key={recipe.id}>
                <article className="relative p-4 rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card border border-[#17201B]/12 dark:border-[#D7E07A]/15 hover:border-[#294735]/40 dark:hover:border-[#D7E07A]/40 transition-colors duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] space-y-3">
                  <button
                    type="button"
                    onClick={() => onOpenDrink(recipe.slug)}
                    aria-label={`View newest creation ${recipe.name}`}
                    className="absolute inset-0 z-0 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                  >
                    <span className="sr-only">View {recipe.name}</span>
                  </button>

                  {/* Submitter Avatar + Verified Time */}
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        aria-hidden="true"
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono-tabular font-bold shrink-0 ${
                          isAnon
                            ? 'bg-[#17201B]/10 dark:bg-[#17201B] text-[#17201B]/80 dark:text-[#C9C5B8] border border-[#17201B]/15 dark:border-[#F5F3EC]/15'
                            : 'bg-[#294735] text-[#D7E07A] border border-[#D7E07A]/30'
                        }`}
                      >
                        {isAnon ? <UserRound size={14} strokeWidth={1.8} /> : initials}
                      </span>
                      <span className="text-xs font-mono-tabular text-[#17201B] dark:text-[#F5F3EC] font-medium truncate">
                        {recipe.submitterName}
                      </span>
                    </div>

                    <span className="inline-flex items-center gap-1 text-xs font-mono-tabular text-[#294735] dark:text-[#D7E07A] shrink-0">
                      <Clock size={12} aria-hidden="true" />
                      <span>
                        {formatSmartTimestamp(recipe.publishedAt || recipe.createdAt)}
                      </span>
                    </span>
                  </div>

                  {/* Drink Thumbnail + Details */}
                  <div className="flex items-start gap-3.5">
                    <LeaderboardThumb src={recipe.photoUrl} alt={recipe.name} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono-tabular text-[#17201B]/80 dark:text-[#C9C5B8]">
                        <span>{recipe.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Layers size={11} aria-hidden="true" />
                          {formatPluralCount(recipe.ingredients.length, 'item')}
                        </span>
                        {isAlsoRanked && (
                          <span className="px-1.5 py-0.5 rounded bg-[#D7E07A]/20 text-[#294735] dark:text-[#D7E07A] text-[10px] uppercase tracking-wider">
                            Ranked
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm sm:text-base font-semibold text-[#17201B] dark:text-[#F5F3EC] leading-snug line-clamp-2">
                        {recipe.name}
                      </h3>
                    </div>
                  </div>

                  {/* Checkout Price + Interactive Like */}
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#17201B]/10 dark:border-[#D7E07A]/12">
                    <span className="font-mono-tabular text-base font-bold text-[#294735] dark:text-[#D7E07A] tabular-nums-strict">
                      {formatPhpCurrency(recipe.totalPurchaseCost)}
                    </span>
                    <ShowcaseLikeButton
                      recipe={recipe}
                      liked={liked}
                      pending={pending}
                      onToggle={() => onToggleLike(recipe.id)}
                    />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};
