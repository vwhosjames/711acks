import React from 'react';
import { AlertTriangle, Bookmark, Info, RefreshCw, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { DrinkCard } from '../components/DrinkCard';
import { PublicRoute } from '../components/Navbar';

interface FavoritesPageProps {
  onNavigate: (route: PublicRoute) => void;
}

/**
 * Section 9 Requirements:
 * - Visitors do not need accounts.
 * - Use browser Local Storage to save Favorites.
 * - Add/Remove from Favorites.
 * - Dedicated Favorites page.
 * - Persist saved favorites across visits on the same browser.
 * - Explain that Favorites may not transfer between devices and can be lost when browser data is cleared.
 */
export const FavoritesPage: React.FC<FavoritesPageProps> = ({ onNavigate }) => {
  const {
    recipes,
    favorites,
    toggleFavorite,
    isLoadingData,
    dataError,
    refreshPublicData,
  } = useApp();

  const savedRecipes = recipes.filter(
    (r) => r.status === 'Published' && favorites.includes(r.id)
  );

  return (
    <div className="min-h-dvh bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-12 px-6">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header */}
        <div className="space-y-3 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-8">
          <p className="font-mono-tabular text-xs uppercase tracking-[0.24em] text-[#294735] dark:text-[#D7E07A]">
            PERSONAL BROWSER COLLECTION
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-light uppercase heading-tight">
            Saved Favorites
          </h1>
          <div className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl flex items-start gap-3 max-w-2xl">
            <Info className="w-4 h-4 text-[#294735] dark:text-[#D7E07A] shrink-0 mt-0.5" />
            <p className="text-xs text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
              No account or login is required. Your favorite drink hacks are saved directly in this browser&apos;s Local Storage. Because they are stored locally, Favorites do not transfer automatically between different devices and may be cleared if you reset your browser data.
            </p>
          </div>
        </div>

        {dataError && (
          <div
            role="alert"
            className="p-4 bg-red-500/10 border border-red-500/35 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Unable to load live recipes for your saved favorites: {dataError}</span>
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

        {/* Favorites Grid, Loading State, or Empty State */}
        {isLoadingData && savedRecipes.length === 0 && !dataError ? (
          <div
            role="status"
            className="bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl p-12 text-center max-w-lg mx-auto"
          >
            <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">
              Loading your saved drink hacks...
            </p>
          </div>
        ) : savedRecipes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
            {savedRecipes.map((recipe) => (
              <div key={recipe.id} className="flex flex-col gap-2.5">
                <DrinkCard
                  recipe={recipe}
                  onSelect={(slug) => {
                    onNavigate({ page: 'drink-detail', slug });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  showExtendedMeta
                />
                <button
                  type="button"
                  onClick={() => toggleFavorite(recipe.id)}
                  className="pressable min-h-[44px] py-2 px-3 text-xs font-medium text-[#17201B]/75 dark:text-[#C9C5B8] hover:text-red-600 dark:hover:text-red-400 border border-[#17201B]/12 dark:border-[#D7E07A]/14 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Remove from Favorites</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl p-12 text-center max-w-lg mx-auto space-y-4">
            <Bookmark className="w-8 h-8 text-[#294735] dark:text-[#D7E07A] mx-auto stroke-1" />
            <h2 className="font-display text-xl font-light uppercase heading-tight">
              No Saved Favorites Yet
            </h2>
            <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8] max-w-[44ch] mx-auto leading-relaxed">
              Bookmark any drink combination on its details page to build your personal quick-reference list for your next 7&#8209;Eleven run.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onNavigate({ page: 'explore' })}
                className="pressable min-h-[44px] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg cursor-pointer"
              >
                Explore Drink Hacks
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
