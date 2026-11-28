import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  Check,
  Clock,
  Copy,
  CupSoda,
  Download,
  Flag,
  Heart,
  Info,
  Maximize2,
  QrCode,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../context/AppContext';
import { RecipeIngredient } from '../types/domain';
import { formatPhpCurrency } from '../utils/drinkLogic';
import {
  buildChecklistPlainText,
  downloadCheckoutCardPng,
  getPriceVerificationSummary,
  parseProductDisplay,
} from '../utils/drinkDetailHelpers';
import { formatPluralCount } from '../utils/formatters';
import { PublicRoute } from '../components/Navbar';
import { SwipeableModal } from '../components/SwipeableModal';

interface DrinkDetailsPageProps {
  slug: string;
  onNavigate: (route: PublicRoute) => void;
}

/**
 * Resilient bright-stage packaging thumbnail so store shelves are instantly
 * recognizable and broken image URLs degrade gracefully.
 */
const ProductPhotoThumb: React.FC<{
  src: string;
  alt: string;
  onEnlarge: () => void;
}> = ({ src, alt, onEnlarge }) => {
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    setFailed(!src);
  }, [src]);

  return (
    <button
      type="button"
      onClick={onEnlarge}
      aria-label={`Enlarge photo for ${alt}`}
      className="pressable group relative w-[84px] h-[84px] rounded-xl overflow-hidden bg-[#F5F3EC] dark:bg-[#F5F3EC]/95 border border-[#17201B]/15 dark:border-[#D7E07A]/30 shrink-0 cursor-pointer flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
    >
      {failed ? (
        <div className="flex flex-col items-center justify-center gap-1 text-[#294735]">
          <CupSoda size={24} strokeWidth={1.7} aria-hidden="true" />
          <span className="text-[10px] font-mono-tabular uppercase tracking-wider">
            No photo
          </span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover brightness-[1.06] contrast-[1.03] hover-zoom-img"
        />
      )}

      <span
        aria-hidden="true"
        className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-md bg-[#17201B]/85 text-[#D7E07A] flex items-center justify-center shadow-sm"
      >
        <Maximize2 size={12} strokeWidth={2.2} />
      </span>
    </button>
  );
};

const SafeDrinkThumb: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className = 'w-full h-full object-cover' }) => {
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    setFailed(!src);
  }, [src]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} placeholder`}
        className="w-full h-full flex items-center justify-center bg-[#1E2B23] text-[#D7E07A]"
      >
        <CupSoda size={24} strokeWidth={1.6} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

/**
 * Promoted Checklist-First Drink Detail Page:
 * Surfaces the tickable 7-Eleven shelf checklist and clear "Total at checkout"
 * on first screen for hurried mobile shoppers, separates "Buy X" vs "use ½"
 * units, fixes AA contrast, and limits QR display strictly to desktop pointers.
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

  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [lightboxIngredient, setLightboxIngredient] = useState<RecipeIngredient | null>(
    null
  );
  const [copiedChecklist, setCopiedChecklist] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [utilityFeedback, setUtilityFeedback] = useState<string | null>(null);
  const [likeError, setLikeError] = useState<string | null>(null);

  const recipe = recipes.find((r) => r.slug === slug && r.status === 'Published');

  if (!recipe) {
    if (isLoadingData) {
      return (
        <div className="min-h-[70dvh] bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] px-6 py-20 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-[#17201B]/80 dark:text-[#C9C5B8]">
            Loading drink mix checklist...
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
              Unable to Load Drink Mix
            </h1>
            <p className="text-sm text-[#17201B]/80 dark:text-[#C9C5B8]">{dataError}</p>
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
                Back to Explore
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
            Drink Mix Not Found
          </h1>
          <p className="text-sm text-[#17201B]/80 dark:text-[#C9C5B8]">
            This drink combination may have been archived or is not currently listed.
          </p>
          <button
            type="button"
            onClick={() => onNavigate({ page: 'explore' })}
            className="pressable min-h-[44px] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg cursor-pointer"
          >
            Back to Explore
          </button>
        </div>
      </div>
    );
  }

  const liked = hasLiked(recipe.id);
  const likeBusy = isLikePending(recipe.id);
  const saved = isFavorite(recipe.id);
  const publicRecipeUrl = `${window.location.origin}/drinks/${recipe.slug}`;
  const priceMeta = getPriceVerificationSummary(
    recipe.lastPriceVerifiedAt,
    recipe.priceVerified
  );
  const curatorLabel = recipe.submitterName.trim() || 'Anonymous';
  const checkedCount = recipe.ingredients.filter((i) => checkedIds[i.id]).length;

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleLike = async () => {
    if (likeBusy) return;
    setLikeError(null);
    const res = await toggleLike(recipe.id);
    if (!res.success && res.message) {
      setLikeError(res.message);
    }
  };

  const handleCopyChecklist = async () => {
    const text = buildChecklistPlainText(recipe, checkedIds);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore permission failure in preview environments
    }
    setCopiedChecklist(true);
    setUtilityFeedback('Shopping checklist copied.');
    window.setTimeout(() => setCopiedChecklist(false), 2000);
  };

  const handleSaveAsImage = () => {
    const ok = downloadCheckoutCardPng(recipe);
    setUtilityFeedback(
      ok ? 'Downloaded checkout PNG checklist.' : 'Unable to save PNG image.'
    );
  };

  const handleShareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${recipe.name} — 711acks`,
          text: `${recipe.name} (${formatPhpCurrency(recipe.totalPurchaseCost)})`,
          url: publicRecipeUrl,
        });
        return;
      } catch {
        // Fallback to Share drawer
      }
    }
    setShareOpen((prev) => !prev);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicRecipeUrl);
    } catch {
      // Ignore permission failure
    }
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 2000);
  };

  const lightboxParsed = lightboxIngredient
    ? parseProductDisplay(lightboxIngredient)
    : null;
  const lightboxTotal =
    lightboxIngredient &&
    lightboxIngredient.priceVerified &&
    lightboxIngredient.priceSnapshot !== null
      ? lightboxIngredient.priceSnapshot * lightboxIngredient.unitsToPurchase
      : null;

  return (
    <div className="min-h-dvh bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-8 sm:py-10 px-4 sm:px-6 pb-28 lg:pb-14">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Compact Header (zero leaked dev URL) */}
        <header className="space-y-4 border-b border-[#17201B]/12 dark:border-[#D7E07A]/15 pb-5">
          <button
            type="button"
            onClick={() => onNavigate({ page: 'explore' })}
            className="pressable min-h-[44px] inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#294735] dark:text-[#D7E07A] hover:underline underline-offset-4 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Back to Explore</span>
          </button>

          <div className="flex items-start gap-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-[#17201B] border border-[#17201B]/12 dark:border-[#D7E07A]/20 shrink-0">
              <SafeDrinkThumb src={recipe.photoUrl} alt={recipe.name} />
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular">
                <span className="font-semibold uppercase tracking-wider text-[#294735] dark:text-[#D7E07A]">
                  {recipe.category}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[#17201B]/80 dark:text-[#C9C5B8] truncate">
                  By {curatorLabel}
                </span>
              </div>

              <h1 className="font-display text-2xl sm:text-4xl font-light uppercase heading-tight text-[#17201B] dark:text-[#F5F3EC]">
                {recipe.name}
              </h1>

              {recipe.tasteNotes && (
                <p className="text-sm sm:text-base text-[#17201B]/80 dark:text-[#C9C5B8] max-w-[65ch] leading-relaxed">
                  {recipe.tasteNotes}
                </p>
              )}
            </div>
          </div>

          {/* Single Verification Status Line + Option (i) Separate Like & Save */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
            <div className="space-y-1">
              <p
                className={`inline-flex items-center gap-1.5 text-xs font-mono-tabular ${
                  priceMeta.isStale || priceMeta.isUnverified
                    ? 'text-[#7C4D00] dark:text-[#E7C266]'
                    : 'text-[#17201B]/80 dark:text-[#C9C5B8]'
                }`}
              >
                {priceMeta.isStale ? (
                  <Clock size={13} aria-hidden="true" className="shrink-0" />
                ) : (
                  <Info size={13} aria-hidden="true" className="shrink-0" />
                )}
                <span>{priceMeta.singleLine}</span>
              </p>

              {recipe.needsPriceReview && (
                <p className="text-xs font-mono-tabular text-[#7C4D00] dark:text-[#E7C266]">
                  One shelf item changed price recently · verify tag at counter
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={likeBusy}
                aria-pressed={liked}
                title="Like — boosts this mix in Community Favorites"
                aria-label={`${liked ? 'Unlike' : 'Like'} ${recipe.name} (${formatPluralCount(
                  recipe.likesCount,
                  'like'
                )})`}
                onClick={() => void handleToggleLike()}
                className={`pressable min-h-[44px] px-3.5 rounded-xl text-xs font-mono-tabular font-semibold inline-flex items-center gap-1.5 border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] ${
                  likeBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                } ${
                  liked
                    ? 'bg-[#D7E07A] text-[#17201B] border-[#D7E07A]'
                    : 'bg-[#FFFFFF] dark:bg-[#1E2B23] text-[#17201B] dark:text-[#F5F3EC] border-[#17201B]/20 dark:border-[#D7E07A]/25 hover:border-[#294735] dark:hover:border-[#D7E07A]'
                }`}
              >
                <Heart
                  size={15}
                  className={liked ? 'fill-current shrink-0' : 'shrink-0'}
                  aria-hidden="true"
                />
                <span className="tabular-nums-strict">
                  {recipe.likesCount.toLocaleString('en-US')}
                </span>
              </button>

              <button
                type="button"
                aria-pressed={saved}
                title="Save — keeps this drink in your personal store list"
                onClick={() => toggleFavorite(recipe.id)}
                className={`pressable min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] ${
                  saved
                    ? 'bg-[#294735] text-[#D7E07A] border-[#294735] dark:bg-[#F5F3EC] dark:text-[#17201B] dark:border-[#F5F3EC]'
                    : 'bg-[#FFFFFF] dark:bg-[#1E2B23] text-[#17201B] dark:text-[#F5F3EC] border-[#17201B]/20 dark:border-[#D7E07A]/25 hover:border-[#294735] dark:hover:border-[#D7E07A]'
                }`}
              >
                <Bookmark
                  size={15}
                  className={saved ? 'fill-current shrink-0' : 'shrink-0'}
                  aria-hidden="true"
                />
                <span>{saved ? 'Saved for trip' : 'Save for trip'}</span>
              </button>
            </div>
          </div>

          {likeError && (
            <div
              role="alert"
              className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-xs text-red-700 dark:text-red-300"
            >
              {likeError}
            </div>
          )}
        </header>

        {/* Primary 12-Col Grid: Tickable Checklist Hero (left) + Total & Actions Rail (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Hero Shelf Checklist */}
          <section
            aria-labelledby="heading-shelf-checklist"
            className="lg:col-span-8 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="heading-shelf-checklist"
                className="font-display text-xl font-light uppercase heading-tight text-[#17201B] dark:text-[#F5F3EC]"
              >
                In-Store Shelf Checklist ({recipe.ingredients.length})
              </h2>
              <span className="font-mono-tabular text-xs font-semibold text-[#294735] dark:text-[#D7E07A] tabular-nums-strict">
                {checkedCount}/{recipe.ingredients.length} checked
              </span>
            </div>

            <ul className="space-y-3">
              {recipe.ingredients.map((ing) => {
                const isChecked = Boolean(checkedIds[ing.id]);
                const parsed = parseProductDisplay(ing);
                const lineTotal =
                  ing.priceVerified && ing.priceSnapshot !== null
                    ? ing.priceSnapshot * ing.unitsToPurchase
                    : null;

                return (
                  <li key={ing.id}>
                    <div
                      className={`p-3.5 sm:p-4 rounded-xl border transition-[background-color,border-color,opacity] duration-150 flex items-center gap-3 sm:gap-4 ${
                        isChecked
                          ? 'bg-[#294735]/[0.06] dark:bg-[#1E2B23]/60 border-[#294735]/35 dark:border-[#D7E07A]/35 opacity-80'
                          : 'bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card border-[#17201B]/12 dark:border-[#D7E07A]/18'
                      }`}
                    >
                      <label className="min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer shrink-0 -ml-1">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleChecked(ing.id)}
                          aria-label={`Mark ${parsed.title} picked up`}
                          className="sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${
                            isChecked
                              ? 'checklist-tick-pop bg-[#294735] dark:bg-[#D7E07A] border-[#294735] dark:border-[#D7E07A] text-[#D7E07A] dark:text-[#17201B]'
                              : 'bg-[#F5F3EC] dark:bg-[#17201B] border-[#17201B]/30 dark:border-[#F5F3EC]/35'
                          }`}
                        >
                          {isChecked && <Check size={15} strokeWidth={2.5} />}
                        </span>
                      </label>

                      <ProductPhotoThumb
                        src={ing.productPhotoSnapshot}
                        alt={parsed.title}
                        onEnlarge={() => setLightboxIngredient(ing)}
                      />

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3
                            className={`text-sm sm:text-base font-semibold text-[#17201B] dark:text-[#F5F3EC] leading-snug ${
                              isChecked ? 'line-through opacity-75' : ''
                            }`}
                          >
                            {parsed.title}
                          </h3>
                          <span className="font-mono-tabular text-base font-bold text-[#294735] dark:text-[#D7E07A] shrink-0 tabular-nums-strict">
                            {lineTotal !== null
                              ? formatPhpCurrency(lineTotal)
                              : 'Unverified'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {parsed.sizeLabel && (
                            <span className="font-mono-tabular text-[#17201B]/80 dark:text-[#C9C5B8]">
                              {parsed.sizeLabel}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded bg-[#294735] text-[#D7E07A] font-mono-tabular text-[11px] font-bold">
                            Buy {ing.unitsToPurchase}
                          </span>
                          {parsed.partialUseChip && (
                            <span className="px-2 py-0.5 rounded-full border border-[#17201B]/25 dark:border-[#C9C5B8]/35 text-[#17201B] dark:text-[#F5F3EC] font-mono-tabular text-[11px]">
                              {parsed.partialUseChip}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Right Summary Rail & Phone-Friendly Utilities */}
          <aside className="lg:col-span-4 space-y-5">
            <div className="p-5 rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card border border-[#17201B]/12 dark:border-[#D7E07A]/20 space-y-3">
              <span className="block font-mono-tabular text-xs uppercase tracking-[0.18em] text-[#294735] dark:text-[#D7E07A]">
                Total at checkout
              </span>
              <div className="font-mono-tabular text-4xl font-bold text-[#294735] dark:text-[#D7E07A] tabular-nums-strict">
                {recipe.priceVerified && recipe.totalPurchaseCost !== null
                  ? formatPhpCurrency(recipe.totalPurchaseCost)
                  : 'Price Pending'}
              </div>
              <p className="text-xs text-[#17201B]/80 dark:text-[#C9C5B8]">
                Like boosts ranking · Save keeps this mix for store runs.
              </p>
            </div>

            {/* Phone Utilities: Copy Checklist, Save PNG, Share URL, Desktop-Only QR */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyChecklist()}
                  className="pressable min-h-[44px] px-3.5 rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#17201B]/18 dark:border-[#D7E07A]/22 text-xs font-medium text-[#17201B] dark:text-[#F5F3EC] inline-flex items-center gap-1.5 hover:border-[#294735] dark:hover:border-[#D7E07A] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                >
                  {copiedChecklist ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                  <span>{copiedChecklist ? 'Checklist copied' : 'Copy checklist'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveAsImage}
                  className="pressable min-h-[44px] px-3.5 rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#17201B]/18 dark:border-[#D7E07A]/22 text-xs font-medium text-[#17201B] dark:text-[#F5F3EC] inline-flex items-center gap-1.5 hover:border-[#294735] dark:hover:border-[#D7E07A] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                >
                  <Download size={14} aria-hidden="true" />
                  <span>Save as image</span>
                </button>

                <button
                  type="button"
                  aria-expanded={shareOpen}
                  onClick={() => void handleShareLink()}
                  className="pressable min-h-[44px] px-3.5 rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#17201B]/18 dark:border-[#D7E07A]/22 text-xs font-medium text-[#17201B] dark:text-[#F5F3EC] inline-flex items-center gap-1.5 hover:border-[#294735] dark:hover:border-[#D7E07A] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                >
                  <Share2 size={14} aria-hidden="true" />
                  <span>Share link</span>
                </button>

                <button
                  type="button"
                  aria-expanded={qrOpen}
                  onClick={() => setQrOpen((v) => !v)}
                  className="desktop-pointer-qr pressable min-h-[44px] px-3 rounded-xl bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/15 dark:border-[#D7E07A]/20 text-xs font-mono-tabular text-[#17201B]/80 dark:text-[#C9C5B8] items-center gap-1.5 hover:text-[#17201B] dark:hover:text-[#F5F3EC] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                >
                  <QrCode size={14} aria-hidden="true" />
                  <span>{qrOpen ? 'Hide QR' : 'Send to phone'}</span>
                </button>
              </div>

              {utilityFeedback && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-xs font-mono-tabular text-[#294735] dark:text-[#D7E07A]"
                >
                  {utilityFeedback}
                </p>
              )}

              {shareOpen && (
                <div className="p-4 rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card border border-[#17201B]/15 dark:border-[#D7E07A]/20 space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono-tabular uppercase tracking-wider text-[#294735] dark:text-[#D7E07A]">
                    <span>Public Drink Link</span>
                    <button
                      type="button"
                      onClick={() => setShareOpen(false)}
                      aria-label="Close share options"
                      className="p-1 text-[#17201B]/80 dark:text-[#C9C5B8] cursor-pointer"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={publicRecipeUrl}
                      aria-label="Public recipe URL"
                      className="flex-1 min-h-[40px] px-3 py-2 rounded-lg bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/15 dark:border-[#D7E07A]/20 text-xs font-mono-tabular text-[#17201B] dark:text-[#F5F3EC]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCopyUrl()}
                      className="pressable min-h-[40px] px-3 rounded-lg bg-[#294735] text-[#D7E07A] text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      {copiedUrl ? 'Copied' : 'Copy URL'}
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
                      Facebook
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
                      Messenger
                    </a>
                  </div>
                </div>
              )}

              {qrOpen && (
                <div className="desktop-pointer-qr w-full p-3.5 rounded-xl bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card border border-[#17201B]/15 dark:border-[#D7E07A]/20 items-center gap-4">
                  <div className="p-2 bg-[#FFFFFF] rounded-lg border border-[#17201B]/10 shrink-0">
                    <QRCodeSVG
                      value={publicRecipeUrl}
                      size={76}
                      bgColor="#FFFFFF"
                      fgColor="#17201B"
                      level="M"
                    />
                  </div>
                  <p className="text-xs text-[#17201B]/80 dark:text-[#C9C5B8] max-w-[34ch]">
                    Point your phone camera here to open this shelf checklist on mobile.
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                onNavigate({ page: 'contact', relatedSlug: recipe.slug })
              }
              className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-mono-tabular text-[#17201B]/80 dark:text-[#C9C5B8] hover:text-[#294735] dark:hover:text-[#D7E07A] underline-offset-4 hover:underline cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
            >
              <Flag size={13} aria-hidden="true" />
              <span>Report wrong shelf price</span>
            </button>
          </aside>
        </div>
      </div>

      {/* Sticky Bottom Counter Bar on Mobile & Tablet */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 safe-bottom px-4 py-3 bg-[#17201B]/95 backdrop-blur-md border-t border-[#D7E07A]/30 shadow-2xl flex items-center justify-between gap-3">
        <div>
          <span className="block text-[10px] font-mono-tabular uppercase tracking-wider text-[#C9C5B8]">
            Total at checkout · {checkedCount}/{recipe.ingredients.length} ready
          </span>
          <span className="font-mono-tabular text-xl font-bold text-[#D7E07A] tabular-nums-strict">
            {recipe.priceVerified && recipe.totalPurchaseCost !== null
              ? formatPhpCurrency(recipe.totalPurchaseCost)
              : 'Price Pending'}
          </span>
        </div>

        <button
          type="button"
          aria-pressed={saved}
          onClick={() => toggleFavorite(recipe.id)}
          className={`pressable min-h-[44px] px-4 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
            saved
              ? 'bg-[#D7E07A] text-[#17201B]'
              : 'bg-[#294735] text-[#D7E07A] border border-[#D7E07A]/40'
          }`}
        >
          {saved ? 'Saved for trip' : 'Save trip'}
        </button>
      </div>

      {/* Product Photo Lightbox Modal with Bright Shelf Presentation */}
      <SwipeableModal
        isOpen={Boolean(lightboxIngredient)}
        onClose={() => setLightboxIngredient(null)}
        ariaLabel={
          lightboxParsed
            ? `Product image viewer for ${lightboxParsed.title}`
            : 'Product image viewer'
        }
        title={lightboxParsed?.title}
        maxWidthClass="max-w-md"
      >
        {lightboxIngredient && lightboxParsed && (
          <>
            <div className="aspect-[4/3] w-full bg-[#F5F3EC] flex items-center justify-center p-6">
              <SafeDrinkThumb
                src={lightboxIngredient.productPhotoSnapshot}
                alt={lightboxParsed.title}
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            </div>

            <div className="p-5 space-y-3">
              {lightboxParsed.sizeLabel && (
                <p className="text-xs font-mono-tabular text-[#17201B]/80 dark:text-[#C9C5B8]">
                  Pack size: {lightboxParsed.sizeLabel}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-[#294735] text-[#D7E07A] font-mono-tabular text-xs font-bold">
                  Buy {lightboxIngredient.unitsToPurchase}
                </span>
                {lightboxParsed.partialUseChip && (
                  <span className="px-2.5 py-1 rounded-md border border-[#17201B]/25 dark:border-[#C9C5B8]/35 text-[#17201B] dark:text-[#F5F3EC] font-mono-tabular text-xs">
                    {lightboxParsed.partialUseChip} · {lightboxIngredient.quantityUsed}
                  </span>
                )}
              </div>

              <div className="pt-3 border-t border-[#17201B]/10 dark:border-[#D7E07A]/15 flex items-baseline justify-between">
                <span className="text-xs font-mono-tabular uppercase tracking-wider text-[#17201B]/80 dark:text-[#C9C5B8]">
                  Shelf price
                </span>
                <span className="font-mono-tabular text-xl font-bold text-[#294735] dark:text-[#D7E07A]">
                  {lightboxTotal !== null
                    ? formatPhpCurrency(lightboxTotal)
                    : 'Unverified'}
                </span>
              </div>
            </div>
          </>
        )}
      </SwipeableModal>
    </div>
  );
};
