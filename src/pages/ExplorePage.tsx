import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { APPROVED_CATEGORIES, DrinkCategory, SortOption } from '../types/domain';
import { filterAndSortRecipes } from '../utils/drinkLogic';
import { DrinkCard } from '../components/DrinkCard';
import { PublicRoute } from '../components/Navbar';

interface ExplorePageProps {
  initialCategory?: string;
  initialSearch?: string;
  onNavigate: (route: PublicRoute) => void;
}

export const ExplorePage: React.FC<ExplorePageProps> = ({
  initialCategory,
  initialSearch = '',
  onNavigate,
}) => {
  const { recipes, isLoadingData, dataError, refreshPublicData } = useApp();

  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [selectedCategory, setSelectedCategory] = useState<DrinkCategory | 'ALL'>(() => {
    if (
      initialCategory &&
      (APPROVED_CATEGORIES as string[]).includes(initialCategory)
    ) {
      return initialCategory as DrinkCategory;
    }
    return 'ALL';
  });
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  const filteredRecipes = filterAndSortRecipes(recipes, {
    searchQuery,
    category: selectedCategory,
    sortBy,
    onlyPublished: true,
  });

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('ALL');
    setSortBy('newest');
  };

  return (
    <div className="min-h-screen bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-12 px-6">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header */}
        <div className="space-y-3 border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-8">
          <p className="font-mono-tabular text-xs uppercase tracking-[0.24em] text-[#294735] dark:text-[#D7E07A]">
            7-ELEVEN PHILIPPINES DRINK DIRECTORY
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-light uppercase tracking-[0.12em]">
            Explore Drink Hacks
          </h1>
          <p className="text-sm sm:text-base text-[#17201B]/75 dark:text-[#C9C5B8] max-w-2xl">
            Search by drink name or specific 7-Eleven ingredient (such as Kopiko Lucky Day, Chuckie, Yakult, or Mogu Mogu) and compare full single-trip purchase costs.
          </p>
        </div>

        {/* Search, Approved 3 Categories, and Sort Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#FFFFFF] dark:bg-[#1E2B23] p-4 rounded-md border border-[#C9C5B8]/60 dark:border-[#294735]">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <label htmlFor="explore-search-input" className="sr-only">
              Search by drink name or ingredient
            </label>
            <Search className="w-4 h-4 text-[#17201B]/50 dark:text-[#C9C5B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="explore-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search drink name or 7-Eleven product (e.g. Chuckie, Lychee)..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8]/60 dark:border-[#294735] rounded text-[#17201B] dark:text-[#F5F3EC] placeholder:text-[#17201B]/45 dark:placeholder:text-[#C9C5B8]/60 focus:outline-none focus:border-[#294735] dark:focus:border-[#D7E07A]"
            />
          </div>

          {/* Strictly Approved Three Primary Drink Categories */}
          <div
            role="group"
            aria-label="Filter by Primary Drink Category"
            className="flex flex-wrap items-center gap-1.5 bg-[#F5F3EC] dark:bg-[#17201B] p-1 rounded border border-[#C9C5B8]/40 dark:border-[#294735]"
          >
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] font-semibold'
                  : 'text-[#17201B]/75 dark:text-[#C9C5B8] hover:text-[#17201B] dark:hover:text-[#FFFFFF]'
              }`}
            >
              All Categories
            </button>
            {APPROVED_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] font-semibold'
                    : 'text-[#17201B]/75 dark:text-[#C9C5B8] hover:text-[#17201B] dark:hover:text-[#FFFFFF]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Sorting Selector */}
          <div className="flex items-center gap-2 shrink-0">
            <label
              htmlFor="explore-sort-select"
              className="text-xs font-medium text-[#17201B]/70 dark:text-[#C9C5B8] whitespace-nowrap"
            >
              Sort by:
            </label>
            <select
              id="explore-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-2 text-xs font-medium bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8]/60 dark:border-[#294735] rounded text-[#17201B] dark:text-[#F5F3EC] focus:outline-none focus:border-[#294735] dark:focus:border-[#D7E07A]"
            >
              <option value="newest">Newest</option>
              <option value="popular">Most Popular</option>
              <option value="price_asc">Lowest Price</option>
              <option value="price_desc">Highest Price</option>
            </select>
          </div>
        </div>

        {/* Results Count Summary */}
        <div className="flex items-center justify-between text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
          <span>
            Showing <strong className="font-mono-tabular">{filteredRecipes.length}</strong> published drink hack
            {filteredRecipes.length === 1 ? '' : 's'}
            {selectedCategory !== 'ALL' ? ` in ${selectedCategory}` : ''}
          </span>
          {(searchQuery.trim() !== '' || selectedCategory !== 'ALL' || sortBy !== 'newest') && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs font-medium text-[#294735] dark:text-[#D7E07A] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        {dataError && (
          <div
            role="alert"
            className="p-4 bg-red-500/10 border border-red-500/40 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Unable to load published drink recipes: {dataError}</span>
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

        {/* Drink Grid, Loading State, or Helpful Empty State */}
        {isLoadingData && filteredRecipes.length === 0 && !dataError ? (
          <div
            role="status"
            className="bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md p-12 text-center max-w-lg mx-auto space-y-2"
          >
            <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">
              Loading verified 7-Eleven drink combinations...
            </p>
          </div>
        ) : filteredRecipes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
            {filteredRecipes.map((recipe) => (
              <DrinkCard
                key={recipe.id}
                recipe={recipe}
                onSelect={(slug) => {
                  onNavigate({ page: 'drink-detail', slug });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md p-12 text-center max-w-lg mx-auto space-y-4">
            <h2 className="font-display text-xl font-light uppercase tracking-wider">
              No Matching Drink Hacks Found
            </h2>
            <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">
              {searchQuery.trim()
                ? `No published recipes matched "${searchQuery}". Try searching for another 7-Eleven product or clear your filters.`
                : `No drinks are currently published in ${selectedCategory}.`}
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
              >
                Reset All Filters
              </button>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'submit' })}
                className="px-4 py-2 text-xs font-medium border border-[#C9C5B8] dark:border-[#294735] rounded cursor-pointer"
              >
                Submit This Drink Hack
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
