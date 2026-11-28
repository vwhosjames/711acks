import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Heart, RefreshCw, RotateCcw, Wallet } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { HeroFlashlight } from '../components/HeroFlashlight';
import { DrinkCard } from '../components/DrinkCard';
import { CommunityShowcaseSplit } from '../components/CommunityShowcaseSplit';
import { PublicRoute } from '../components/Navbar';
import { APPROVED_CATEGORIES, DrinkCategory } from '../types/domain';
import { formatPhpCurrency } from '../utils/drinkLogic';
import { formatPluralCount } from '../utils/formatters';

type BudgetSortOption = 'price_asc' | 'popular' | 'newest';

const BUDGET_PRESETS: { label: string; value: number | null }[] = [
  { label: '₱50', value: 50 },
  { label: '₱75', value: 75 },
  { label: '₱100', value: 100 },
  { label: '₱150', value: 150 },
  { label: 'Any', value: null },
];

interface HomePageProps {
  onNavigate: (route: PublicRoute) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  const {
    recipes,
    hasLiked,
    toggleLike,
    isLikePending,
    isLoadingData,
    dataError,
    refreshPublicData,
  } = useApp();
  const [likeError, setLikeError] = useState<string | null>(null);
  const [budgetMax, setBudgetMax] = useState<number | null>(null);
  const [budgetCategory, setBudgetCategory] = useState<DrinkCategory | 'ALL'>('ALL');
  const [budgetSort, setBudgetSort] = useState<BudgetSortOption>('price_asc');

  const handleLeaderboardLike = async (recipeId: string) => {
    setLikeError(null);
    const res = await toggleLike(recipeId);
    if (!res.success && res.message) {
      setLikeError(res.message);
    }
  };

  const handleCardLikeClick = async (e: React.MouseEvent, recipeId: string) => {
    e.stopPropagation();
    if (isLikePending(recipeId)) return;
    await toggleLike(recipeId);
  };

  const publishedRecipes = useMemo(
    () => recipes.filter((r) => r.status === 'Published'),
    [recipes]
  );

  // 1. Trending Drink Hacks (popular combinations based on engagement)
  const trendingDrinks = [...publishedRecipes]
    .filter((r) => r.isTrending)
    .sort((a, b) => b.likesCount - a.likesCount)
    .slice(0, 3);

  // 3. Budget-Friendly Drinks (live budget + category + sort filter)
  const budgetFriendly = useMemo(() => {
    const filtered = publishedRecipes.filter((r) => {
      if (!r.priceVerified || r.totalPurchaseCost === null) return false;
      if (budgetMax !== null && r.totalPurchaseCost > budgetMax) return false;
      if (budgetCategory !== 'ALL' && r.category !== budgetCategory) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (budgetSort === 'price_asc') {
        return (a.totalPurchaseCost ?? 999) - (b.totalPurchaseCost ?? 999);
      }
      if (budgetSort === 'popular') {
        return b.likesCount - a.likesCount;
      }
      return (
        new Date(b.publishedAt || b.createdAt).getTime() -
        new Date(a.publishedAt || a.createdAt).getTime()
      );
    });
  }, [publishedRecipes, budgetMax, budgetCategory, budgetSort]);

  // 4. Community Favorites (recipes ranked by likes)
  const communityFavorites = useMemo(
    () =>
      [...publishedRecipes]
        .sort((a, b) => b.likesCount - a.likesCount)
        .slice(0, 4),
    [publishedRecipes]
  );

  // 2. Newest Creations (deduped against Community Favorites when catalog depth permits)
  const newestCreations = useMemo(() => {
    const byRecency = [...publishedRecipes].sort(
      (a, b) =>
        new Date(b.publishedAt || b.createdAt).getTime() -
        new Date(a.publishedAt || a.createdAt).getTime()
    );
    const favoriteIds = new Set(communityFavorites.map((r) => r.id));
    const deduped = byRecency.filter((r) => !favoriteIds.has(r.id));
    const source = deduped.length >= 3 ? deduped : byRecency;
    return source.slice(0, 4);
  }, [publishedRecipes, communityFavorites]);

  // 5. Editor's Picks (recipes manually selected by administrator)
  const editorsPicks = publishedRecipes.filter((r) => r.isEditorsPick).slice(0, 3);

  const openDrink = (slug: string) => {
    onNavigate({ page: 'drink-detail', slug });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-dvh bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] transition-[background-color,color] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)]">
      {/* SECTION 0: Official Dual-Image Flashlight Hero */}
      <HeroFlashlight onNavigate={onNavigate} />

      <div className="max-w-7xl mx-auto px-6 py-16 space-y-24">
        {dataError && (
          <div
            role="alert"
            className="p-4 bg-red-500/10 border border-red-500/35 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Unable to load live drink recipes: {dataError}</span>
            </div>
            <button
              type="button"
              onClick={() => void refreshPublicData()}
              className="pressable min-h-[40px] px-3 py-1.5 rounded-lg border border-red-500/40 hover:bg-red-500/10 font-semibold flex items-center gap-1.5 self-start sm:self-auto cursor-pointer shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {isLoadingData && publishedRecipes.length === 0 && !dataError && (
          <div
            role="status"
            className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl text-center text-sm text-[#17201B]/75 dark:text-[#C9C5B8]"
          >
            Loading verified 7&#8209;Eleven drink combinations...
          </div>
        )}

        {/* SECTION 1: Trending Drink Hacks — 3-Column Immersive Editorial Showcase */}
        <section aria-labelledby="heading-trending" className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5 text-xs font-mono-tabular uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
                <span>01. High Engagement</span>
                <span aria-hidden="true">·</span>
                <span>7&#8209;Eleven PH Mixes</span>
              </div>
              <h2
                id="heading-trending"
                className="font-display text-3xl sm:text-4xl font-light uppercase heading-tight"
              >
                Trending Drink Hacks
              </h2>
              <p className="text-sm text-[#17201B]/70 dark:text-[#C9C5B8] max-w-[56ch]">
                Most liked combinations in the archive—each card shows full unopened store checkout cost in PHP.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'explore' })}
              className="pressable min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-lg border border-[#17201B]/14 dark:border-[#C9C5B8]/18 text-xs font-semibold uppercase tracking-wider text-[#294735] dark:text-[#F5F3EC] hover-border-accent hover-surface-tint flex items-center gap-2 cursor-pointer self-start sm:self-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
            >
              <span>Browse Full Archive</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
            {trendingDrinks.map((recipe) => (
              <DrinkCard
                key={recipe.id}
                recipe={recipe}
                onSelect={openDrink}
                showExtendedMeta
              />
            ))}
          </div>
        </section>

        {/* SECTION 2: Editor's Picks — Bolder Bodega Showcase */}
        <section aria-labelledby="heading-editors-picks" className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-5">
            <div className="space-y-1">
              <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
                02. Curated Selections
              </p>
              <h2
                id="heading-editors-picks"
                className="font-display text-3xl sm:text-4xl font-light uppercase heading-tight"
              >
                Editor&apos;s Picks
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[#17201B]/70 dark:text-[#C9C5B8] max-w-[46ch] leading-relaxed">
              Hand-tested combinations chosen by the 711acks curator for flavor balance and exact single-trip convenience.
            </p>
          </div>

          {editorsPicks.length > 0 && (() => {
            const [primaryPick, ...shelfRows] = editorsPicks;
            const primaryLiked = hasLiked(primaryPick.id);
            const primaryLikeBusy = isLikePending(primaryPick.id);

            return (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-stretch">
                {/* High-Impact Left Feature Card with 5-stop hero-scrim-bottom */}
                <article className="lg:col-span-7 group relative min-h-[340px] sm:min-h-[400px] bg-[#17201B] surface-card-interactive rounded-xl overflow-hidden text-left">
                  <button
                    type="button"
                    onClick={() => openDrink(primaryPick.slug)}
                    aria-label={`View ${primaryPick.name} details, ${formatPhpCurrency(
                      primaryPick.totalPurchaseCost
                    )}`}
                    className="absolute inset-0 z-0 w-full h-full cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A]"
                  >
                    <span className="sr-only">View {primaryPick.name} details</span>
                  </button>

                  <img
                    src={primaryPick.photoUrl}
                    alt={primaryPick.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover object-center hover-zoom-img pointer-events-none"
                  />

                  <div
                    aria-hidden="true"
                    className="absolute inset-0 hero-scrim-bottom pointer-events-none"
                  />

                  <button
                    type="button"
                    disabled={primaryLikeBusy}
                    data-liked={primaryLiked ? 'true' : undefined}
                    onClick={(e) => void handleCardLikeClick(e, primaryPick.id)}
                    aria-label={
                      primaryLiked
                        ? `Unlike ${primaryPick.name} (${formatPluralCount(primaryPick.likesCount, 'like')})`
                        : `Like ${primaryPick.name} (${formatPluralCount(primaryPick.likesCount, 'like')})`
                    }
                    className={`like-pill-reveal hit-target-44 pressable absolute top-3.5 right-3.5 z-20 w-auto px-3 py-1.5 rounded-full text-xs font-mono-tabular flex items-center gap-1.5 transition-[transform,opacity,background-color,border-color] duration-180 ease-[cubic-bezier(0.165,0.84,0.44,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A] pointer-events-auto ${
                      primaryLikeBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                    } ${
                      primaryLiked
                        ? 'bg-[#D7E07A] text-[#17201B] font-semibold shadow-sm'
                        : 'bg-[#17201B]/72 backdrop-blur-md text-[#F5F3EC] border border-[#F5F3EC]/25 hover:bg-[#17201B]/90 hover:border-[#F5F3EC]/45'
                    }`}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 shrink-0 ${
                        primaryLiked ? 'fill-[#17201B] text-[#17201B]' : 'text-[#F5F3EC]'
                      }`}
                    />
                    <span className="tabular-nums-strict">{primaryPick.likesCount}</span>
                  </button>

                  <div className="absolute inset-x-0 bottom-0 z-10 p-6 sm:p-7 flex flex-col gap-2.5 pointer-events-none">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[#C9C5B8]">
                      <span>Curator Showcase</span>
                      <span aria-hidden="true">·</span>
                      <span>{primaryPick.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular tabular-nums-strict">
                        {formatPluralCount(primaryPick.ingredients.length, 'item')}
                      </span>
                    </div>

                    <div className="flex items-end justify-between gap-4">
                      <h3 className="font-display text-2xl sm:text-3xl font-light uppercase heading-tight text-[#F5F3EC] text-balance">
                        {primaryPick.name}
                      </h3>

                      <span className="font-mono-tabular text-xl sm:text-2xl font-semibold text-[#F5F3EC] whitespace-nowrap shrink-0 tabular-nums-strict">
                        {primaryPick.priceVerified && primaryPick.totalPurchaseCost !== null
                          ? formatPhpCurrency(primaryPick.totalPurchaseCost)
                          : 'Unverified'}
                      </span>
                    </div>

                    {primaryPick.tasteNotes && (
                      <p className="text-xs sm:text-sm text-[#F5F3EC]/85 leading-relaxed max-w-[65ch] line-clamp-2">
                        {primaryPick.tasteNotes}
                      </p>
                    )}
                  </div>
                </article>

                {/* Compact Single-Hand Mobile Shelf Rows */}
                <div className="lg:col-span-5 flex flex-col justify-between gap-5">
                  {shelfRows.map((pick) => {
                    const liked = hasLiked(pick.id);
                    const likeBusy = isLikePending(pick.id);

                    return (
                      <article
                        key={pick.id}
                        className="flex-1 group relative bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card-interactive rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3 sm:gap-4 text-left"
                      >
                        <button
                          type="button"
                          onClick={() => openDrink(pick.slug)}
                          aria-label={`View ${pick.name} details, ${formatPhpCurrency(
                            pick.totalPurchaseCost
                          )}`}
                          className="absolute inset-0 z-0 w-full h-full cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                        >
                          <span className="sr-only">View {pick.name} details</span>
                        </button>

                        <div className="flex items-center gap-3.5 sm:gap-4 min-w-0 flex-1 pointer-events-none">
                          <img
                            src={pick.photoUrl}
                            alt={pick.name}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover shrink-0 bg-[#17201B]"
                          />

                          <div className="min-w-0 space-y-1">
                            <div className="text-[11px] uppercase tracking-[0.06em] text-[#294735] dark:text-[#C9C5B8] font-medium truncate">
                              {pick.category} ·{' '}
                              <span className="font-mono-tabular tabular-nums-strict">
                                {formatPluralCount(pick.ingredients.length, 'item')}
                              </span>
                            </div>

                            <h3 className="text-sm sm:text-base font-semibold text-[#17201B] dark:text-[#F5F3EC] leading-snug line-clamp-2">
                              {pick.name}
                            </h3>

                            {pick.tasteNotes && (
                              <p className="hidden sm:line-clamp-2 text-xs text-[#17201B]/65 dark:text-[#C9C5B8] leading-relaxed">
                                {pick.tasteNotes}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="relative z-20 flex items-center gap-2 shrink-0 pointer-events-none">
                          <span className="font-mono-tabular text-sm sm:text-base font-semibold text-[#294735] dark:text-[#F5F3EC] whitespace-nowrap tabular-nums-strict">
                            {pick.priceVerified && pick.totalPurchaseCost !== null
                              ? formatPhpCurrency(pick.totalPurchaseCost)
                              : 'Unverified'}
                          </span>

                          <button
                            type="button"
                            disabled={likeBusy}
                            data-liked={liked ? 'true' : undefined}
                            onClick={(e) => void handleCardLikeClick(e, pick.id)}
                            aria-label={
                              liked
                                ? `Unlike ${pick.name} (${formatPluralCount(pick.likesCount, 'like')})`
                                : `Like ${pick.name} (${formatPluralCount(pick.likesCount, 'like')})`
                            }
                            className={`like-pill-reveal hit-target-44 pressable min-w-[44px] min-h-[44px] px-2.5 rounded-full text-xs font-mono-tabular flex items-center justify-center gap-1 transition-[transform,opacity,background-color,border-color] duration-180 ease-[cubic-bezier(0.165,0.84,0.44,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] pointer-events-auto ${
                              likeBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                            } ${
                              liked
                                ? 'bg-[#D7E07A] text-[#17201B] font-semibold shadow-sm'
                                : 'bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B]/80 dark:text-[#C9C5B8] border border-[#17201B]/12 dark:border-[#D7E07A]/16 hover:border-[#294735] dark:hover:border-[#F5F3EC]/45'
                            }`}
                          >
                            <Heart
                              className={`w-3.5 h-3.5 shrink-0 ${
                                liked ? 'fill-[#17201B] text-[#17201B]' : 'text-current'
                              }`}
                            />
                            <span className="tabular-nums-strict">{pick.likesCount}</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </section>

        {/* SECTION 3: Budget-Friendly Drinks — Preset Chips Filter & Tabular Cost Ledger */}
        <section aria-labelledby="heading-budget" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-4">
            <div>
              <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
                03. Verified Full-Unit Purchase Cost
              </p>
              <h2
                id="heading-budget"
                className="font-display text-2xl sm:text-3xl font-light uppercase heading-tight mt-1"
              >
                Budget-Friendly Drinks
              </h2>
            </div>
            <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8] max-w-[46ch] leading-relaxed">
              Tap your max checkout budget to see exact whole-bottle combinations at 7&#8209;Eleven Philippines.
            </p>
          </div>

          {/* Preset Price Chips + Category Pills + Sort Filter Bar */}
          <div
            role="region"
            aria-label="Budget filter controls"
            className="rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card p-4 sm:p-5 space-y-4"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1.5">
                <div className="font-mono-tabular text-[11px] uppercase tracking-[0.16em] text-[#17201B]/65 dark:text-[#C9C5B8]">
                  Max Budget
                </div>
                <div
                  role="group"
                  aria-label="Preset budget ceilings"
                  className="flex flex-wrap items-center gap-2"
                >
                  {BUDGET_PRESETS.map((preset) => {
                    const active = budgetMax === preset.value;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setBudgetMax(preset.value)}
                        className={`pressable min-h-[44px] px-4 rounded-full font-mono-tabular text-sm font-semibold cursor-pointer transition-[background-color,border-color,color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] ${
                          active
                            ? 'bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] shadow-sm'
                            : 'bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] border border-[#17201B]/14 dark:border-[#F5F3EC]/16 hover:border-[#294735] dark:hover:border-[#D7E07A]/50'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 pt-1 lg:pt-0">
                <div
                  aria-live="polite"
                  className="font-mono-tabular text-xs text-[#17201B]/70 dark:text-[#C9C5B8] tabular-nums-strict"
                >
                  <strong className="text-[#294735] dark:text-[#D7E07A] text-sm">
                    {formatPluralCount(budgetFriendly.length, 'drink')}
                  </strong>{' '}
                  {budgetMax !== null ? `≤ ₱${budgetMax}` : 'verified'}
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="budget-filter-sort"
                    className="font-mono-tabular text-[11px] uppercase tracking-wider text-[#17201B]/65 dark:text-[#C9C5B8]"
                  >
                    Sort
                  </label>
                  <select
                    id="budget-filter-sort"
                    value={budgetSort}
                    onChange={(e) => setBudgetSort(e.target.value as BudgetSortOption)}
                    className="min-h-[44px] px-3 py-2 rounded-lg bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/14 dark:border-[#F5F3EC]/16 text-base sm:text-xs font-mono-tabular text-[#17201B] dark:text-[#F5F3EC] focus:outline-none focus:border-[#294735] dark:focus:border-[#D7E07A]"
                  >
                    <option value="price_asc">Lowest Price</option>
                    <option value="popular">Most Liked</option>
                    <option value="newest">Newest</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#17201B]/10 dark:border-[#D7E07A]/12 flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={budgetCategory === 'ALL'}
                onClick={() => setBudgetCategory('ALL')}
                className={`pressable min-h-[44px] px-3.5 rounded-lg text-xs font-medium cursor-pointer transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] ${
                  budgetCategory === 'ALL'
                    ? 'bg-[#294735] text-[#F5F3EC] border border-[#294735] dark:border-[#D7E07A]/40'
                    : 'bg-[#F5F3EC] dark:bg-[#17201B]/65 text-[#17201B]/75 dark:text-[#C9C5B8] border border-[#17201B]/10 dark:border-[#F5F3EC]/10 hover:text-[#17201B] dark:hover:text-[#F5F3EC]'
                }`}
              >
                All Mixes
              </button>
              {APPROVED_CATEGORIES.map((cat) => {
                const active = budgetCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setBudgetCategory(cat)}
                    className={`pressable min-h-[44px] px-3.5 rounded-lg text-xs font-medium cursor-pointer transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] ${
                      active
                        ? 'bg-[#294735] text-[#F5F3EC] border border-[#294735] dark:border-[#D7E07A]/40'
                        : 'bg-[#F5F3EC] dark:bg-[#17201B]/65 text-[#17201B]/75 dark:text-[#C9C5B8] border border-[#17201B]/10 dark:border-[#F5F3EC]/10 hover:text-[#17201B] dark:hover:text-[#F5F3EC]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {budgetFriendly.length === 0 ? (
            <div
              role="status"
              className="min-h-[240px] rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] border border-dashed border-[#17201B]/20 dark:border-[#D7E07A]/25 p-6 sm:p-10 flex flex-col items-center justify-center text-center space-y-4"
            >
              <div className="w-11 h-11 rounded-full bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/12 dark:border-[#D7E07A]/25 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-[#294735] dark:text-[#D7E07A]" />
              </div>
              <div className="space-y-1.5 max-w-[46ch]">
                <h3 className="font-display text-xl sm:text-2xl font-light uppercase">
                  No Verified Mixes Under{' '}
                  <span className="font-mono-tabular text-[#294735] dark:text-[#D7E07A]">
                    {budgetMax !== null ? formatPhpCurrency(budgetMax) : 'Filter'}
                  </span>
                </h3>
                <p className="text-xs sm:text-sm text-[#17201B]/70 dark:text-[#C9C5B8] leading-relaxed">
                  7&#8209;Eleven combos calculate full sealed bottles and store ice cups at checkout. Try bumping your budget or resetting category filters.
                </p>
              </div>
              <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
                {budgetMax !== null && budgetMax < 100 && (
                  <button
                    type="button"
                    onClick={() => setBudgetMax(budgetMax < 75 ? 75 : 100)}
                    className="pressable min-h-[44px] px-4 py-2 rounded-lg bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] font-mono-tabular text-xs font-semibold uppercase tracking-wider cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                  >
                    Try Up to ₱{budgetMax < 75 ? 75 : 100}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setBudgetMax(null);
                    setBudgetCategory('ALL');
                    setBudgetSort('price_asc');
                  }}
                  className="pressable min-h-[44px] px-4 py-2 rounded-lg bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/16 dark:border-[#F5F3EC]/20 hover:border-[#294735] dark:hover:border-[#D7E07A]/50 font-mono-tabular text-xs uppercase tracking-wider inline-flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Filters</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-[240px] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
              {budgetFriendly.map((recipe, idx) => {
                const totalUnits = recipe.ingredients.reduce(
                  (sum, ing) => sum + Math.max(1, ing.unitsToPurchase),
                  0
                );
                return (
                  <article
                    key={recipe.id}
                    className="group relative bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card-interactive rounded-xl p-4 flex flex-col justify-between gap-4 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => openDrink(recipe.slug)}
                      aria-label={`View ${recipe.name} details, checkout total ${formatPhpCurrency(
                        recipe.totalPurchaseCost
                      )}`}
                      className="absolute inset-0 z-0 w-full h-full cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                    >
                      <span className="sr-only">View {recipe.name} details</span>
                    </button>

                    <div className="space-y-3 pointer-events-none">
                      <div className="flex items-center justify-between text-xs font-mono-tabular text-[#17201B]/60 dark:text-[#C9C5B8]">
                        <span className="truncate">
                          {String(idx + 1).padStart(2, '0')} · {recipe.category}
                        </span>
                        <span className="shrink-0 tabular-nums-strict">
                          {formatPluralCount(totalUnits, 'unit')}
                        </span>
                      </div>
                      <div className="aspect-4/3 w-full rounded-lg overflow-hidden bg-[#17201B]">
                        <img
                          src={recipe.photoUrl}
                          alt={recipe.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover hover-zoom-img"
                        />
                      </div>
                      <h3 className="text-base font-semibold text-[#17201B] dark:text-[#F5F3EC] leading-snug line-clamp-2">
                        {recipe.name}
                      </h3>
                    </div>

                    <div className="pt-3 border-t border-[#17201B]/10 dark:border-[#D7E07A]/12 flex items-baseline justify-between gap-2 pointer-events-none">
                      <span className="inline-flex items-center gap-1 font-mono-tabular text-xs text-[#17201B]/65 dark:text-[#C9C5B8] tabular-nums-strict">
                        <Heart className="w-3.5 h-3.5 text-[#294735] dark:text-[#D7E07A]" />
                        <span>{recipe.likesCount}</span>
                      </span>
                      <span className="font-mono-tabular text-base font-bold text-[#294735] dark:text-[#D7E07A] tabular-nums-strict">
                        {formatPhpCurrency(recipe.totalPurchaseCost)}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* SECTION 4 & 5: Leaderboard Favorites & Submitter Avatar Newest Feed */}
        <CommunityShowcaseSplit
          communityFavorites={communityFavorites}
          newestCreations={newestCreations}
          hasLiked={hasLiked}
          isLikePending={isLikePending}
          likeError={likeError}
          onToggleLike={(recipeId) => void handleLeaderboardLike(recipeId)}
          onOpenDrink={openDrink}
          onExploreAll={() => onNavigate({ page: 'explore' })}
        />
      </div>
    </div>
  );
};
