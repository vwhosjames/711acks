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
  AlertTriangle,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../context/AppContext';
import { formatPhpCurrency } from '../utils/drinkLogic';
import { formatPluralCount, formatSmartTimestamp } from '../utils/formatters';
import { PublicRoute } from '../components/Navbar';
import { SwipeableModal } from '../components/SwipeableModal';

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
        <div className="min-h-[70dvh] bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] px-6 py-20 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">
            Loading drink hack details...
          </p>
        </div>
      );
    }

    if (dataError) {
      return (
        <div className="min-h-[70dvh] bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] px-6 py-20 flex flex-col items-center justify-center text-center">
          <div className="max-w-md space-y-4">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
            <h1 className="font-display text-2xl font-light uppercase heading-tight">
              Unable to Load Drink Hack
            </h1>
            <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">{dataError}</p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void refreshPublicData()}
                className="pressable min-h-[44px] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'explore' })}
                className="pressable min-h-[44px] px-5 py-2.5 text-xs font-medium border border-[#17201B]/18 dark:border-[#D7E07A]/20 rounded-lg cursor-pointer hover-border-accent"
              >
                Return to Explore
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-[70dvh] bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] px-6 py-20 flex flex-col items-center justify-center text-center">
        <div className="max-w-md space-y-4">
          <h1 className="font-display text-2xl font-light uppercase heading-tight">
            Drink Hack Not Found
          </h1>
          <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">
            This drink combination may have been archived, moved, or is awaiting administrator verification.
          </p>
          <button
            type="button"
            onClick={() => onNavigate({ page: 'explore' })}
            className="pressable min-h-[44px] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg cursor-pointer"
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
    ? formatSmartTimestamp(recipe.lastPriceVerifiedAt)
    : 'Pending Admin Verification';

  return (
    <div className="min-h-dvh bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-10 px-6">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Back Breadcrumb */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onNavigate({ page: 'explore' })}
            className="pressable min-h-[44px] sm:min-h-0 text-xs font-semibold uppercase tracking-wider text-[#294735] dark:text-[#D7E07A] hover:underline underline-offset-4 flex items-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
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
            <div className="aspect-4/3 w-full rounded-xl overflow-hidden bg-[#17201B] surface-card">
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
                className={`pressable min-h-[44px] py-3 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] ${
                  likeBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                } ${
                  liked
                    ? 'bg-[#D7E07A] text-[#17201B] border-[#D7E07A]'
                    : 'bg-[#FFFFFF] dark:bg-[#1E2B23] text-[#17201B] dark:text-[#F5F3EC] border-[#17201B]/14 dark:border-[#D7E07A]/16 hover-border-accent'
                }`}
              >
                <Heart
                  className={`w-4 h-4 shrink-0 ${liked ? 'fill-[#17201B]' : ''}`}
                />
                <span className="font-mono-tabular">Like ({recipe.likesCount})</span>
              </button>

              <button
                type="button"
                onClick={() => toggleFavorite(recipe.id)}
                aria-label={favorited ? 'Remove from Favorites' : 'Add to Favorites'}
                className={`pressable min-h-[44px] py-3 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] ${
                  favorited
                    ? 'bg-[#294735] text-[#F5F3EC] border-[#294735] dark:bg-[#D7E07A] dark:text-[#17201B]'
                    : 'bg-[#FFFFFF] dark:bg-[#1E2B23] text-[#17201B] dark:text-[#F5F3EC] border-[#17201B]/14 dark:border-[#D7E07A]/16 hover-border-accent'
                }`}
              >
                <Bookmark
                  className={`w-4 h-4 shrink-0 ${favorited ? 'fill-current' : ''}`}
                />
                <span>{favorited ? 'Saved' : 'Favorite'}</span>
              </button>

              <button
                type="button"
                onClick={handleNativeShare}
                aria-expanded={shareMenuOpen}
                className="pressable min-h-[44px] py-3 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-[#FFFFFF] dark:bg-[#1E2B23] text-[#17201B] dark:text-[#F5F3EC] border border-[#17201B]/14 dark:border-[#D7E07A]/16 hover-border-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
              >
                <Share2 className="w-4 h-4 shrink-0" />
                <span>Share</span>
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

            {/* Expandable Share Options (Copy Link, Facebook, Messenger) */}
            {shareMenuOpen && (
              <div className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-3 origin-top">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#294735] dark:text-[#D7E07A]">
                  Share Public Drink Hack URL
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={publicRecipeUrl}
                    aria-label="Public recipe URL"
                    className="flex-1 min-h-[40px] px-3 py-2 text-base sm:text-xs font-mono-tabular bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/14 dark:border-[#D7E07A]/16 rounded-lg text-[#17201B] dark:text-[#F5F3EC]"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="pressable min-h-[40px] px-3 py-2 text-xs font-semibold bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 shrink-0" />
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
                    className="pressable min-h-[40px] inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-[#17201B]/16 dark:border-[#D7E07A]/18 hover-border-accent"
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
                    className="pressable min-h-[40px] inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-[#17201B]/16 dark:border-[#D7E07A]/18 hover-border-accent"
                  >
                    Send via Messenger
                  </a>
                </div>
              </div>
            )}

            {/* Published Recipe QR Code Box (concentric: rounded-xl outer -> p-5 -> rounded-lg QR wrap) */}
            <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl flex items-center gap-5">
              <div className="p-2.5 bg-[#FFFFFF] rounded-lg border border-[#17201B]/10 shrink-0">
                <QRCodeSVG
                  value={publicRecipeUrl}
                  size={88}
                  bgColor="#FFFFFF"
                  fgColor="#17201B"
                  level="M"
                />
              </div>
              <div className="space-y-1.5 min-w-0">
                <div className="text-xs font-mono-tabular uppercase tracking-wider text-[#294735] dark:text-[#D7E07A]">
                  In-Store Mobile QR Reference
                </div>
                <p className="text-xs text-[#17201B]/75 dark:text-[#C9C5B8] leading-relaxed max-w-[42ch]">
                  Scan this QR code with your phone camera before stepping into 7&#8209;Eleven to carry the exact product checklist and purchase cost breakdown.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Drink Info, Full Product Purchase Cost Ledger & Clickable Product Photos */}
          <div className="lg:col-span-7 space-y-8">
            <div className="space-y-3 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-6">
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

              <h1 className="font-display text-3xl sm:text-4xl font-light uppercase heading-tight">
                {recipe.name}
              </h1>

              {recipe.tasteNotes && (
                <p className="text-sm sm:text-base text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
                  {recipe.tasteNotes}
                </p>
              )}
            </div>

            {/* Total Purchase Cost Summary Box */}
            <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs font-mono-tabular uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
                    Total Full-Product Purchase Cost
                  </div>
                  <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8] mt-0.5 max-w-[54ch]">
                    Calculated using full unopened product units required at the 7&#8209;Eleven checkout counter.
                  </p>
                </div>

                <div className="font-mono-tabular text-3xl font-bold text-[#294735] dark:text-[#D7E07A] whitespace-nowrap shrink-0">
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

              <div className="pt-2 border-t border-[#17201B]/10 dark:border-[#D7E07A]/12 flex flex-wrap items-center justify-between gap-2 text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                <span>Last Price Verification: {formattedVerificationDate}</span>
                <span>Prices managed by Administrator · Store prices may vary by branch</span>
              </div>
            </div>

            {/* Required 7-Eleven Philippines Ingredients List */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xl font-light uppercase heading-tight">
                  Required 7&#8209;Eleven Products ({recipe.ingredients.length})
                </h2>
                <span className="text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                  Tap any product photo to enlarge
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
                      className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        {/* Clickable Product Packaging Photo -> Swipeable Lightbox */}
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
                          className="pressable group relative w-20 h-20 rounded-lg overflow-hidden bg-[#17201B] border border-[#17201B]/14 dark:border-[#D7E07A]/18 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                        >
                          <img
                            src={ing.productPhotoSnapshot}
                            alt={ing.productNameSnapshot}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            className="w-full h-full object-cover hover-zoom-img"
                          />
                          <span className="absolute bottom-1 right-1 p-1 rounded-md bg-[#17201B]/85 text-[#D7E07A]">
                            <Maximize2 className="w-3 h-3" />
                          </span>
                        </button>

                        <div className="space-y-1 min-w-0">
                          <div className="text-xs text-[#17201B]/60 dark:text-[#C9C5B8]">
                            Product:
                          </div>
                          <h3 className="text-sm sm:text-base font-semibold text-[#17201B] dark:text-[#F5F3EC]">
                            {ing.productNameSnapshot}
                          </h3>
                          <div className="text-xs text-[#17201B]/75 dark:text-[#C9C5B8]">
                            Quantity needed: <strong className="font-medium">{ing.quantityUsed}</strong>
                            {' · '}
                            Buy:{' '}
                            <strong className="font-mono-tabular">
                              {formatPluralCount(ing.unitsToPurchase, 'unit')}
                            </strong>
                          </div>
                        </div>
                      </div>

                      <div className="sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-[#17201B]/10 dark:border-[#D7E07A]/12 shrink-0">
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
            <div className="pt-4 border-t border-[#17201B]/10 dark:border-[#D7E07A]/12 flex flex-wrap items-center justify-between gap-2 text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
              <span>Spotted a different price at your local 7&#8209;Eleven Philippines branch?</span>
              <button
                type="button"
                onClick={() =>
                  onNavigate({ page: 'contact', relatedSlug: recipe.slug })
                }
                className="pressable min-h-[44px] sm:min-h-0 font-semibold text-[#294735] dark:text-[#D7E07A] hover:underline underline-offset-4 cursor-pointer"
              >
                Report Outdated Price
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Product Photo Lightbox Modal with 1:1 Vertical Swipe-to-Dismiss & Escape Support */}
      <SwipeableModal
        isOpen={Boolean(lightboxProduct)}
        onClose={() => setLightboxProduct(null)}
        ariaLabel={
          lightboxProduct
            ? `Product image viewer for ${lightboxProduct.name}`
            : 'Product image viewer'
        }
        title={lightboxProduct?.name}
        maxWidthClass="max-w-md"
      >
        {lightboxProduct && (
          <>
            <div className="aspect-square w-full bg-[#17201B] flex items-center justify-center p-6">
              <img
                src={lightboxProduct.photoUrl}
                alt={lightboxProduct.name}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            </div>

            <div className="p-5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Quantity Needed in Drink:
                </span>
                <span className="font-semibold text-[#17201B] dark:text-[#F5F3EC]">
                  {lightboxProduct.quantityUsed}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Full Units to Purchase:
                </span>
                <span className="font-mono-tabular font-semibold text-[#17201B] dark:text-[#F5F3EC]">
                  {formatPluralCount(lightboxProduct.unitsToPurchase, 'unit')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 pt-2 border-t border-[#17201B]/10 dark:border-[#D7E07A]/12">
                <span className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Verified Unit Purchase Price:
                </span>
                <span className="font-mono-tabular text-sm font-bold text-[#294735] dark:text-[#D7E07A]">
                  {formatPhpCurrency(lightboxProduct.price)}
                </span>
              </div>
            </div>
          </>
        )}
      </SwipeableModal>
    </div>
  );
};
