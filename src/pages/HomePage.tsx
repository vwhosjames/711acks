import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Heart, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { HeroFlashlight } from '../components/HeroFlashlight';
import { DrinkCard } from '../components/DrinkCard';
import { PublicRoute } from '../components/Navbar';
import { formatPhpCurrency } from '../utils/drinkLogic';

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

  const handleLeaderboardLike = async (recipeId: string) => {
    setLikeError(null);
    const res = await toggleLike(recipeId);
    if (!res.success && res.message) {
      setLikeError(res.message);
    }
  };

  const publishedRecipes = recipes.filter((r) => r.status === 'Published');

  // 1. Trending Drink Hacks (popular combinations based on engagement)
  const trendingDrinks = [...publishedRecipes]
    .filter((r) => r.isTrending)
    .sort((a, b) => b.likesCount - a.likesCount)
    .slice(0, 3);

  // 2. Newest Creations (recently published drink hacks)
  const newestCreations = [...publishedRecipes]
    .sort(
      (a, b) =>
        new Date(b.publishedAt || b.createdAt).getTime() -
        new Date(a.publishedAt || a.createdAt).getTime()
    )
    .slice(0, 3);

  // 3. Budget-Friendly Drinks (lowest verified total purchase costs)
  const budgetFriendly = [...publishedRecipes]
    .filter((r) => r.priceVerified && r.totalPurchaseCost !== null)
    .sort((a, b) => (a.totalPurchaseCost || 999) - (b.totalPurchaseCost || 999))
    .slice(0, 4);

  // 4. Community Favorites (recipes ranked by likes)
  const communityFavorites = [...publishedRecipes]
    .sort((a, b) => b.likesCount - a.likesCount)
    .slice(0, 4);

  // 5. Editor's Picks (recipes manually selected by administrator)
  const editorsPicks = publishedRecipes.filter((r) => r.isEditorsPick).slice(0, 3);

  const openDrink = (slug: string) => {
    onNavigate({ page: 'drink-detail', slug });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] transition-colors">
      {/* SECTION 0: Official Dual-Image Flashlight Hero */}
      <HeroFlashlight onNavigate={onNavigate} />

      <div className="max-w-7xl mx-auto px-6 py-16 space-y-24">
        {dataError && (
          <div
            role="alert"
            className="p-4 bg-red-500/10 border border-red-500/40 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Unable to load live drink recipes: {dataError}</span>
            </div>
            <button
              type="button"
              onClick={() => void refreshPublicData()}
              className="px-3 py-1.5 rounded border border-red-500/40 hover:bg-red-500/10 font-semibold flex items-center gap-1.5 self-start sm:self-auto cursor-pointer shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {isLoadingData && publishedRecipes.length === 0 && !dataError && (
          <div
            role="status"
            className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md text-center text-sm text-[#17201B]/75 dark:text-[#C9C5B8]"
          >
            Loading verified 7-Eleven drink combinations...
          </div>
        )}

        {/* SECTION 1: Trending Drink Hacks — 3-Column Editorial Showcase */}
        <section aria-labelledby="heading-trending" className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
            <div>
              <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
                01. High Engagement
              </p>
              <h2
                id="heading-trending"
                className="font-display text-2xl sm:text-3xl font-light uppercase tracking-[0.1em] mt-1"
              >
                Trending Drink Hacks
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'explore' })}
              className="text-xs font-semibold uppercase tracking-wider text-[#294735] dark:text-[#D7E07A] hover:underline flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
            >
              <span>Browse Full Archive</span>
              <ArrowRight className="w-3.5 h-3.5" />
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

        {/* SECTION 2: Editor's Picks — Asymmetric Editorial Split Feature */}
        <section aria-labelledby="heading-editors-picks" className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
            <div>
              <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
                02. Curated Selections
              </p>
              <h2
                id="heading-editors-picks"
                className="font-display text-2xl sm:text-3xl font-light uppercase tracking-[0.1em] mt-1"
              >
                Editor&apos;s Picks
              </h2>
            </div>
            <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8] max-w-sm">
              Hand-tested combinations chosen by the 711acks curator for flavor balance and exact single-trip convenience.
            </p>
          </div>

          {editorsPicks.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              {/* Primary Feature Card */}
              <div
                onClick={() => openDrink(editorsPicks[0].slug)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openDrink(editorsPicks[0].slug);
                  }
                }}
                className="lg:col-span-7 group bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md overflow-hidden flex flex-col justify-between cursor-pointer hover:border-[#294735] dark:hover:border-[#D7E07A]/60 transition-colors"
              >
                <div className="aspect-16/10 w-full bg-[#17201B] overflow-hidden relative">
                  <img
                    src={editorsPicks[0].photoUrl}
                    alt={editorsPicks[0].name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="p-6 space-y-3">
                  <div className="flex items-center gap-2 text-xs text-[#294735] dark:text-[#D7E07A]">
                    <span>{editorsPicks[0].category}</span>
                    <span aria-hidden="true">·</span>
                    <span>Curator Selection</span>
                    <span aria-hidden="true">·</span>
                    <span>{editorsPicks[0].ingredients.length} 7-Eleven items</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-display text-2xl font-light uppercase tracking-wider text-[#17201B] dark:text-[#F5F3EC]">
                      {editorsPicks[0].name}
                    </h3>
                    <span className="font-mono-tabular text-lg font-semibold text-[#294735] dark:text-[#D7E07A]">
                      {formatPhpCurrency(editorsPicks[0].totalPurchaseCost)}
                    </span>
                  </div>
                  {editorsPicks[0].tasteNotes && (
                    <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8] leading-relaxed">
                      {editorsPicks[0].tasteNotes}
                    </p>
                  )}
                </div>
              </div>

              {/* Secondary Stacked Editorial Picks */}
              <div className="lg:col-span-5 flex flex-col justify-between gap-6">
                {editorsPicks.slice(1).map((pick) => (
                  <div
                    key={pick.id}
                    onClick={() => openDrink(pick.slug)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openDrink(pick.slug);
                      }
                    }}
                    className="flex-1 group bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md p-4 flex items-center gap-5 cursor-pointer hover:border-[#294735] dark:hover:border-[#D7E07A]/60 transition-colors"
                  >
                    <img
                      src={pick.photoUrl}
                      alt={pick.name}
                      referrerPolicy="no-referrer"
                      className="w-28 h-28 rounded object-cover shrink-0 bg-[#17201B]"
                    />
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="text-xs text-[#294735] dark:text-[#D7E07A]">
                        {pick.category} · {pick.ingredients.length} items
                      </div>
                      <h3 className="text-base font-semibold text-[#17201B] dark:text-[#F5F3EC] truncate">
                        {pick.name}
                      </h3>
                      <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8] line-clamp-2">
                        {pick.tasteNotes}
                      </p>
                      <div className="pt-1 font-mono-tabular text-sm font-semibold text-[#294735] dark:text-[#D7E07A]">
                        Total Purchase Cost: {formatPhpCurrency(pick.totalPurchaseCost)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* SECTION 3: Budget-Friendly Drinks — Tabular Cost Ledger Composition */}
        <section aria-labelledby="heading-budget" className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
            <div>
              <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
                03. Verified Full-Unit Purchase Cost
              </p>
              <h2
                id="heading-budget"
                className="font-display text-2xl sm:text-3xl font-light uppercase tracking-[0.1em] mt-1"
              >
                Budget-Friendly Drinks
              </h2>
            </div>
            <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8] max-w-md">
              Ranked by lowest verified total checkout cost at 7-Eleven Philippines (charging full bottles/packs required at the counter).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {budgetFriendly.map((recipe, idx) => (
              <div
                key={recipe.id}
                onClick={() => openDrink(recipe.slug)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openDrink(recipe.slug);
                  }
                }}
                className="bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md p-5 flex flex-col justify-between gap-4 cursor-pointer hover:border-[#294735] dark:hover:border-[#D7E07A]/60 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono-tabular text-[#17201B]/60 dark:text-[#C9C5B8]">
                    <span>0{idx + 1} · {recipe.category}</span>
                    <span>{recipe.ingredients.length} units</span>
                  </div>
                  <div className="aspect-4/3 w-full rounded overflow-hidden bg-[#17201B]">
                    <img
                      src={recipe.photoUrl}
                      alt={recipe.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <h3 className="text-base font-semibold text-[#17201B] dark:text-[#F5F3EC]">
                    {recipe.name}
                  </h3>
                </div>

                <div className="pt-3 border-t border-[#C9C5B8]/30 dark:border-[#294735] flex items-baseline justify-between">
                  <span className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
                    Full Checkout Total
                  </span>
                  <span className="font-mono-tabular text-base font-bold text-[#294735] dark:text-[#D7E07A]">
                    {formatPhpCurrency(recipe.totalPurchaseCost)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 4 & 5: Two-Column Editorial Split — Community Favorites & Newest Creations */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* SECTION 4: Community Favorites (Ranked Leaderboard by Likes) */}
          <section
            aria-labelledby="heading-community-favorites"
            className="lg:col-span-6 space-y-6"
          >
            <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
              <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
                04. Ranked By Anonymous Likes
              </p>
              <h2
                id="heading-community-favorites"
                className="font-display text-2xl font-light uppercase tracking-[0.1em] mt-1"
              >
                Community Favorites
              </h2>
            </div>

            {likeError && (
              <div
                role="alert"
                className="p-3 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-700 dark:text-red-300"
              >
                {likeError}
              </div>
            )}

            <div className="divide-y divide-[#C9C5B8]/40 dark:divide-[#294735] bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md">
              {communityFavorites.map((recipe, index) => {
                const liked = hasLiked(recipe.id);
                const likeBusy = isLikePending(recipe.id);
                return (
                  <div
                    key={recipe.id}
                    className="p-4 flex items-center justify-between gap-4 hover:bg-[#F5F3EC]/50 dark:hover:bg-[#294735]/20 transition-colors"
                  >
                    <div
                      onClick={() => openDrink(recipe.slug)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openDrink(recipe.slug);
                        }
                      }}
                      className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer"
                    >
                      <span className="font-mono-tabular text-sm font-semibold text-[#294735] dark:text-[#D7E07A] w-6 shrink-0">
                        0{index + 1}
                      </span>
                      <img
                        src={recipe.photoUrl}
                        alt={recipe.name}
                        referrerPolicy="no-referrer"
                        className="w-14 h-14 rounded object-cover shrink-0 bg-[#17201B]"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-[#17201B] dark:text-[#F5F3EC] truncate">
                          {recipe.name}
                        </h3>
                        <p className="text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                          {recipe.category} · {formatPhpCurrency(recipe.totalPurchaseCost)}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={likeBusy}
                      onClick={() => void handleLeaderboardLike(recipe.id)}
                      aria-label={`Like ${recipe.name}`}
                      className={`px-3 py-1.5 rounded text-xs font-mono-tabular flex items-center gap-1.5 shrink-0 ${
                        likeBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                      } ${
                        liked
                          ? 'bg-[#D7E07A] text-[#17201B] font-semibold'
                          : 'border border-[#C9C5B8] dark:border-[#294735] text-[#17201B] dark:text-[#F5F3EC] hover:border-[#294735] dark:hover:border-[#D7E07A]'
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          liked ? 'fill-[#17201B] text-[#17201B]' : ''
                        }`}
                      />
                      <span>{recipe.likesCount}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SECTION 5: Newest Creations (Recently Published) */}
          <section aria-labelledby="heading-newest" className="lg:col-span-6 space-y-6">
            <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
              <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#294735] dark:text-[#D7E07A]">
                05. Freshly Verified
              </p>
              <h2
                id="heading-newest"
                className="font-display text-2xl font-light uppercase tracking-[0.1em] mt-1"
              >
                Newest Creations
              </h2>
            </div>

            <div className="space-y-4">
              {newestCreations.map((recipe) => (
                <div
                  key={recipe.id}
                  onClick={() => openDrink(recipe.slug)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openDrink(recipe.slug);
                    }
                  }}
                  className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md flex items-center justify-between gap-4 cursor-pointer hover:border-[#294735] dark:hover:border-[#D7E07A]/60 transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <img
                      src={recipe.photoUrl}
                      alt={recipe.name}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded object-cover shrink-0 bg-[#17201B]"
                    />
                    <div className="space-y-1 min-w-0">
                      <div className="text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                        {recipe.category} · Submitted by {recipe.submitterName}
                      </div>
                      <h3 className="text-base font-semibold text-[#17201B] dark:text-[#F5F3EC] truncate">
                        {recipe.name}
                      </h3>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono-tabular text-sm font-semibold text-[#294735] dark:text-[#D7E07A]">
                      {formatPhpCurrency(recipe.totalPurchaseCost)}
                    </div>
                    <div className="text-xs text-[#17201B]/60 dark:text-[#C9C5B8]">
                      {recipe.ingredients.length} items
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
