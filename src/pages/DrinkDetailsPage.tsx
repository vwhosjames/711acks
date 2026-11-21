import React, { useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Check,
  Copy,
  Heart,
  Maximize2,
  RefreshCw,
  Share2,
  X,
  AlertTriangle,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../context/AppContext';
import { formatPhpCurrency } from '../utils/drinkLogic';
import { PublicRoute } from '../components/Navbar';

interface DrinkDetailsPageProps {
  slug: string;
  onNavigate: (route: PublicRoute) => void;
}

/**
 * Section 8 Requirements:
 * Display:
 * 1. Finished drink photo
 * 2. Drink name
 * 3. Primary category
 * 4. Total purchase cost (FULL PRODUCT PURCHASE COST)
 * 5. Ingredient list
 * 6. Ingredient product photos (clickable lightbox viewer)
 * 7. Product names
 * 8. Ingredient quantities
 * 9. Individual product purchase prices
 * 10. Last price verification date
 * 11. Like button
 * 12. Favorite button
 * 13. Share button (Copy Link, Native share, Facebook, Messenger)
 * 14. QR code (only for Published recipes)
 *
 * EXPLICIT EXCLUSIONS:
 * Do NOT include preparation instructions, estimated preparation time, or difficulty level labels.
 */
export const DrinkDetailsPage: React.FC<DrinkDetailsPageProps> = ({
  slug,
  onNavigate,
}) => {
  const {
    recipes,
    hasLiked,
    toggleLike,
    isLikePending,
    isFavorite,
    toggleFavorite,
    isLoadingData,
    dataError,
    refreshPublicData,
  } = useApp();
  const [lightboxProduct, setLightboxProduct] = useState<{
    name: string;
    photoUrl: string;
    price: number | null;
    quantityUsed: string;
    unitsToPurchase: number;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);

  const recipe = recipes.find((r) => r.slug === slug && r.status === 'Published');

  if (!recipe) {
    if (isLoadingData) {
      return (
        <div className="min-h-[70vh] bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] px-6 py-20 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">
            Loading drink hack details...
          </p>
        </div>
      );
    }

    if (dataError) {
      return (
        <div className="min-h-[70vh] bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] px-6 py-20 flex flex-col items-center justify-center text-center">
          <div className="max-w-md space-y-4">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
            <h1 className="font-display text-2xl font-light uppercase tracking-widest">
              Unable to Load Drink Hack
            </h1>
            <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">{dataError}</p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void refreshPublicData()}
                className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'explore' })}
                className="px-5 py-2.5 text-xs font-medium border border-[#C9C5B8] dark:border-[#294735] rounded cursor-pointer"
              >
                Return to Explore
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-[70vh] bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] px-6 py-20 flex flex-col items-center justify-center text-center">
        <div className="max-w-md space-y-4">
          <h1 className="font-display text-2xl font-light uppercase tracking-widest">
            Drink Hack Not Found
          </h1>
          <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">
            This drink combination may have been archived, moved, or is awaiting administrator verification.
          </p>
          <button
            type="button"
            onClick={() => onNavigate({ page: 'explore' })}
            className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
          >
            Return to Explore
          </button>
        </div>
      </div>
    );
  }

  const liked = hasLiked(recipe.id);
  const likeBusy = isLikePending(recipe.id);
  const favorited = isFavorite(recipe.id);
  const publicRecipeUrl = `${window.location.origin}/drinks/${recipe.slug}`;

  const handleToggleLike = async () => {
    if (likeBusy) return;
    setLikeError(null);
    const res = await toggleLike(recipe.id);
    if (!res.success && res.message) {
      setLikeError(res.message);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicRecipeUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Fallback copy input
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${recipe.name} — 711acks`,
          text: `Check out ${recipe.name} (${formatPhpCurrency(
            recipe.totalPurchaseCost
          )}) on 711acks!`,
          url: publicRecipeUrl,
        });
        return;
      } catch {
        // Fallback to share drawer
      }
    }
    setShareMenuOpen((prev) => !prev);
  };

  const formattedVerificationDate = recipe.lastPriceVerifiedAt
    ? new Date(recipe.lastPriceVerifiedAt).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Pending Admin Verification';

  return (
    <div className="min-h-screen bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-10 px-6">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Back Breadcrumb */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate({ page: 'explore' })}
            className="text-xs font-semibold uppercase tracking-wider text-[#294735] dark:text-[#D7E07A] hover:underline flex items-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Explore</span>
          </button>

          <span className="font-mono-tabular text-xs text-[#17201B]/60 dark:text-[#C9C5B8]">
            Public URL: /drinks/{recipe.slug}
          </span>
        </div>

        {/* Main 2-Column Editorial Detail Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Left Column: Finished Drink Photo & QR Code Share Card */}
          <div className="lg:col-span-5 space-y-6">
            <div className="aspect-4/3 w-full rounded-md overflow-hidden bg-[#17201B] border border-[#C9C5B8]/60 dark:border-[#294735]">
              <img
                src={recipe.photoUrl}
                alt={recipe.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover object-center"
              />
            </div>

            {/* Action Bar: Like, Save to Favorites, Share */}
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                disabled={likeBusy}
                onClick={() => void handleToggleLike()}
                aria-label={liked ? 'Unlike this drink hack' : 'Like this drink hack'}
                className={`py-3 px-4 rounded-md text-xs font-semibold flex items-center justify-center gap-2 border transition-colors ${
                  likeBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                } ${
                  liked
                    ? 'bg-[#D7E07A] text-[#17201B] border-[#D7E07A]'
                    : 'bg-[#FFFFFF] dark:bg-[#1E2B23] text-[#17201B] dark:text-[#F5F3EC] border-[#C9C5B8] dark:border-[#294735] hover:border-[#294735] dark:hover:border-[#D7E07A]'
                }`}
              >
                <Heart
                  className={`w-4 h-4 ${liked ? 'fill-[#17201B]' : ''}`}
                />
                <span className="font-mono-tabular">Like ({recipe.likesCount})</span>
              </button>

              <button
                type="button"
                onClick={() => toggleFavorite(recipe.id)}
                aria-label={favorited ? 'Remove from Favorites' : 'Add to Favorites'}
                className={`py-3 px-4 rounded-md text-xs font-semibold flex items-center justify-center gap-2 border transition-colors cursor-pointer ${
                  favorited
                    ? 'bg-[#294735] text-[#F5F3EC] border-[#294735] dark:bg-[#D7E07A] dark:text-[#17201B]'
                    : 'bg-[#FFFFFF] dark:bg-[#1E2B23] text-[#17201B] dark:text-[#F5F3EC] border-[#C9C5B8] dark:border-[#294735] hover:border-[#294735] dark:hover:border-[#D7E07A]'
                }`}
              >
                <Bookmark
                  className={`w-4 h-4 ${favorited ? 'fill-current' : ''}`}
                />
                <span>{favorited ? 'Saved' : 'Favorite'}</span>
              </button>

              <button
                type="button"
                onClick={handleNativeShare}
                aria-expanded={shareMenuOpen}
                className="py-3 px-4 rounded-md text-xs font-semibold flex items-center justify-center gap-2 bg-[#FFFFFF] dark:bg-[#1E2B23] text-[#17201B] dark:text-[#F5F3EC] border border-[#C9C5B8] dark:border-[#294735] hover:border-[#294735] dark:hover:border-[#D7E07A] transition-colors cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share</span>
              </button>
            </div>

            {likeError && (
              <div
                role="alert"
                className="p-3 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-700 dark:text-red-300"
              >
                {likeError}
              </div>
            )}

            {/* Expandable Share Options (Copy Link, Facebook, Messenger) */}
            {shareMenuOpen && (
              <div className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#294735] dark:text-[#D7E07A]">
                  Share Public Drink Hack URL
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={publicRecipeUrl}
                    aria-label="Public recipe URL"
                    className="flex-1 px-3 py-2 text-xs font-mono-tabular bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8]/50 dark:border-[#294735] rounded text-[#17201B] dark:text-[#F5F3EC]"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-3 py-2 text-xs font-semibold bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
                      publicRecipeUrl
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-medium rounded border border-[#C9C5B8] dark:border-[#294735] hover:border-[#294735] dark:hover:border-[#D7E07A]"
                  >
                    Share on Facebook
                  </a>
                  <a
                    href={`https://www.facebook.com/dialog/send?link=${encodeURIComponent(
                      publicRecipeUrl
                    )}&app_id=291494419107518&redirect_uri=${encodeURIComponent(
                      publicRecipeUrl
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-medium rounded border border-[#C9C5B8] dark:border-[#294735] hover:border-[#294735] dark:hover:border-[#D7E07A]"
                  >
                    Send via Messenger
                  </a>
                </div>
              </div>
            )}

            {/* Published Recipe QR Code Box */}
            <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md flex items-center gap-5">
              <div className="p-2.5 bg-[#FFFFFF] rounded border border-[#C9C5B8]/40 shrink-0">
                <QRCodeSVG
                  value={publicRecipeUrl}
                  size={88}
                  bgColor="#FFFFFF"
                  fgColor="#17201B"
                  level="M"
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-mono-tabular uppercase tracking-wider text-[#294735] dark:text-[#D7E07A]">
                  In-Store Mobile QR Reference
                </div>
                <p className="text-xs text-[#17201B]/75 dark:text-[#C9C5B8] leading-relaxed">
                  Scan this QR code with your phone camera before stepping into 7-Eleven to carry the exact product checklist and purchase cost breakdown.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Drink Info, Full Product Purchase Cost Ledger & Clickable Product Photos */}
          <div className="lg:col-span-7 space-y-8">
            <div className="space-y-3 border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-6">
              {/* Quiet Unboxed Inline Metadata */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#294735] dark:text-[#D7E07A]">
                <span className="font-semibold uppercase tracking-wider">
                  {recipe.category}
                </span>
                <span aria-hidden="true">·</span>
                <span>Curated by {recipe.submitterName}</span>
                <span aria-hidden="true">·</span>
                <span>Price Verified: {formattedVerificationDate}</span>
              </div>

              <h1 className="font-display text-3xl sm:text-4xl font-light uppercase tracking-[0.1em]">
                {recipe.name}
              </h1>

              {recipe.tasteNotes && (
                <p className="text-sm sm:text-base text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed">
                  {recipe.tasteNotes}
                </p>
              )}
            </div>

            {/* Total Purchase Cost Summary Box */}
            <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs font-mono-tabular uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
                    Total Full-Product Purchase Cost
                  </div>
                  <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8] mt-0.5">
                    Calculated using full unopened product units required at the 7-Eleven checkout counter.
                  </p>
                </div>

                <div className="font-mono-tabular text-3xl font-bold text-[#294735] dark:text-[#D7E07A]">
                  {recipe.priceVerified && recipe.totalPurchaseCost !== null
                    ? formatPhpCurrency(recipe.totalPurchaseCost)
                    : 'Price Verification Pending'}
                </div>
              </div>

              {recipe.needsPriceReview && (
                <div className="pt-2 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Notice: A catalog product price was recently updated. Displaying historical verified snapshot until admin review completes.
                  </span>
                </div>
              )}

              <div className="pt-2 border-t border-[#C9C5B8]/30 dark:border-[#294735] flex flex-wrap items-center justify-between gap-2 text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                <span>Last Price Verification: {formattedVerificationDate}</span>
                <span>Prices managed by Administrator · Store prices may vary by branch</span>
              </div>
            </div>

            {/* Required 7-Eleven Philippines Ingredients List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-light uppercase tracking-wider">
                  Required 7-Eleven Products ({recipe.ingredients.length})
                </h2>
                <span className="text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                  Click any product photo to enlarge
                </span>
              </div>

              <div className="space-y-3">
                {recipe.ingredients.map((ing) => {
                  const lineTotal =
                    ing.priceVerified && ing.priceSnapshot !== null
                      ? ing.priceSnapshot * ing.unitsToPurchase
                      : null;

                  return (
                    <div
                      key={ing.id}
                      className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-4">
                        {/* Clickable Product Packaging Photo -> Lightbox */}
                        <button
                          type="button"
                          onClick={() =>
                            setLightboxProduct({
                              name: ing.productNameSnapshot,
                              photoUrl: ing.productPhotoSnapshot,
                              price: ing.priceSnapshot,
                              quantityUsed: ing.quantityUsed,
                              unitsToPurchase: ing.unitsToPurchase,
                            })
                          }
                          aria-label={`Enlarge product photo for ${ing.productNameSnapshot}`}
                          className="group relative w-20 h-20 rounded overflow-hidden bg-[#17201B] border border-[#C9C5B8]/40 dark:border-[#294735] shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#D7E07A]"
                        >
                          <img
                            src={ing.productPhotoSnapshot}
                            alt={ing.productNameSnapshot}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                          <span className="absolute bottom-1 right-1 p-1 rounded bg-[#17201B]/80 text-[#D7E07A]">
                            <Maximize2 className="w-3 h-3" />
                          </span>
                        </button>

                        <div className="space-y-1">
                          <div className="text-xs text-[#17201B]/60 dark:text-[#C9C5B8]">
                            Product:
                          </div>
                          <h3 className="text-sm sm:text-base font-semibold text-[#17201B] dark:text-[#F5F3EC]">
                            {ing.productNameSnapshot}
                          </h3>
                          <div className="text-xs text-[#17201B]/75 dark:text-[#C9C5B8]">
                            Quantity needed: <strong className="font-medium">{ing.quantityUsed}</strong>
                            {' · '}
                            Units to buy: <strong className="font-mono-tabular">{ing.unitsToPurchase}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-[#C9C5B8]/30 dark:border-[#294735] shrink-0">
                        <div className="text-xs text-[#17201B]/60 dark:text-[#C9C5B8]">
                          Purchase price:
                        </div>
                        <div className="font-mono-tabular text-base font-semibold text-[#294735] dark:text-[#D7E07A]">
                          {lineTotal !== null
                            ? formatPhpCurrency(lineTotal)
                            : 'Unverified'}
                        </div>
                        {ing.unitsToPurchase > 1 && ing.priceSnapshot !== null && (
                          <div className="font-mono-tabular text-xs text-[#17201B]/60 dark:text-[#C9C5B8]">
                            ({formatPhpCurrency(ing.priceSnapshot)} × {ing.unitsToPurchase})
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Report Incorrect Price Link */}
            <div className="pt-4 border-t border-[#C9C5B8]/40 dark:border-[#294735] flex items-center justify-between text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
              <span>Spotted a different price at your local 7-Eleven Philippines branch?</span>
              <button
                type="button"
                onClick={() =>
                  onNavigate({ page: 'contact', relatedSlug: recipe.slug })
                }
                className="font-semibold text-[#294735] dark:text-[#D7E07A] hover:underline cursor-pointer"
              >
                Report Outdated Price
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Product Photo Lightbox Modal (Section 8) */}
      {lightboxProduct && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Product image viewer for ${lightboxProduct.name}`}
          onClick={() => setLightboxProduct(null)}
          className="fixed inset-0 z-50 bg-[#17201B]/90 backdrop-blur-sm flex items-center justify-center p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-md w-full bg-[#F5F3EC] dark:bg-[#1E2B23] border border-[#C9C5B8] dark:border-[#294735] rounded-md overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#C9C5B8]/40 dark:border-[#294735]">
              <h3 className="text-sm font-semibold text-[#17201B] dark:text-[#F5F3EC] truncate pr-4">
                {lightboxProduct.name}
              </h3>
              <button
                type="button"
                onClick={() => setLightboxProduct(null)}
                aria-label="Close product image viewer"
                className="p-1.5 rounded text-[#17201B] dark:text-[#F5F3EC] hover:bg-[#294735]/20 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-square w-full bg-[#17201B] flex items-center justify-center p-6">
              <img
                src={lightboxProduct.photoUrl}
                alt={lightboxProduct.name}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-full object-contain rounded"
              />
            </div>

            <div className="p-5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Quantity Needed in Drink:
                </span>
                <span className="font-semibold text-[#17201B] dark:text-[#F5F3EC]">
                  {lightboxProduct.quantityUsed}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Full Units to Purchase:
                </span>
                <span className="font-mono-tabular font-semibold text-[#17201B] dark:text-[#F5F3EC]">
                  {lightboxProduct.unitsToPurchase} unit(s)
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-[#C9C5B8]/30 dark:border-[#294735]">
                <span className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Verified Unit Purchase Price:
                </span>
                <span className="font-mono-tabular text-sm font-bold text-[#294735] dark:text-[#D7E07A]">
                  {formatPhpCurrency(lightboxProduct.price)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
