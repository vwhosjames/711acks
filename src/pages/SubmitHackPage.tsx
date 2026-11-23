import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { APPROVED_CATEGORIES, DrinkCategory } from '../types/domain';
import {
  calculateFullPurchaseCost,
  detectDuplicateRecipes,
  formatPhpCurrency,
} from '../utils/drinkLogic';
import { UploadProgressPhase } from '../lib/supabaseStorage';
import { PublicRoute } from '../components/Navbar';
import { SwipeableModal } from '../components/SwipeableModal';
import { formatPluralCount } from '../utils/formatters';

interface SubmitHackPageProps {
  onNavigate: (route: PublicRoute) => void;
}

interface DraftIngredientRow {
  rowId: string;
  mode: 'catalog' | 'custom';
  productId: string;
  suggestedProductName: string;
  suggestedProductPrice: string;
  suggestedProductPhotoPreviewUrl: string;
  suggestedProductPhotoPath: string;
  suggestedPhotoPhase: UploadProgressPhase;
  suggestedPhotoError: string;
  quantityUsed: string;
  unitsToPurchase: number;
}

export const SubmitHackPage: React.FC<SubmitHackPageProps> = ({ onNavigate }) => {
  const {
    products,
    recipes,
    isLiveSupabase,
    isLoadingData,
    dataError,
    refreshPublicData,
    submitCommunityHack,
    uploadPendingSubmissionPhoto,
  } = useApp();

  const activeCatalogProducts = useMemo(
    () => products.filter((p) => !p.isArchived),
    [products]
  );

  const [drinkName, setDrinkName] = useState('');
  const [category, setCategory] = useState<DrinkCategory>('Coffee Mixes');
  const [submitterName, setSubmitterName] = useState('');
  const [tasteNotes, setTasteNotes] = useState('');
  const [finishedPhotoPreviewUrl, setFinishedPhotoPreviewUrl] = useState<string>('');
  const [finishedPhotoStoragePath, setFinishedPhotoStoragePath] = useState<string>('');
  const [finishedUploadPhase, setFinishedUploadPhase] =
    useState<UploadProgressPhase>('idle');
  const [uploadError, setUploadError] = useState<string>('');
  const [ingredients, setIngredients] = useState<DraftIngredientRow[]>([
    {
      rowId: 'row-1',
      mode: 'catalog',
      productId: activeCatalogProducts[0]?.id || '',
      suggestedProductName: '',
      suggestedProductPrice: '',
      suggestedProductPhotoPreviewUrl: '',
      suggestedProductPhotoPath: '',
      suggestedPhotoPhase: 'idle',
      suggestedPhotoError: '',
      quantityUsed: '1 full bottle / pack',
      unitsToPurchase: 1,
    },
    {
      rowId: 'row-2',
      mode: 'catalog',
      productId: '',
      suggestedProductName: '',
      suggestedProductPrice: '',
      suggestedProductPhotoPreviewUrl: '',
      suggestedProductPhotoPath: '',
      suggestedPhotoPhase: 'idle',
      suggestedPhotoError: '',
      quantityUsed: '1 full bottle / pack',
      unitsToPurchase: 1,
    },
  ]);

  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [confirmedSubmissionTerms, setConfirmedSubmissionTerms] = useState(false);
  const [formError, setFormError] = useState<string>('');
  const [submitError, setSubmitError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedSuccessId, setSubmittedSuccessId] = useState<string | null>(null);

  // Automatic duplicate detection (Section 12)
  const duplicateWarnings = useMemo(() => {
    const hasUserEnteredData =
      drinkName.trim().length >= 3 ||
      ingredients.filter((r) =>
        r.mode === 'catalog' ? Boolean(r.productId) : r.suggestedProductName.trim().length > 1
      ).length >= 2;
    if (!hasUserEnteredData) return [];

    const candidateProductIds = ingredients.map((r) =>
      r.mode === 'catalog' && r.productId ? r.productId : null
    );
    const candidateNames = ingredients.map((r) => {
      if (r.mode === 'catalog') {
        const prod = activeCatalogProducts.find((p) => p.id === r.productId);
        return prod ? prod.name : '';
      }
      return r.suggestedProductName;
    });
    return detectDuplicateRecipes(
      drinkName,
      candidateProductIds,
      candidateNames,
      recipes
    );
  }, [activeCatalogProducts, drinkName, ingredients, recipes]);

  // Price preview calculation (remember: community-provided prices are NOT treated as verified!)
  const priceCalculation = useMemo(() => {
    const mapped = ingredients.map((row) => {
      if (row.mode === 'catalog') {
        const prod = activeCatalogProducts.find((p) => p.id === row.productId);
        return {
          productNameSnapshot: prod ? prod.name : 'Unselected Catalog Product',
          unitsToPurchase: row.unitsToPurchase,
          priceSnapshot: prod ? prod.purchasePrice : null,
          priceVerified: Boolean(prod),
        };
      }
      return {
        productNameSnapshot:
          row.suggestedProductName.trim() || 'Suggested New Product',
        unitsToPurchase: row.unitsToPurchase,
        priceSnapshot: row.suggestedProductPrice
          ? Number(row.suggestedProductPrice)
          : null,
        // Community-provided prices are NEVER automatically treated as verified (Section 12)
        priceVerified: false,
      };
    });
    return calculateFullPurchaseCost(mapped);
  }, [activeCatalogProducts, ingredients]);

  const anyUploadInProgress =
    finishedUploadPhase === 'validating' ||
    finishedUploadPhase === 'uploading' ||
    ingredients.some(
      (row) =>
        row.suggestedPhotoPhase === 'validating' ||
        row.suggestedPhotoPhase === 'uploading'
    );

  const handleFinishedPhotoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setUploadError('');
    const file = e.target.files?.[0];
    if (!file) return;
    setFinishedUploadPhase('validating');
    const res = await uploadPendingSubmissionPhoto(
      file,
      'finished-drink',
      (phase) => setFinishedUploadPhase(phase)
    );
    if (!res.success || !res.previewUrl) {
      setFinishedUploadPhase('error');
      setUploadError(res.error || 'Could not process finished drink image.');
      return;
    }
    setFinishedPhotoPreviewUrl(res.previewUrl);
    setFinishedPhotoStoragePath(res.storagePath || '');
    setFinishedUploadPhase('uploaded');
  };

  const handleCustomProductPhotoUpload = async (
    rowId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setUploadError('');
    const file = e.target.files?.[0];
    if (!file) return;

    setIngredients((prev) =>
      prev.map((r) =>
        r.rowId === rowId
          ? { ...r, suggestedPhotoPhase: 'validating', suggestedPhotoError: '' }
          : r
      )
    );

    const res = await uploadPendingSubmissionPhoto(
      file,
      'suggested-product',
      (phase) => {
        setIngredients((prev) =>
          prev.map((r) =>
            r.rowId === rowId ? { ...r, suggestedPhotoPhase: phase } : r
          )
        );
      }
    );

    if (!res.success || !res.previewUrl) {
      const errMsg = res.error || 'Invalid product image.';
      setUploadError(errMsg);
      setIngredients((prev) =>
        prev.map((r) =>
          r.rowId === rowId
            ? {
                ...r,
                suggestedPhotoPhase: 'error',
                suggestedPhotoError: errMsg,
              }
            : r
        )
      );
      return;
    }

    setIngredients((prev) =>
      prev.map((r) =>
        r.rowId === rowId
          ? {
              ...r,
              suggestedProductPhotoPreviewUrl: res.previewUrl!,
              suggestedProductPhotoPath: res.storagePath || '',
              suggestedPhotoPhase: 'uploaded',
              suggestedPhotoError: '',
            }
          : r
      )
    );
  };

  const addIngredientRow = () => {
    setIngredients((prev) => [
      ...prev,
      {
        rowId: 'row-' + Date.now(),
        mode: 'catalog',
        productId: activeCatalogProducts[0]?.id || '',
        suggestedProductName: '',
        suggestedProductPrice: '',
        suggestedProductPhotoPreviewUrl: '',
        suggestedProductPhotoPath: '',
        suggestedPhotoPhase: 'idle',
        suggestedPhotoError: '',
        quantityUsed: '1 unit',
        unitsToPurchase: 1,
      },
    ]);
  };

  const removeIngredientRow = (rowId: string) => {
    if (ingredients.length <= 1) return;
    setIngredients((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const validateForm = (): boolean => {
    setFormError('');
    if (anyUploadInProgress) {
      setFormError('Please wait for your photo upload to finish before submitting.');
      return false;
    }
    if (drinkName.trim().length < 3) {
      setFormError('Please enter a drink hack name (at least 3 characters).');
      return false;
    }
    if (ingredients.length === 0) {
      setFormError('Please include at least one 7-Eleven ingredient.');
      return false;
    }
    for (const row of ingredients) {
      if (!row.quantityUsed.trim()) {
        setFormError('Please specify the quantity used for every ingredient.');
        return false;
      }
      if (row.mode === 'catalog' && !row.productId) {
        setFormError('Please select a 7-Eleven product from the catalog.');
        return false;
      }
      if (row.mode === 'custom' && row.suggestedProductName.trim().length < 2) {
        setFormError('Please enter the name of the suggested 7-Eleven product.');
        return false;
      }
    }
    if (!confirmedSubmissionTerms) {
      setFormError(
        'Please confirm that all ingredients are available at 7-Eleven Philippines and that your submission will undergo admin review.'
      );
      return false;
    }
    return true;
  };

  const handleOpenPreview = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    if (!validateForm()) return;
    setShowPreviewModal(true);
  };

  const handleFinalSubmit = async () => {
    if (isSubmitting) return;
    if (!validateForm()) return;

    setSubmitError('');
    setIsSubmitting(true);

    const dupNote =
      duplicateWarnings.length > 0
        ? `Potential similarity to: ${duplicateWarnings
            .map((w) => w.recipeName)
            .join(', ')}`
        : undefined;

    const resolvedFinishedPhoto = isLiveSupabase
      ? finishedPhotoStoragePath || undefined
      : finishedPhotoPreviewUrl || undefined;

    const result = await submitCommunityHack({
      drinkName: drinkName.trim(),
      category,
      submitterName: submitterName.trim() || 'Anonymous Creator',
      tasteNotes: tasteNotes.trim() || undefined,
      finishedPhotoUrl: resolvedFinishedPhoto,
      duplicateWarningNotes: dupNote,
      ingredients: ingredients.map((r, i) => ({
        id: `sub-ing-${Date.now()}-${i}`,
        productId: r.mode === 'catalog' ? r.productId : null,
        suggestedProductName:
          r.mode === 'custom' ? r.suggestedProductName.trim() : undefined,
        suggestedProductPrice:
          r.mode === 'custom' && r.suggestedProductPrice
            ? Number(r.suggestedProductPrice)
            : null,
        suggestedProductPhotoUrl:
          r.mode === 'custom'
            ? isLiveSupabase
              ? r.suggestedProductPhotoPath || undefined
              : r.suggestedProductPhotoPreviewUrl || undefined
            : undefined,
        quantityUsed: r.quantityUsed.trim(),
        unitsToPurchase: Math.max(1, Math.floor(Number(r.unitsToPurchase) || 1)),
      })),
    });

    setIsSubmitting(false);

    if (!result.success || !result.submissionId) {
      setSubmitError(
        result.error || 'Could not submit your drink hack. Please try again.'
      );
      return;
    }

    setShowPreviewModal(false);
    setSubmittedSuccessId(result.submissionId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (submittedSuccessId) {
    return (
      <div className="min-h-dvh bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-16 px-6">
        <div className="max-w-xl mx-auto bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl p-8 space-y-5 text-center">
          <CheckCircle2 className="w-10 h-10 text-[#294735] dark:text-[#D7E07A] mx-auto" />
          <div className="space-y-2">
            <p className="font-mono-tabular text-xs uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
              SUBMISSION REFERENCE #{submittedSuccessId}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-light uppercase heading-tight">
              Saved as Pending Review
            </h1>
            <p className="text-sm text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed max-w-[54ch] mx-auto">
              Thank you for contributing to 711acks! Community submissions never become public automatically. The administrator will review your ingredient selection, verify all 7&#8209;Eleven Philippines product purchase prices, and approve your recipe for publication.
            </p>
          </div>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate({ page: 'explore' })}
              className="pressable min-h-[44px] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg cursor-pointer"
            >
              Browse Published Drinks
            </button>
            <button
              type="button"
              onClick={() => {
                setSubmittedSuccessId(null);
                setDrinkName('');
                setTasteNotes('');
                setFinishedPhotoPreviewUrl('');
                setFinishedPhotoStoragePath('');
                setFinishedUploadPhase('idle');
                setConfirmedSubmissionTerms(false);
              }}
              className="pressable min-h-[44px] px-5 py-2.5 text-xs font-medium border border-[#17201B]/18 dark:border-[#D7E07A]/20 rounded-lg cursor-pointer hover-border-accent"
            >
              Submit Another Hack
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-12 px-6">
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="space-y-3 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-8">
          <p className="font-mono-tabular text-xs uppercase tracking-[0.24em] text-[#294735] dark:text-[#D7E07A]">
            NO ACCOUNT REQUIRED · PENDING ADMIN VERIFICATION
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-light uppercase heading-tight">
            Submit a Drink Hack
          </h1>
          <p className="text-sm sm:text-base text-[#17201B]/75 dark:text-[#C9C5B8] max-w-[65ch] leading-relaxed">
            Share your favorite 7&#8209;Eleven Philippines drink combination. Select verified items from our Product Catalog or suggest a new store product for administrator price verification.
          </p>
        </div>

        {dataError && (
          <div
            role="alert"
            className="p-4 bg-red-500/10 border border-red-500/40 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300"
          >
            <span>Unable to load live product catalog: {dataError}</span>
            <button
              type="button"
              onClick={() => void refreshPublicData()}
              className="px-3 py-1.5 rounded border border-red-500/40 hover:bg-red-500/10 font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 self-start sm:self-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {isLoadingData && activeCatalogProducts.length === 0 && !dataError && (
          <div
            role="status"
            className="p-3 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded text-xs text-[#17201B]/75 dark:text-[#C9C5B8]"
          >
            Loading verified 7-Eleven product catalog...
          </div>
        )}

        <form onSubmit={handleOpenPreview} className="space-y-8">
          {formError && (
            <div
              role="alert"
              className="p-4 bg-red-950/15 dark:bg-red-950/40 border border-red-600/50 text-red-700 dark:text-red-300 rounded-md text-xs font-medium"
            >
              {formError}
            </div>
          )}

          {/* Basic Drink Details */}
          <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-6">
            <h2 className="font-display text-lg font-light uppercase heading-tight border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-3">
              01. Drink Identity &amp; Primary Category
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label
                  htmlFor="sub-drink-name"
                  className="block text-xs font-semibold uppercase tracking-wider"
                >
                  Drink Hack Name *
                </label>
                <input
                  id="sub-drink-name"
                  type="text"
                  required
                  value={drinkName}
                  onChange={(e) => setDrinkName(e.target.value)}
                  placeholder="e.g. Kopiko Chuckie Dirty Mocha"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-base sm:text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg text-[#17201B] dark:text-[#F5F3EC] focus:outline-none focus:border-[#294735] dark:focus:border-[#D7E07A] transition-[border-color] duration-150"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="sub-category"
                  className="block text-xs font-semibold uppercase tracking-wider"
                >
                  Primary Category * (Strictly One)
                </label>
                <select
                  id="sub-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DrinkCategory)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-base sm:text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg text-[#17201B] dark:text-[#F5F3EC] focus:outline-none focus:border-[#294735] dark:focus:border-[#D7E07A] transition-[border-color] duration-150"
                >
                  {APPROVED_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label
                  htmlFor="sub-creator-name"
                  className="block text-xs font-semibold uppercase tracking-wider"
                >
                  Submitter Name (Optional)
                </label>
                <input
                  id="sub-creator-name"
                  type="text"
                  value={submitterName}
                  onChange={(e) => setSubmitterName(e.target.value)}
                  placeholder="Defaults to Anonymous Creator if left blank"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-base sm:text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg text-[#17201B] dark:text-[#F5F3EC] focus:outline-none focus:border-[#294735] dark:focus:border-[#D7E07A] transition-[border-color] duration-150"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="sub-taste-notes"
                  className="block text-xs font-semibold uppercase tracking-wider"
                >
                  Flavor &amp; Taste Notes (Optional)
                </label>
                <input
                  id="sub-taste-notes"
                  type="text"
                  value={tasteNotes}
                  onChange={(e) => setTasteNotes(e.target.value)}
                  placeholder="Brief flavor profile (no step-by-step instructions)"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-base sm:text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg text-[#17201B] dark:text-[#F5F3EC] focus:outline-none focus:border-[#294735] dark:focus:border-[#D7E07A] transition-[border-color] duration-150"
                />
              </div>
            </div>
          </div>

          {/* Automatic Duplicate Detection Warning Banner (Section 12) */}
          {duplicateWarnings.length > 0 && (
            <div className="p-5 bg-amber-950/15 dark:bg-amber-950/35 border border-amber-500/50 rounded-md space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Potential Similar Drink Hack Detected</span>
              </div>
              <p className="text-xs text-[#17201B]/80 dark:text-[#C9C5B8]">
                Our duplicate detector found similar published combinations. You can still submit your version—the administrator will make the final review decision:
              </p>
              <ul className="space-y-1 text-xs">
                {duplicateWarnings.map((w) => (
                  <li
                    key={w.recipeId}
                    className="flex flex-wrap items-center justify-between gap-2 pt-1"
                  >
                    <span className="font-semibold text-[#17201B] dark:text-[#F5F3EC]">
                      {w.recipeName} ({w.reasons.join(', ')})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ page: 'drink-detail', slug: w.recipeSlug })
                      }
                      className="text-xs underline text-[#294735] dark:text-[#D7E07A] cursor-pointer"
                    >
                      Inspect Existing Recipe
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ingredients & Product Catalog Selection */}
          <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-3">
              <div>
                <h2 className="font-display text-lg font-light uppercase heading-tight">
                  02. 7&#8209;Eleven Ingredients &amp; Full Purchase Units
                </h2>
                <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Select from verified catalog products or suggest a new product for admin review.
                </p>
              </div>
              <button
                type="button"
                onClick={addIngredientRow}
                className="pressable min-h-[40px] px-3.5 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Add Ingredient</span>
              </button>
            </div>

            <div className="space-y-5">
              {ingredients.map((row, idx) => {
                const selectedProduct =
                  row.mode === 'catalog'
                    ? activeCatalogProducts.find((p) => p.id === row.productId)
                    : undefined;

                return (
                  <div
                    key={row.rowId}
                    className="p-4 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/12 dark:border-[#D7E07A]/14 rounded-lg space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono-tabular text-xs font-semibold uppercase text-[#294735] dark:text-[#D7E07A]">
                        Ingredient #{idx + 1}
                      </span>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-[#FFFFFF] dark:bg-[#1E2B23] p-1 rounded-lg border border-[#17201B]/12 dark:border-[#D7E07A]/14">
                          <button
                            type="button"
                            onClick={() =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.rowId === row.rowId
                                    ? { ...r, mode: 'catalog' }
                                    : r
                                )
                              )
                            }
                            className={`pressable px-2.5 py-1 text-xs rounded-md cursor-pointer ${
                              row.mode === 'catalog'
                                ? 'bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] font-semibold'
                                : 'text-[#17201B]/70 dark:text-[#C9C5B8]'
                            }`}
                          >
                            Existing Catalog Product
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.rowId === row.rowId
                                    ? { ...r, mode: 'custom' }
                                    : r
                                )
                              )
                            }
                            className={`pressable px-2.5 py-1 text-xs rounded-md cursor-pointer ${
                              row.mode === 'custom'
                                ? 'bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] font-semibold'
                                : 'text-[#17201B]/70 dark:text-[#C9C5B8]'
                            }`}
                          >
                            Suggest New Product
                          </button>
                        </div>

                        {ingredients.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeIngredientRow(row.rowId)}
                            aria-label={`Remove Ingredient ${idx + 1}`}
                            className="hit-target-44 pressable p-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4 shrink-0" />
                          </button>
                        )}
                      </div>
                    </div>

                    {row.mode === 'catalog' ? (
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                        <div className="md:col-span-6 space-y-1.5">
                          <label className="block text-xs font-medium">
                            Select Verified 7-Eleven Product *
                          </label>
                          <select
                            value={row.productId}
                            onChange={(e) =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.rowId === row.rowId
                                    ? { ...r, productId: e.target.value }
                                    : r
                                )
                              )
                            }
                            className="w-full min-h-[44px] px-3 py-2 text-base sm:text-sm bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg"
                          >
                            <option value="">-- Select a 7-Eleven Product --</option>
                            {activeCatalogProducts.map((prod) => (
                              <option key={prod.id} value={prod.id}>
                                {prod.name} — {formatPhpCurrency(prod.purchasePrice)}
                              </option>
                            ))}
                          </select>
                        </div>

                        {selectedProduct && (
                          <div className="md:col-span-6 flex items-center gap-3 p-2.5 bg-[#FFFFFF] dark:bg-[#1E2B23] rounded border border-[#C9C5B8]/40 dark:border-[#294735]">
                            <img
                              src={selectedProduct.photoUrl}
                              alt={selectedProduct.name}
                              referrerPolicy="no-referrer"
                              className="w-12 h-12 rounded object-cover shrink-0 bg-[#17201B]"
                            />
                            <div className="min-w-0 flex-1 text-xs">
                              <div className="font-semibold truncate">
                                {selectedProduct.name}
                              </div>
                              <div className="font-mono-tabular text-[#294735] dark:text-[#D7E07A]">
                                Verified Price: {formatPhpCurrency(selectedProduct.purchasePrice)} / unit
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium">
                            Suggested Product Name *
                          </label>
                          <input
                            type="text"
                            value={row.suggestedProductName}
                            onChange={(e) =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.rowId === row.rowId
                                    ? { ...r, suggestedProductName: e.target.value }
                                    : r
                                )
                              )
                            }
                            placeholder="e.g. Bear Brand Sterilized 200ml"
                            className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium">
                            Suggested Price in ₱ (Optional, Unverified)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={row.suggestedProductPrice}
                            onChange={(e) =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.rowId === row.rowId
                                    ? { ...r, suggestedProductPrice: e.target.value }
                                    : r
                                )
                              )
                            }
                            placeholder="e.g. 34.00"
                            className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg font-mono-tabular"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium">
                            Optional Product Photo (Private Review)
                          </label>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={
                              row.suggestedPhotoPhase === 'validating' ||
                              row.suggestedPhotoPhase === 'uploading'
                            }
                            onChange={(e) =>
                              void handleCustomProductPhotoUpload(row.rowId, e)
                            }
                            className="w-full text-xs"
                          />
                          {row.suggestedPhotoPhase === 'validating' && (
                            <p className="text-[11px] text-[#294735] dark:text-[#D7E07A]">
                              Validating image...
                            </p>
                          )}
                          {row.suggestedPhotoPhase === 'uploading' && (
                            <p className="text-[11px] text-[#294735] dark:text-[#D7E07A]">
                              Uploading to private review storage...
                            </p>
                          )}
                          {row.suggestedPhotoPhase === 'uploaded' &&
                            row.suggestedProductPhotoPreviewUrl && (
                              <p className="text-[11px] text-[#294735] dark:text-[#D7E07A]">
                                {isLiveSupabase
                                  ? 'Uploaded to private storage.'
                                  : 'Image ready (local preview).'}
                              </p>
                            )}
                          {row.suggestedPhotoError && (
                            <p className="text-[11px] text-red-600 dark:text-red-400">
                              {row.suggestedPhotoError}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Quantity Used vs Whole Units to Purchase */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#C9C5B8]/30 dark:border-[#294735]">
                      <div className="space-y-1">
                        <label className="block text-xs font-medium">
                          Amount / Quantity Used in Drink *
                        </label>
                        <input
                          type="text"
                          value={row.quantityUsed}
                          onChange={(e) =>
                            setIngredients((prev) =>
                              prev.map((r) =>
                                r.rowId === row.rowId
                                  ? { ...r, quantityUsed: e.target.value }
                                  : r
                              )
                            )
                          }
                          placeholder="e.g. Half bottle (90ml) or 1 full pack"
                          className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-medium">
                          Full Units to Purchase at 7&#8209;Eleven Counter *
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={row.unitsToPurchase}
                          onChange={(e) =>
                            setIngredients((prev) =>
                              prev.map((r) =>
                                r.rowId === row.rowId
                                  ? {
                                      ...r,
                                      unitsToPurchase: Math.max(
                                        1,
                                        parseInt(e.target.value || '1', 10)
                                      ),
                                    }
                                  : r
                              )
                            )
                          }
                          className="w-full min-h-[44px] px-3 py-2 text-base sm:text-xs bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#17201B]/16 dark:border-[#D7E07A]/18 rounded-lg font-mono-tabular"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Optional Finished Drink Photo Upload */}
          <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-4">
            <h2 className="font-display text-lg font-light uppercase heading-tight border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-3">
              03. Optional Finished Drink Photo (Private Until Approved)
            </h2>

            {uploadError && (
              <div className="text-xs text-red-600 dark:text-red-400">
                {uploadError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <label className="pressable min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border border-[#17201B]/18 dark:border-[#D7E07A]/20 rounded-lg cursor-pointer hover-border-accent">
                <Upload className="w-4 h-4 shrink-0" />
                <span>
                  {finishedUploadPhase === 'validating'
                    ? 'Validating Image...'
                    : finishedUploadPhase === 'uploading'
                    ? 'Uploading to Private Storage...'
                    : 'Select Image (JPG, PNG, WebP · Max 5MB)'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={
                    finishedUploadPhase === 'validating' ||
                    finishedUploadPhase === 'uploading'
                  }
                  onChange={(e) => void handleFinishedPhotoUpload(e)}
                  className="hidden"
                />
              </label>

              {finishedPhotoPreviewUrl && (
                <div className="flex items-center gap-3">
                  <img
                    src={finishedPhotoPreviewUrl}
                    alt="Uploaded drink preview"
                    className="w-16 h-16 rounded-lg object-cover shrink-0 border border-[#17201B]/15 dark:border-[#D7E07A]/20"
                  />
                  <div className="space-y-1">
                    {finishedUploadPhase === 'uploaded' && (
                      <div className="text-[11px] text-[#294735] dark:text-[#D7E07A]">
                        {isLiveSupabase
                          ? 'Stored privately for admin review'
                          : 'Ready (local preview)'}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setFinishedPhotoPreviewUrl('');
                        setFinishedPhotoStoragePath('');
                        setFinishedUploadPhase('idle');
                      }}
                      className="text-xs text-red-600 dark:text-red-400 underline underline-offset-4 cursor-pointer"
                    >
                      Remove Photo
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Submission Confirmation Checkbox & Preview Trigger */}
          <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-5">
            <label className="flex items-start gap-3 text-xs sm:text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={confirmedSubmissionTerms}
                onChange={(e) => setConfirmedSubmissionTerms(e.target.checked)}
                className="mt-1 shrink-0"
              />
              <span className="text-[#17201B]/85 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
                I confirm that this drink combination uses products sold at 7&#8209;Eleven Philippines, and I understand that my submission will be saved as <strong>Pending</strong> until the administrator verifies all prices and images.
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <div className="text-xs font-mono-tabular">
                {priceCalculation.allPricesVerified ? (
                  <span className="text-[#294735] dark:text-[#D7E07A] font-semibold">
                    Estimated Verified Catalog Total:{' '}
                    {formatPhpCurrency(priceCalculation.totalPurchaseCost)}
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">
                    Price Status: Contains{' '}
                    {formatPluralCount(
                      priceCalculation.unverifiedCount,
                      'suggested/unverified product price'
                    )}{' '}
                    awaiting Admin verification
                  </span>
                )}
              </div>

              <button
                type="submit"
                className="pressable min-h-[44px] px-6 py-3 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg flex items-center gap-2 cursor-pointer"
              >
                <Eye className="w-4 h-4 shrink-0" />
                <span>Review Submission Preview</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Submission Preview Modal with 1:1 Vertical Swipe-to-Dismiss & Escape Support */}
      <SwipeableModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        disableDismiss={isSubmitting}
        ariaLabel="Submission Preview Before Sending"
        maxWidthClass="max-w-lg"
        headerContent={
          <div>
            <p className="font-mono-tabular text-xs uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
              PRE-SUBMISSION CHECKLIST
            </p>
            <h3 className="font-display text-2xl font-light uppercase heading-tight mt-1">
              {drinkName}
            </h3>
            <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
              Category: {category} · Submitter:{' '}
              {submitterName.trim() || 'Anonymous Creator'}
            </p>
          </div>
        }
      >
        <div className="p-6 space-y-5">
          <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
            <div className="text-xs font-semibold uppercase tracking-wider tabular-nums-strict">
              Selected Ingredients ({ingredients.length})
            </div>
            {ingredients.map((row) => {
              const catalogProd =
                row.mode === 'catalog'
                  ? activeCatalogProducts.find((p) => p.id === row.productId)
                  : undefined;

              return (
                <div
                  key={row.rowId}
                  className="p-3 bg-[#FFFFFF] dark:bg-[#17201B] border border-[#17201B]/12 dark:border-[#D7E07A]/14 rounded-lg flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold">
                      {catalogProd
                        ? catalogProd.name
                        : `${row.suggestedProductName} (Suggested New Product)`}
                    </div>
                    <div className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                      Amount: {row.quantityUsed} · Buy:{' '}
                      <span className="font-mono-tabular">
                        {formatPluralCount(row.unitsToPurchase, 'unit')}
                      </span>
                    </div>
                  </div>
                  <div className="font-mono-tabular text-right shrink-0">
                    {catalogProd ? (
                      <span className="text-[#294735] dark:text-[#D7E07A] font-semibold">
                        {formatPhpCurrency(
                          catalogProd.purchasePrice * row.unitsToPurchase
                        )}
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-300">
                        Unverified Price
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3.5 bg-[#FFFFFF] dark:bg-[#17201B] border border-[#17201B]/12 dark:border-[#D7E07A]/14 rounded-lg text-xs space-y-1">
            <div className="flex items-center justify-between font-semibold">
              <span>Full-Product Purchase Cost Status:</span>
              <span className="font-mono-tabular text-[#294735] dark:text-[#D7E07A]">
                {priceCalculation.allPricesVerified
                  ? formatPhpCurrency(priceCalculation.totalPurchaseCost)
                  : 'Pending Admin Price Verification'}
              </span>
            </div>
            {!priceCalculation.allPricesVerified && (
              <p className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                Missing or community-suggested prices ({priceCalculation.missingPriceIngredients.join(', ')}) will be verified by the administrator before public listing.
              </p>
            )}
          </div>

          {submitError && (
            <div
              role="alert"
              className="p-3 bg-red-950/15 dark:bg-red-950/40 border border-red-600/50 text-red-700 dark:text-red-300 rounded-lg text-xs font-medium"
            >
              {submitError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setShowPreviewModal(false)}
              className="pressable min-h-[44px] px-4 py-2 text-xs font-medium border border-[#17201B]/18 dark:border-[#D7E07A]/20 rounded-lg cursor-pointer disabled:opacity-50 hover-border-accent"
            >
              Continue Editing
            </button>
            <button
              type="button"
              disabled={isSubmitting || anyUploadInProgress}
              onClick={() => void handleFinalSubmit()}
              className="pressable min-h-[44px] px-5 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? 'Submitting...' : 'Confirm & Submit as Pending'}
            </button>
          </div>
        </div>
      </SwipeableModal>
    </div>
  );
};
