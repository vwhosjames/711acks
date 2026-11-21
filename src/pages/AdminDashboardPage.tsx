import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Check,
  Clock,
  Download,
  Edit3,
  History,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sun,
  Moon,
  Trash2,
  Upload,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../context/AppContext';
import {
  APPROVED_CATEGORIES,
  CommunitySubmission,
  DrinkCategory,
  DrinkRecipe,
  RecipeIngredient,
  RecipeStatus,
} from '../types/domain';
import {
  calculateFullPurchaseCost,
  detectDuplicateRecipes,
  formatPhpCurrency,
} from '../utils/drinkLogic';
import { validateAndOptimizeImageFile } from '../lib/supabaseClient';
import { isRelativeStoragePath } from '../lib/supabaseStorage';
import { PublicRoute } from '../components/Navbar';

interface AdminDashboardPageProps {
  onNavigate: (route: PublicRoute) => void;
}

type AdminModule =
  | 'overview'
  | 'recipes'
  | 'submissions'
  | 'products'
  | 'reports'
  | 'qrcodes'
  | 'revisions'
  | 'backups'
  | 'maintenance'
  | 'settings';

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  onNavigate,
}) => {
  const {
    theme,
    toggleTheme,
    products,
    priceHistory,
    recipes,
    communitySubmissions,
    productSuggestions,
    recipeRevisions,
    contactReports,
    websiteSettings,
    securityEvents,
    isLiveSupabase,
    isLoadingAdminData,
    adminDataError,
    refreshAdminData,
    getPendingPhotoSignedUrl,
    adminSession,
    pendingOtpChallenge,
    pendingPasswordRecovery,
    lockoutUntil,
    sessionExpiredReason,
    clearSessionExpiredReason,
    initiateAdminLogin,
    verifyAdminOtp,
    resendAdminOtp,
    requestPasswordRecovery,
    completePasswordRecovery,
    cancelPasswordRecovery,
    logoutAdmin,
    touchAdminActivity,
    addOrUpdateProduct,
    toggleArchiveProduct,
    saveRecipe,
    applyPendingDraftToPublished,
    verifyRecipeCurrentCatalogPrices,
    restoreRecipeRevision,
    approveCommunitySubmission,
    rejectCommunitySubmission,
    updateContactReportStatus,
    updateWebsiteSettings,
    generateBackupPackage,
    restoreFromBackupPackage,
  } = useApp();

  // Auth screen state
  const [loginEmail, setLoginEmail] = useState(
    isLiveSupabase ? '' : 'admin@711acks.ph'
  );
  const [loginPassword, setLoginPassword] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [showRecoveryForm, setShowRecoveryForm] = useState(false);
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);

  // Active dashboard module
  const [activeModule, setActiveModule] = useState<AdminModule>('overview');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(1800);

  // Recipe Management Form State
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [recipeName, setRecipeName] = useState('');
  const [recipeCategory, setRecipeCategory] = useState<DrinkCategory>('Coffee Mixes');
  const [recipeStatus, setRecipeStatus] = useState<RecipeStatus>('Published');
  const [recipePhotoUrl, setRecipePhotoUrl] = useState(
    '/src/assets/images/drink_kopiko_caramel_macchiato_1795010585218.jpg'
  );
  const [recipeTasteNotes, setRecipeTasteNotes] = useState('');
  const [recipeEditorsPick, setRecipeEditorsPick] = useState(false);
  const [recipeTrending, setRecipeTrending] = useState(false);
  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredient[]>([]);
  const [recipeMsg, setRecipeMsg] = useState('');
  const [showRecipeForm, setShowRecipeForm] = useState(false);

  // Product Catalog Form State
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodBarcode, setProdBarcode] = useState('');
  const [prodPhotoUrl, setProdPhotoUrl] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [prodFeedback, setProdFeedback] = useState('');

  // Submission review modal state
  const [reviewingSubmission, setReviewingSubmission] =
    useState<CommunitySubmission | null>(null);
  const [approvalName, setApprovalName] = useState('');
  const [approvalCategory, setApprovalCategory] =
    useState<DrinkCategory>('Coffee Mixes');
  const [approvalPhotoUrl, setApprovalPhotoUrl] = useState('');
  const [approvalSignedPhotoPreview, setApprovalSignedPhotoPreview] =
    useState<string>('');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [approvalIngredients, setApprovalIngredients] = useState<RecipeIngredient[]>([]);
  const [approvalError, setApprovalError] = useState('');
  const [submissionActionMsg, setSubmissionActionMsg] = useState('');
  const [reportActionMsg, setReportActionMsg] = useState('');
  const [revisionActionMsg, setRevisionActionMsg] = useState('');
  const [maintenanceActionMsg, setMaintenanceActionMsg] = useState('');
  const [maintTitleDraft, setMaintTitleDraft] = useState(
    websiteSettings.maintenanceTitle
  );
  const [maintMsgDraft, setMaintMsgDraft] = useState(
    websiteSettings.maintenanceMessage
  );

  // Backup restore state
  const [backupFeedback, setBackupFeedback] = useState('');
  const [pendingRestoreJson, setPendingRestoreJson] = useState<unknown>(null);

  useEffect(() => {
    setMaintTitleDraft(websiteSettings.maintenanceTitle);
    setMaintMsgDraft(websiteSettings.maintenanceMessage);
  }, [websiteSettings.maintenanceTitle, websiteSettings.maintenanceMessage]);

  // Session countdown timer
  useEffect(() => {
    if (!adminSession) return;
    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((adminSession.expiresAt - Date.now()) / 1000));
      setRemainingSeconds(diff);
    };
    updateTimer();
    const id = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(id);
  }, [adminSession]);

  // OTP resend cooldown countdown timer
  useEffect(() => {
    if (!pendingOtpChallenge) {
      setResendCooldownSeconds(0);
      return;
    }
    const updateCooldown = () => {
      const diff = Math.max(
        0,
        Math.ceil((pendingOtpChallenge.resendAvailableAt - Date.now()) / 1000)
      );
      setResendCooldownSeconds(diff);
    };
    updateCooldown();
    const id = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(id);
  }, [pendingOtpChallenge]);

  // Analytics metrics
  const publishedRecipes = useMemo(
    () => recipes.filter((r) => r.status === 'Published'),
    [recipes]
  );
  const pendingSubmissions = useMemo(
    () => communitySubmissions.filter((s) => s.status === 'Pending'),
    [communitySubmissions]
  );
  const totalLikes = useMemo(
    () => recipes.reduce((acc, r) => acc + r.likesCount, 0),
    [recipes]
  );
  const mostPopularDrinks = useMemo(
    () => [...publishedRecipes].sort((a, b) => b.likesCount - a.likesCount).slice(0, 5),
    [publishedRecipes]
  );

  // Handlers for Step 1 (Password) & Step 2 (6-digit Email OTP)
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuthSubmitting) return;
    setAuthError('');
    setAuthNotice('');
    clearSessionExpiredReason();
    setIsAuthSubmitting(true);
    try {
      const res = await initiateAdminLogin(loginEmail, loginPassword);
      if (!res.success) {
        setAuthError(res.error || 'Authentication failed.');
        return;
      }
      setOtpInput('');
      setAuthNotice(
        isLiveSupabase
          ? 'Step 1 complete: Primary password verified. Check your administrator email inbox for the 6-digit one-time verification code.'
          : 'Step 1 complete: Primary password verified. Enter the 6-digit one-time verification code to unlock the dashboard.'
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuthSubmitting) return;
    setAuthError('');
    setIsAuthSubmitting(true);
    try {
      const res = await verifyAdminOtp(otpInput);
      if (!res.success) {
        setAuthError(res.error || 'OTP validation failed.');
        return;
      }
      setOtpInput('');
      setLoginPassword('');
      setAuthNotice('');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (isResendingOtp || isAuthSubmitting || resendCooldownSeconds > 0) return;
    setAuthError('');
    setIsResendingOtp(true);
    try {
      const res = await resendAdminOtp();
      if (!res.success) {
        setAuthError(res.error || 'Could not resend OTP.');
      } else {
        setOtpInput('');
        setAuthNotice(
          isLiveSupabase
            ? 'A fresh 6-digit verification code has been emailed. Your previous code is now invalid.'
            : 'A fresh 6-digit verification code has been issued.'
        );
      }
    } finally {
      setIsResendingOtp(false);
    }
  };

  const handlePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuthSubmitting) return;
    setAuthError('');
    setIsAuthSubmitting(true);
    try {
      const res = await requestPasswordRecovery(loginEmail);
      setAuthNotice(res.message);
      setShowRecoveryForm(false);
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleCompletePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuthSubmitting) return;
    setAuthError('');
    setAuthNotice('');
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setAuthError('New password and confirmation password do not match.');
      return;
    }
    setIsAuthSubmitting(true);
    try {
      const res = await completePasswordRecovery(recoveryNewPassword);
      if (!res.success) {
        setAuthError(res.error || 'Could not complete password recovery.');
        return;
      }
      setRecoveryNewPassword('');
      setRecoveryConfirmPassword('');
      setLoginPassword('');
      setShowRecoveryForm(false);
      setAuthNotice(
        res.message ||
          'Password updated successfully. Sign in with your new password and complete 6-digit Email OTP verification.'
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  // Start creating or editing a recipe
  const openCreateRecipeForm = () => {
    touchAdminActivity();
    setEditingRecipeId(null);
    setRecipeName('');
    setRecipeCategory('Coffee Mixes');
    setRecipeStatus('Published');
    setRecipePhotoUrl(
      '/src/assets/images/drink_kopiko_caramel_macchiato_1795010585218.jpg'
    );
    setRecipeTasteNotes('');
    setRecipeEditorsPick(false);
    setRecipeTrending(false);
    const defaultProd = products.find((p) => !p.isArchived);
    setRecipeIngredients(
      defaultProd
        ? [
            {
              id: 'ing-' + Date.now(),
              productId: defaultProd.id,
              productNameSnapshot: defaultProd.name,
              productPhotoSnapshot: defaultProd.photoUrl,
              quantityUsed: '1 full unit',
              unitsToPurchase: 1,
              priceSnapshot: defaultProd.purchasePrice,
              priceVerified: true,
            },
          ]
        : []
    );
    setRecipeMsg('');
    setShowRecipeForm(true);
  };

  const openEditRecipeForm = (recipe: DrinkRecipe) => {
    touchAdminActivity();
    setEditingRecipeId(recipe.id);
    const source = recipe.pendingDraft || recipe;
    setRecipeName(source.name);
    setRecipeCategory(source.category);
    setRecipeStatus(recipe.status);
    setRecipePhotoUrl(source.photoUrl);
    setRecipeTasteNotes(source.tasteNotes || '');
    setRecipeEditorsPick(recipe.isEditorsPick);
    setRecipeTrending(recipe.isTrending);
    setRecipeIngredients(source.ingredients);
    setRecipeMsg('');
    setShowRecipeForm(true);
  };

  const handleSaveRecipeSubmit = async (asPendingDraft = false) => {
    setRecipeMsg('');
    const res = await saveRecipe(
      {
        id: editingRecipeId || undefined,
        name: recipeName,
        category: recipeCategory,
        status: recipeStatus,
        photoUrl: recipePhotoUrl,
        submitterName: 'Admin Owner',
        tasteNotes: recipeTasteNotes,
        ingredients: recipeIngredients,
        totalPurchaseCost: null,
        priceVerified: true,
        needsPriceReview: false,
        lastPriceVerifiedAt: new Date().toISOString(),
        isEditorsPick: recipeEditorsPick,
        isTrending: recipeTrending,
        publishedAt: new Date().toISOString(),
      },
      asPendingDraft
    );

    if (!res.success) {
      setRecipeMsg(res.error || 'Error saving recipe.');
      return;
    }
    setRecipeMsg(
      asPendingDraft
        ? 'Draft changes saved privately while keeping the existing published recipe live!'
        : 'Recipe saved and revision recorded.'
    );
    setShowRecipeForm(false);
  };

  // Start reviewing a community submission
  const startSubmissionReview = (sub: CommunitySubmission) => {
    touchAdminActivity();
    setReviewingSubmission(sub);
    setApprovalName(sub.drinkName);
    setApprovalCategory(sub.category);
    const initialPhoto =
      sub.finishedPhotoUrl ||
      '/src/assets/images/drink_kopiko_caramel_macchiato_1795010585218.jpg';
    setApprovalPhotoUrl(initialPhoto);
    setApprovalSignedPhotoPreview('');
    setApprovalNotes(sub.tasteNotes || '');
    setApprovalError('');

    if (sub.finishedPhotoUrl && isRelativeStoragePath(sub.finishedPhotoUrl)) {
      void getPendingPhotoSignedUrl(sub.finishedPhotoUrl).then((res) => {
        if (res.success && res.signedUrl) {
          setApprovalSignedPhotoPreview(res.signedUrl);
        } else if (res.error) {
          setApprovalError(res.error);
        }
      });
    } else if (sub.finishedPhotoUrl) {
      setApprovalSignedPhotoPreview(sub.finishedPhotoUrl);
    }

    const mappedIngs: RecipeIngredient[] = sub.ingredients.map((ing, i) => {
      const catalogItem = ing.productId
        ? products.find((p) => p.id === ing.productId)
        : undefined;
      return {
        id: `app-ing-${Date.now()}-${i}`,
        productId: catalogItem ? catalogItem.id : null,
        productNameSnapshot: catalogItem
          ? catalogItem.name
          : ing.suggestedProductName || 'Suggested Product',
        productPhotoSnapshot: catalogItem
          ? catalogItem.photoUrl
          : ing.suggestedProductPhotoUrl || products[0]?.photoUrl || '',
        quantityUsed: ing.quantityUsed,
        unitsToPurchase: ing.unitsToPurchase,
        priceSnapshot: catalogItem
          ? catalogItem.purchasePrice
          : ing.suggestedProductPrice ?? null,
        priceVerified: Boolean(catalogItem),
      };
    });
    setApprovalIngredients(mappedIngs);
  };

  const handleConfirmApproveSubmission = async () => {
    if (!reviewingSubmission) return;
    setApprovalError('');
    const res = await approveCommunitySubmission(reviewingSubmission.id, {
      name: approvalName,
      category: approvalCategory,
      photoUrl: approvalPhotoUrl,
      tasteNotes: approvalNotes,
      ingredients: approvalIngredients,
      adminNotes: 'Verified all product prices and published.',
    });
    if (!res.success) {
      setApprovalError(res.error || 'Could not approve submission.');
      return;
    }
    setReviewingSubmission(null);
    setApprovalSignedPhotoPreview('');
  };

  // Download SVG QR code as file
  const handleDownloadQrSvg = (slug: string) => {
    touchAdminActivity();
    const svgEl = document.getElementById(`qr-svg-${slug}`);
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `711acks-qr-${slug}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export structured JSON backup with Storage Asset Manifest
  const handleDownloadBackup = async () => {
    setBackupFeedback('');
    const res = await generateBackupPackage();
    if (!res.success || !res.backup) {
      setBackupFeedback(res.error || 'Could not generate backup package.');
      return;
    }
    const pkg = res.backup;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `711acks-full-backup-${pkg.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setBackupFeedback(
      `Exported backup with ${pkg.data.recipes.length} recipes, ${pkg.data.products.length} products, and ${pkg.storageAssetManifest.totalAssets} image manifest paths.`
    );
  };

  const handleBackupFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBackupFeedback('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(reader.result as string);
        if (parsed === null) {
          setPendingRestoreJson(null);
          setBackupFeedback('Backup file cannot be null.');
          return;
        }
        setPendingRestoreJson(parsed);
      } catch {
        setPendingRestoreJson(null);
        setBackupFeedback('Invalid JSON file selected.');
      }
    };
    reader.readAsText(file);
  };

  // ============================================================================
  // RENDER GATE: TWO-FACTOR EMAIL OTP AUTHENTICATION (Section 13)
  // ============================================================================
  if (!adminSession) {
    return (
      <div className="min-h-screen bg-[#17201B] text-[#F5F3EC] py-16 px-6 flex flex-col justify-center">
        <div className="max-w-md mx-auto w-full space-y-8">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => onNavigate({ page: 'home' })}
              className="text-xs font-semibold uppercase tracking-wider text-[#D7E07A] hover:underline flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Public Site</span>
            </button>
            <span className="font-mono-tabular text-xs text-[#C9C5B8]">
              No Public Signup
            </span>
          </div>

          <div className="p-8 bg-[#1E2B23] border border-[#294735] rounded-md space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-mono-tabular uppercase tracking-widest text-[#D7E07A]">
                <Lock className="w-4 h-4" />
                <span>OWNER AUTHENTICATION + 2FA OTP</span>
              </div>
              <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                711acks Admin Console
              </h1>
              <p className="text-xs text-[#C9C5B8] leading-relaxed">
                Protected by two-step authentication. An unrestricted session is never released until both password verification and the 6-digit one-time challenge succeed.
              </p>
            </div>

            {isLiveSupabase && (
              <div className="p-3.5 bg-[#17201B] border border-[#294735] rounded text-xs text-[#C9C5B8] space-y-1">
                <div className="font-semibold text-[#D7E07A]">
                  Server-Side Email OTP Active (Live Mode)
                </div>
                <p>
                  Owner authentication verifies your password server-side, dispatches a single-use 6-digit OTP to your registered email, and releases a memory-only session with a 30-minute server-enforced inactivity timeout.
                </p>
              </div>
            )}

            {sessionExpiredReason && (
              <div
                role="status"
                className="p-3.5 bg-amber-950/60 border border-amber-500/60 rounded text-xs text-amber-200"
              >
                {sessionExpiredReason}
              </div>
            )}

            {authError && (
              <div
                role="alert"
                className="p-3.5 bg-red-950/60 border border-red-500/60 rounded text-xs text-red-200"
              >
                {authError}
              </div>
            )}

            {authNotice && (
              <div className="p-3.5 bg-[#294735]/60 border border-[#D7E07A]/50 rounded text-xs text-[#F5F3EC]">
                {authNotice}
              </div>
            )}

            {lockoutUntil && lockoutUntil > Date.now() && (
              <div className="p-3.5 bg-amber-950/60 border border-amber-500/60 rounded text-xs text-amber-200">
                Login rate-limit lockout is active due to repeated failed attempts.
              </div>
            )}

            {/* STEP 0: Complete Password Recovery (Live recovery link; never bypasses OTP) */}
            {pendingPasswordRecovery ? (
              <form onSubmit={handleCompletePasswordRecovery} className="space-y-4">
                <div className="p-3.5 bg-[#17201B] border border-[#D7E07A]/50 rounded text-xs space-y-1.5">
                  <div className="font-semibold text-[#D7E07A]">
                    Complete Owner Password Reset
                  </div>
                  <p className="text-[#C9C5B8]">
                    Set a new strong administrator password (at least 12 characters with uppercase, lowercase, a number, and a symbol). After updating your password, you must complete full Password + 6-digit Email OTP sign-in.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="recovery-new-password"
                    className="block text-xs font-semibold uppercase tracking-wider"
                  >
                    New Owner Password
                  </label>
                  <input
                    id="recovery-new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    disabled={isAuthSubmitting}
                    value={recoveryNewPassword}
                    onChange={(e) => setRecoveryNewPassword(e.target.value)}
                    placeholder="Min 12 chars, upper/lower/number/symbol"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#17201B] border border-[#294735] rounded text-[#F5F3EC] disabled:opacity-60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="recovery-confirm-password"
                    className="block text-xs font-semibold uppercase tracking-wider"
                  >
                    Confirm New Password
                  </label>
                  <input
                    id="recovery-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    disabled={isAuthSubmitting}
                    value={recoveryConfirmPassword}
                    onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
                    placeholder="Re-enter new owner password"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#17201B] border border-[#294735] rounded text-[#F5F3EC] disabled:opacity-60"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={isAuthSubmitting}
                    onClick={() => {
                      setRecoveryNewPassword('');
                      setRecoveryConfirmPassword('');
                      setAuthError('');
                      cancelPasswordRecovery();
                    }}
                    className="text-xs text-[#C9C5B8] underline cursor-pointer disabled:opacity-50"
                  >
                    Cancel & Return to Login
                  </button>
                  <button
                    type="submit"
                    disabled={isAuthSubmitting}
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#D7E07A] text-[#17201B] rounded cursor-pointer disabled:opacity-60"
                  >
                    {isAuthSubmitting ? 'Updating Password...' : 'Update Owner Password'}
                  </button>
                </div>
              </form>
            ) : !pendingOtpChallenge ? (
              showRecoveryForm ? (
                <form onSubmit={handlePasswordRecovery} className="space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="recovery-email"
                      className="block text-xs font-semibold uppercase tracking-wider"
                    >
                      Registered Owner Email
                    </label>
                    <input
                      id="recovery-email"
                      type="email"
                      required
                      disabled={isAuthSubmitting}
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm bg-[#17201B] border border-[#294735] rounded text-[#F5F3EC] disabled:opacity-60"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      disabled={isAuthSubmitting}
                      onClick={() => setShowRecoveryForm(false)}
                      className="text-xs text-[#C9C5B8] underline cursor-pointer disabled:opacity-50"
                    >
                      Back to Login
                    </button>
                    <button
                      type="submit"
                      disabled={isAuthSubmitting}
                      className="px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#D7E07A] text-[#17201B] rounded cursor-pointer disabled:opacity-60"
                    >
                      {isAuthSubmitting ? 'Sending...' : 'Send Recovery Email'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="admin-email"
                      className="block text-xs font-semibold uppercase tracking-wider"
                    >
                      Administrator Email
                    </label>
                    <input
                      id="admin-email"
                      type="email"
                      autoComplete="username"
                      required
                      disabled={isAuthSubmitting}
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="owner@yourdomain.com"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#17201B] border border-[#294735] rounded text-[#F5F3EC] disabled:opacity-60"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="admin-password"
                      className="block text-xs font-semibold uppercase tracking-wider"
                    >
                      Password
                    </label>
                    <input
                      id="admin-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      disabled={isAuthSubmitting}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter owner password"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#17201B] border border-[#294735] rounded text-[#F5F3EC] disabled:opacity-60"
                    />
                  </div>

                  {!isLiveSupabase && (
                    <div className="p-3 bg-[#17201B] border border-[#294735] rounded text-xs text-[#C9C5B8] space-y-1">
                      <div className="text-[#D7E07A] font-semibold">
                        Portfolio Preview Credential Info:
                      </div>
                      <div>
                        Email: <code className="font-mono-tabular">admin@711acks.ph</code>
                      </div>
                      <div>
                        Password:{' '}
                        <code className="font-mono-tabular">Midnight711!Hacks</code>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLoginEmail('admin@711acks.ph');
                          setLoginPassword('Midnight711!Hacks');
                        }}
                        className="mt-1 text-xs text-[#D7E07A] underline cursor-pointer"
                      >
                        Auto-fill preview credentials
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isAuthSubmitting}
                    className="w-full py-3 text-xs font-semibold uppercase tracking-wider bg-[#D7E07A] text-[#17201B] rounded hover:bg-[#e2ea8b] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isAuthSubmitting
                      ? 'Verifying Credentials & Sending Code...'
                      : 'Verify Credentials & Request Email OTP'}
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      disabled={isAuthSubmitting}
                      onClick={() => setShowRecoveryForm(true)}
                      className="text-xs text-[#C9C5B8] hover:text-[#D7E07A] underline cursor-pointer disabled:opacity-50"
                    >
                      Forgot password? Request email recovery
                    </button>
                  </div>
                </form>
              )
            ) : (
              /* STEP 2: Six-Digit Email OTP Second Factor Challenge */
              <form onSubmit={handleOtpSubmit} className="space-y-4">
                <div className="p-3.5 bg-[#17201B] border border-[#D7E07A]/50 rounded text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[#D7E07A] font-semibold">
                    <KeyRound className="w-4 h-4" />
                    <span>Step 2 of 2: Six-Digit One-Time Email Code</span>
                  </div>
                  <p className="text-[#C9C5B8]">
                    {isLiveSupabase ? (
                      <>
                        A single-use 6-digit verification code has been emailed to{' '}
                        <strong>{pendingOtpChallenge.email}</strong> (expires in 5 minutes, max{' '}
                        {pendingOtpChallenge.maxAttempts} attempts).
                      </>
                    ) : (
                      <>
                        A one-time hashed challenge has been generated for{' '}
                        <strong>{pendingOtpChallenge.email}</strong> (expires in 5 minutes, max{' '}
                        {pendingOtpChallenge.maxAttempts} attempts).
                      </>
                    )}
                  </p>
                  {!isLiveSupabase && pendingOtpChallenge.demoOtpDisplay && (
                    <div className="pt-1 text-[#F5F3EC]">
                      Preview Email Dispatch Outbox Code:{' '}
                      <strong
                        data-testid="admin-otp-demo-code"
                        className="font-mono-tabular text-sm text-[#D7E07A] tracking-widest"
                      >
                        {pendingOtpChallenge.demoOtpDisplay}
                      </strong>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="admin-otp-code"
                    className="block text-xs font-semibold uppercase tracking-wider"
                  >
                    Enter 6-Digit One-Time Code
                  </label>
                  <input
                    id="admin-otp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    disabled={isAuthSubmitting}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-digit OTP"
                    className="w-full px-3.5 py-2.5 text-center font-mono-tabular text-lg tracking-[0.35em] bg-[#17201B] border border-[#294735] rounded text-[#D7E07A] disabled:opacity-60"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isAuthSubmitting || otpInput.length !== 6}
                  className="w-full py-3 text-xs font-semibold uppercase tracking-wider bg-[#D7E07A] text-[#17201B] rounded hover:bg-[#e2ea8b] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isAuthSubmitting
                    ? 'Verifying 6-Digit Code...'
                    : 'Verify 2FA Code & Unlock Dashboard'}
                </button>

                <div className="flex items-center justify-between text-xs pt-2">
                  <button
                    type="button"
                    disabled={
                      isResendingOtp || isAuthSubmitting || resendCooldownSeconds > 0
                    }
                    onClick={handleResendOtp}
                    className="text-[#D7E07A] hover:underline cursor-pointer disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                  >
                    {isResendingOtp
                      ? 'Sending new code...'
                      : resendCooldownSeconds > 0
                      ? `Resend code in ${resendCooldownSeconds}s`
                      : 'Resend new 6-digit code'}
                  </button>
                  <button
                    type="button"
                    disabled={isAuthSubmitting || isResendingOtp}
                    onClick={() => {
                      setOtpInput('');
                      setAuthError('');
                      setAuthNotice('');
                      logoutAdmin('Cancelled OTP challenge.');
                    }}
                    className="text-[#C9C5B8] hover:underline cursor-pointer disabled:opacity-50"
                  >
                    Cancel login
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // VERIFIED ADMIN DASHBOARD INTERFACE (10 Modules per Section 14)
  // ============================================================================
  const navModules: { id: AdminModule; label: string; count?: number }[] = [
    { id: 'overview', label: '01. Overview & Analytics' },
    { id: 'recipes', label: '02. Recipe Management', count: recipes.length },
    {
      id: 'submissions',
      label: '03. Submission Approvals',
      count: pendingSubmissions.length,
    },
    { id: 'products', label: '04. Product Catalog', count: products.length },
    {
      id: 'reports',
      label: '05. Contact Reports',
      count: contactReports.filter((r) => r.status === 'Open').length,
    },
    { id: 'qrcodes', label: '06. QR Code Management', count: publishedRecipes.length },
    { id: 'revisions', label: '07. Revision History', count: recipeRevisions.length },
    { id: 'backups', label: '08. Backup & Data Export' },
    { id: 'maintenance', label: '09. Maintenance Mode' },
    { id: 'settings', label: '10. Admin Settings & Security' },
  ];

  const filteredCatalog = products.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcode && p.barcode.includes(productSearch))
  );

  return (
    <div
      onClick={touchAdminActivity}
      className="min-h-screen bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] flex flex-col"
    >
      {/* Protected Admin Top Bar */}
      <header className="bg-[#17201B] text-[#F5F3EC] border-b border-[#294735] px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="font-display text-lg font-light tracking-[0.22em] uppercase text-[#D7E07A]">
            711ACKS ADMIN
          </span>
          <span className="text-xs text-[#C9C5B8] hidden sm:inline">
            Verified 2FA Session: {adminSession.email}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {/* 30-Minute Inactivity Countdown */}
          <div
            className={`px-3 py-1.5 rounded border font-mono-tabular flex items-center gap-1.5 ${
              remainingSeconds < 180
                ? 'border-amber-500 text-amber-300 bg-amber-950/40'
                : 'border-[#294735] text-[#C9C5B8]'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-[#D7E07A]" />
            <span>
              Session Timer: {Math.floor(remainingSeconds / 60)}:
              {(remainingSeconds % 60).toString().padStart(2, '0')}
            </span>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle dashboard theme"
            className="p-2 rounded border border-[#294735] text-[#F5F3EC] hover:border-[#D7E07A] cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-[#D7E07A]" />
            ) : (
              <Moon className="w-4 h-4 text-[#D7E07A]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onNavigate({ page: 'home' })}
            className="px-3 py-1.5 rounded border border-[#294735] text-[#F5F3EC] hover:border-[#D7E07A] cursor-pointer"
          >
            Public Site
          </button>

          <button
            type="button"
            onClick={() => logoutAdmin('Administrator signed out.')}
            className="px-3 py-1.5 rounded bg-red-900/60 text-red-100 border border-red-700/60 hover:bg-red-800 flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Dashboard Layout */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Sidebar Module Navigation */}
        <aside className="lg:col-span-3 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md p-3 space-y-1">
          {navModules.map((mod) => {
            const active = activeModule === mod.id;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => setActiveModule(mod.id)}
                className={`w-full px-3 py-2.5 rounded text-left text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] font-semibold'
                    : 'text-[#17201B] dark:text-[#F5F3EC] hover:bg-[#294735]/10 dark:hover:bg-[#294735]/40'
                }`}
              >
                <span className="truncate">{mod.label}</span>
                {typeof mod.count === 'number' && (
                  <span className="font-mono-tabular text-xs ml-2">
                    {mod.count}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        {/* Active Module Workspace */}
        <main className="lg:col-span-9 space-y-6">
          {adminDataError && (
            <div
              role="alert"
              className="p-4 bg-red-500/10 border border-red-500/40 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300"
            >
              <span>Admin data sync error: {adminDataError}</span>
              <button
                type="button"
                onClick={() => void refreshAdminData()}
                className="px-3 py-1.5 rounded border border-red-500/40 hover:bg-red-500/10 font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Sync</span>
              </button>
            </div>
          )}

          {isLoadingAdminData && (
            <div
              role="status"
              className="p-3 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded text-xs text-[#17201B]/75 dark:text-[#C9C5B8]"
            >
              Syncing latest administrator records from database...
            </div>
          )}

          {/* MODULE 1: OVERVIEW & ANALYTICS */}
          {activeModule === 'overview' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  01. Dashboard Analytics &amp; Overview
                </h1>
              </div>

              {/* 4 Key Statistic Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md">
                  <div className="text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                    Total Published Drinks
                  </div>
                  <div className="font-mono-tabular text-3xl font-bold text-[#294735] dark:text-[#D7E07A] mt-2">
                    {publishedRecipes.length}
                  </div>
                </div>

                <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md">
                  <div className="text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                    Pending Submissions
                  </div>
                  <div className="font-mono-tabular text-3xl font-bold text-[#294735] dark:text-[#D7E07A] mt-2">
                    {pendingSubmissions.length}
                  </div>
                </div>

                <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md">
                  <div className="text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                    Total Community Likes
                  </div>
                  <div className="font-mono-tabular text-3xl font-bold text-[#294735] dark:text-[#D7E07A] mt-2">
                    {totalLikes}
                  </div>
                </div>

                <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md">
                  <div className="text-xs text-[#17201B]/65 dark:text-[#C9C5B8]">
                    Verified 7-Eleven Products
                  </div>
                  <div className="font-mono-tabular text-3xl font-bold text-[#294735] dark:text-[#D7E07A] mt-2">
                    {products.filter((p) => !p.isArchived).length}
                  </div>
                </div>
              </div>

              {/* Price Review Alert Banner if any recipe was flagged by a Product Catalog price change */}
              {recipes.some((r) => r.needsPriceReview) && (
                <div className="p-4 bg-amber-950/15 dark:bg-amber-950/40 border border-amber-500/60 rounded-md flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 text-xs">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-300 shrink-0" />
                    <span>
                      <strong>Price Snapshot Alert:</strong>{' '}
                      {recipes.filter((r) => r.needsPriceReview).length} published recipe(s) use a product whose catalog price changed. Historical totals remain preserved until you review and update them.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveModule('recipes')}
                    className="px-3 py-1.5 text-xs font-semibold bg-amber-500 text-[#17201B] rounded shrink-0 cursor-pointer"
                  >
                    Review Recipes
                  </button>
                </div>
              )}

              {/* Most Popular Drinks Chart & Recent Submissions */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider">
                    Most Popular Drinks (By Likes)
                  </h2>
                  <div className="space-y-3">
                    {mostPopularDrinks.map((drink) => {
                      const maxLikes = Math.max(
                        1,
                        mostPopularDrinks[0]?.likesCount || 1
                      );
                      const pct = Math.round((drink.likesCount / maxLikes) * 100);
                      return (
                        <div key={drink.id} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium truncate">
                              {drink.name}
                            </span>
                            <span className="font-mono-tabular font-semibold text-[#294735] dark:text-[#D7E07A]">
                              {drink.likesCount} likes ·{' '}
                              {formatPhpCurrency(drink.totalPurchaseCost)}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-[#F5F3EC] dark:bg-[#17201B] rounded overflow-hidden">
                            <div
                              className="h-full bg-[#294735] dark:bg-[#D7E07A]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider">
                    Recent Submissions &amp; Activity
                  </h2>
                  <div className="space-y-3 text-xs">
                    {communitySubmissions.slice(0, 4).map((sub) => (
                      <div
                        key={sub.id}
                        className="p-3 bg-[#F5F3EC] dark:bg-[#17201B] rounded border border-[#C9C5B8]/40 dark:border-[#294735] flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-semibold">{sub.drinkName}</div>
                          <div className="text-[#17201B]/65 dark:text-[#C9C5B8]">
                            By {sub.submitterName} · {sub.category}
                          </div>
                        </div>
                        <span className="font-mono-tabular font-semibold text-[#294735] dark:text-[#D7E07A]">
                          {sub.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MODULE 2: RECIPE MANAGEMENT */}
          {activeModule === 'recipes' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <div>
                  <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                    02. Recipe Management
                  </h1>
                  <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
                    Manage Draft, Pending, Published, Rejected, and Archived recipes. Edit published recipes as private drafts without taking them offline.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateRecipeForm}
                  className="px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create New Recipe</span>
                </button>
              </div>

              {recipeMsg && (
                <div className="p-3.5 bg-[#294735]/20 border border-[#294735] dark:border-[#D7E07A] rounded text-xs">
                  {recipeMsg}
                </div>
              )}

              {/* Recipe Editor Panel */}
              {showRecipeForm && (
                <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#294735] dark:border-[#D7E07A] rounded-md space-y-5">
                  <div className="flex items-center justify-between border-b border-[#C9C5B8]/40 dark:border-[#294735] pb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider">
                      {editingRecipeId ? 'Edit Recipe' : 'Create Recipe'}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowRecipeForm(false)}
                      className="text-xs underline cursor-pointer"
                    >
                      Close Editor
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold">
                        Drink Name *
                      </label>
                      <input
                        type="text"
                        value={recipeName}
                        onChange={(e) => setRecipeName(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold">
                        Primary Category *
                      </label>
                      <select
                        value={recipeCategory}
                        onChange={(e) =>
                          setRecipeCategory(e.target.value as DrinkCategory)
                        }
                        className="w-full px-3 py-2 text-xs bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                      >
                        {APPROVED_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold">
                        Status *
                      </label>
                      <select
                        value={recipeStatus}
                        onChange={(e) =>
                          setRecipeStatus(e.target.value as RecipeStatus)
                        }
                        className="w-full px-3 py-2 text-xs bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                      >
                        <option value="Draft">Draft</option>
                        <option value="Pending">Pending</option>
                        <option value="Published">Published</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Archived">Archived</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold">
                        Taste Notes
                      </label>
                      <input
                        type="text"
                        value={recipeTasteNotes}
                        onChange={(e) => setRecipeTasteNotes(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                      />
                    </div>

                    <div className="flex items-center gap-6 pt-5 text-xs">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={recipeEditorsPick}
                          onChange={(e) => setRecipeEditorsPick(e.target.checked)}
                        />
                        <span>Editor&apos;s Pick</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={recipeTrending}
                          onChange={(e) => setRecipeTrending(e.target.checked)}
                        />
                        <span>Trending Section</span>
                      </label>
                    </div>
                  </div>

                  {/* Ingredients Builder */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase">
                        Catalog Ingredients &amp; Units to Purchase
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const p = products.find((item) => !item.isArchived);
                          if (!p) return;
                          setRecipeIngredients((prev) => [
                            ...prev,
                            {
                              id: 'ing-' + Date.now(),
                              productId: p.id,
                              productNameSnapshot: p.name,
                              productPhotoSnapshot: p.photoUrl,
                              quantityUsed: '1 unit',
                              unitsToPurchase: 1,
                              priceSnapshot: p.purchasePrice,
                              priceVerified: true,
                            },
                          ]);
                        }}
                        className="px-2.5 py-1 text-xs bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
                      >
                        + Add Product Row
                      </button>
                    </div>

                    {recipeIngredients.map((ing, i) => (
                      <div
                        key={ing.id}
                        className="p-3 bg-[#F5F3EC] dark:bg-[#17201B] rounded border border-[#C9C5B8]/50 dark:border-[#294735] grid grid-cols-1 sm:grid-cols-12 gap-3 items-center text-xs"
                      >
                        <div className="sm:col-span-5">
                          <select
                            value={ing.productId || ''}
                            onChange={(e) => {
                              const found = products.find(
                                (p) => p.id === e.target.value
                              );
                              if (!found) return;
                              setRecipeIngredients((prev) =>
                                prev.map((item, idx) =>
                                  idx === i
                                    ? {
                                        ...item,
                                        productId: found.id,
                                        productNameSnapshot: found.name,
                                        productPhotoSnapshot: found.photoUrl,
                                        priceSnapshot: found.purchasePrice,
                                        priceVerified: true,
                                      }
                                    : item
                                )
                              );
                            }}
                            className="w-full px-2.5 py-1.5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8] dark:border-[#294735] rounded"
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({formatPhpCurrency(p.purchasePrice)})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            value={ing.quantityUsed}
                            onChange={(e) =>
                              setRecipeIngredients((prev) =>
                                prev.map((item, idx) =>
                                  idx === i
                                    ? { ...item, quantityUsed: e.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="Amount used"
                            className="w-full px-2.5 py-1.5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8] dark:border-[#294735] rounded"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <input
                            type="number"
                            min="1"
                            value={ing.unitsToPurchase}
                            onChange={(e) =>
                              setRecipeIngredients((prev) =>
                                prev.map((item, idx) =>
                                  idx === i
                                    ? {
                                        ...item,
                                        unitsToPurchase: Math.max(
                                          1,
                                          parseInt(e.target.value || '1', 10)
                                        ),
                                      }
                                    : item
                                )
                              )
                            }
                            className="w-full px-2.5 py-1.5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8] dark:border-[#294735] rounded font-mono-tabular"
                          />
                        </div>

                        <div className="sm:col-span-1 text-right">
                          {recipeIngredients.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setRecipeIngredients((prev) =>
                                  prev.filter((_, idx) => idx !== i)
                                )
                              }
                              className="text-red-500 hover:underline cursor-pointer"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#C9C5B8]/40 dark:border-[#294735]">
                    <div className="text-xs font-mono-tabular">
                      Calculated Full Purchase Cost:{' '}
                      <strong className="text-[#294735] dark:text-[#D7E07A]">
                        {formatPhpCurrency(
                          calculateFullPurchaseCost(recipeIngredients)
                            .totalPurchaseCost
                        )}
                      </strong>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {editingRecipeId && (
                        <button
                          type="button"
                          onClick={() => void handleSaveRecipeSubmit(true)}
                          className="px-3.5 py-2 text-xs font-medium border border-[#294735] dark:border-[#D7E07A] rounded cursor-pointer"
                        >
                          Save Draft Without Altering Live Version
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleSaveRecipeSubmit(false)}
                        className="px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
                      >
                        Save &amp; Record Revision
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Recipes Table */}
              <div className="space-y-3">
                {recipes.map((recipe) => (
                  <div
                    key={recipe.id}
                    className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4">
                      <img
                        src={recipe.photoUrl}
                        alt={recipe.name}
                        className="w-14 h-14 rounded object-cover bg-[#17201B] shrink-0"
                      />
                      <div className="space-y-1 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {recipe.name}
                          </span>
                          <span className="font-mono-tabular text-[#294735] dark:text-[#D7E07A]">
                            [{recipe.status}]
                          </span>
                          {recipe.needsPriceReview && (
                            <span className="text-amber-600 dark:text-amber-300 font-semibold">
                              · Flagged for Catalog Price Review
                            </span>
                          )}
                          {recipe.pendingDraft && (
                            <span className="text-emerald-600 dark:text-emerald-300 font-semibold">
                              · Unmerged Draft Edit Saved
                            </span>
                          )}
                        </div>
                        <div className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                          {recipe.category} · Snapshot Purchase Cost:{' '}
                          <strong className="font-mono-tabular">
                            {formatPhpCurrency(recipe.totalPurchaseCost)}
                          </strong>{' '}
                          · {recipe.ingredients.length} ingredients
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {recipe.needsPriceReview && (
                        <button
                          type="button"
                          onClick={async () => {
                            setRecipeMsg('');
                            const res = await verifyRecipeCurrentCatalogPrices(
                              recipe.id
                            );
                            if (!res.success) {
                              setRecipeMsg(
                                res.error || 'Could not update catalog prices.'
                              );
                            } else {
                              setRecipeMsg(
                                `Updated "${recipe.name}" to current catalog prices and recorded snapshot.`
                              );
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-semibold bg-amber-500 text-[#17201B] rounded flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Update to New Catalog Price</span>
                        </button>
                      )}
                      {recipe.pendingDraft && (
                        <button
                          type="button"
                          onClick={async () => {
                            setRecipeMsg('');
                            const res = await applyPendingDraftToPublished(
                              recipe.id
                            );
                            if (!res.success) {
                              setRecipeMsg(
                                res.error || 'Could not publish pending draft.'
                              );
                            } else {
                              setRecipeMsg(
                                `Published pending draft for "${recipe.name}".`
                              );
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded cursor-pointer"
                        >
                          Publish Pending Draft
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditRecipeForm(recipe)}
                        className="px-3 py-1.5 text-xs font-medium border border-[#C9C5B8] dark:border-[#294735] rounded flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MODULE 3: COMMUNITY SUBMISSION APPROVALS */}
          {activeModule === 'submissions' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  03. Community Submission Approvals
                </h1>
                <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Community submissions remain strictly private until you verify every ingredient purchase price and approve them.
                </p>
              </div>

              {reviewingSubmission && (
                <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#294735] dark:border-[#D7E07A] rounded-md space-y-5">
                  <div className="flex items-center justify-between border-b border-[#C9C5B8]/40 dark:border-[#294735] pb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider">
                      Review &amp; Verify Submission: {reviewingSubmission.drinkName}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setReviewingSubmission(null)}
                      className="text-xs underline cursor-pointer"
                    >
                      Close Review
                    </button>
                  </div>

                  {approvalError && (
                    <div className="p-3 bg-red-950/30 border border-red-500/50 rounded text-xs text-red-400">
                      {approvalError}
                    </div>
                  )}

                  {approvalSignedPhotoPreview && (
                    <div className="flex items-center gap-3 p-3 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8]/40 dark:border-[#294735] rounded text-xs">
                      <img
                        src={approvalSignedPhotoPreview}
                        alt={reviewingSubmission.drinkName}
                        className="w-16 h-16 rounded object-cover bg-[#17201B] shrink-0"
                      />
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-semibold">
                          Submitted Photo (Private Review Preview)
                        </div>
                        <div className="text-[#17201B]/65 dark:text-[#C9C5B8] truncate">
                          {isRelativeStoragePath(
                            reviewingSubmission.finishedPhotoUrl || ''
                          )
                            ? 'Loaded via short-lived signed Storage URL.'
                            : 'Preview image attached to submission.'}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1">
                      <label className="font-semibold">Drink Name</label>
                      <input
                        type="text"
                        value={approvalName}
                        onChange={(e) => setApprovalName(e.target.value)}
                        className="w-full px-3 py-2 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold">Primary Category</label>
                      <select
                        value={approvalCategory}
                        onChange={(e) =>
                          setApprovalCategory(e.target.value as DrinkCategory)
                        }
                        className="w-full px-3 py-2 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                      >
                        {APPROVED_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Verify Ingredient Prices */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase">
                      Verify All Ingredient Prices Before Approval
                    </div>
                    {approvalIngredients.map((ing, idx) => (
                      <div
                        key={ing.id}
                        className="p-3 bg-[#F5F3EC] dark:bg-[#17201B] rounded border border-[#C9C5B8]/40 dark:border-[#294735] flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-semibold">
                            {ing.productNameSnapshot}
                          </div>
                          <div className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                            Quantity: {ing.quantityUsed} · Units to buy:{' '}
                            {ing.unitsToPurchase}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1">
                            <span>Unit Price ₱:</span>
                            <input
                              type="number"
                              step="0.5"
                              value={ing.priceSnapshot ?? ''}
                              onChange={(e) =>
                                setApprovalIngredients((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          priceSnapshot: parseFloat(
                                            e.target.value || '0'
                                          ),
                                        }
                                      : item
                                  )
                                )
                              }
                              className="w-24 px-2 py-1 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8] dark:border-[#294735] rounded font-mono-tabular"
                            />
                          </label>

                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ing.priceVerified}
                              onChange={(e) =>
                                setApprovalIngredients((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? { ...item, priceVerified: e.target.checked }
                                      : item
                                  )
                                )
                              }
                            />
                            <span className="font-semibold text-[#294735] dark:text-[#D7E07A]">
                              Price Verified
                            </span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="text-xs font-mono-tabular">
                      Verified Total:{' '}
                      <strong>
                        {formatPhpCurrency(
                          calculateFullPurchaseCost(approvalIngredients)
                            .totalPurchaseCost
                        )}
                      </strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setApprovalError('');
                          const res = await rejectCommunitySubmission(
                            reviewingSubmission.id,
                            'Rejected during admin review.'
                          );
                          if (!res.success) {
                            setApprovalError(
                              res.error || 'Could not reject submission.'
                            );
                            return;
                          }
                          setReviewingSubmission(null);
                        }}
                        className="px-3.5 py-2 text-xs font-medium bg-red-900/60 text-red-100 rounded cursor-pointer"
                      >
                        Reject Submission
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleConfirmApproveSubmission()}
                        className="px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
                      >
                        Approve &amp; Publish Recipe
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {submissionActionMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-700 dark:text-red-300">
                  {submissionActionMsg}
                </div>
              )}

              <div className="space-y-3">
                {communitySubmissions.map((sub) => {
                  const dupMatches = detectDuplicateRecipes(
                    sub.drinkName,
                    sub.ingredients.map((i) => i.productId),
                    sub.ingredients.map((i) => i.suggestedProductName || ''),
                    recipes
                  );

                  return (
                    <div
                      key={sub.id}
                      className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-semibold">
                            {sub.drinkName}
                          </span>{' '}
                          · <span>{sub.category}</span> ·{' '}
                          <span>Submitted by {sub.submitterName}</span>
                        </div>
                        <span className="font-mono-tabular font-semibold text-[#294735] dark:text-[#D7E07A]">
                          Status: {sub.status}
                        </span>
                      </div>

                      {sub.duplicateWarningNotes && (
                        <div className="text-amber-700 dark:text-amber-300">
                          Note: {sub.duplicateWarningNotes}
                        </div>
                      )}

                      {dupMatches.length > 0 && (
                        <div className="text-amber-700 dark:text-amber-300">
                          Duplicate check: overlaps with{' '}
                          {dupMatches.map((d) => d.recipeName).join(', ')}
                        </div>
                      )}

                      {sub.status === 'Pending' && (
                        <div className="pt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startSubmissionReview(sub)}
                            className="px-3.5 py-1.5 text-xs font-semibold bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
                          >
                            Review &amp; Verify Prices
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setSubmissionActionMsg('');
                              const res = await rejectCommunitySubmission(
                                sub.id,
                                'Declined by administrator.'
                              );
                              if (!res.success) {
                                setSubmissionActionMsg(
                                  res.error || 'Could not reject submission.'
                                );
                              }
                            }}
                            className="px-3 py-1.5 text-xs border border-red-500/50 text-red-600 dark:text-red-400 rounded cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* MODULE 4: CENTRAL PRODUCT CATALOG (Section 15) */}
          {activeModule === 'products' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  04. Central 7-Eleven Product Catalog
                </h1>
                <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Stores verified 7-Eleven Philippines products (Product Name, Actual Product Photo, Purchase Price, Optional Manual Barcode, Auto Last Updated Date). Changing a product price flags affected recipes for review without silently altering historical recipe costs.
                </p>
              </div>

              {/* Add / Edit Product Form */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setProdFeedback('');
                  const res = await addOrUpdateProduct({
                    id: editingProductId || undefined,
                    name: prodName,
                    purchasePrice: parseFloat(prodPrice),
                    barcode: prodBarcode || undefined,
                    photoUrl: prodPhotoUrl || products[0]?.photoUrl || '',
                    isArchived: false,
                  });
                  if (!res.success) {
                    setProdFeedback(res.error || 'Could not save product.');
                    return;
                  }
                  setProdFeedback(
                    res.flaggedRecipesCount && res.flaggedRecipesCount > 0
                      ? `Product price updated! ${res.flaggedRecipesCount} affected recipe(s) have been marked for price review while preserving their historical verified totals.`
                      : 'Product saved to central catalog.'
                  );
                  setEditingProductId(null);
                  setProdName('');
                  setProdPrice('');
                  setProdBarcode('');
                }}
                className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-4 text-xs"
              >
                <div className="font-semibold uppercase tracking-wider">
                  {editingProductId
                    ? 'Edit Product & Update Price'
                    : 'Add Verified 7-Eleven Product'}
                </div>

                {prodFeedback && (
                  <div className="p-3 bg-[#294735]/20 border border-[#294735] dark:border-[#D7E07A] rounded">
                    {prodFeedback}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="block font-medium">Product Name *</label>
                    <input
                      type="text"
                      required
                      value={prodName}
                      onChange={(e) => setProdName(e.target.value)}
                      placeholder="e.g. Kopiko Lucky Day 180ml"
                      className="w-full px-3 py-2 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium">
                      Purchase Price (₱) *
                    </label>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      required
                      value={prodPrice}
                      onChange={(e) => setProdPrice(e.target.value)}
                      placeholder="29.00"
                      className="w-full px-3 py-2 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded font-mono-tabular"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium">
                      Barcode (Optional Manual Entry)
                    </label>
                    <input
                      type="text"
                      value={prodBarcode}
                      onChange={(e) => setProdBarcode(e.target.value)}
                      placeholder="8 to 14-digit EAN/UPC"
                      className="w-full px-3 py-2 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded font-mono-tabular"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#C9C5B8] dark:border-[#294735] rounded cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload / Replace Product Photo</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const res = await validateAndOptimizeImageFile(f);
                        if (res.valid && res.dataUrl) {
                          setProdPhotoUrl(res.dataUrl);
                        } else {
                          setProdFeedback(res.error || 'Invalid image.');
                        }
                      }}
                      className="hidden"
                    />
                  </label>

                  <div className="flex items-center gap-2">
                    {editingProductId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProductId(null);
                          setProdName('');
                          setProdPrice('');
                          setProdBarcode('');
                        }}
                        className="px-3 py-2 border border-[#C9C5B8] dark:border-[#294735] rounded cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      className="px-4 py-2 font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
                    >
                      {editingProductId ? 'Save Product Changes' : 'Add to Catalog'}
                    </button>
                  </div>
                </div>
              </form>

              {/* Search Products */}
              <div>
                <input
                  type="search"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search catalog by product name or barcode..."
                  className="w-full px-3.5 py-2 text-xs bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8] dark:border-[#294735] rounded"
                />
              </div>

              {/* Catalog Grid */}
              <div className="space-y-3">
                {filteredCatalog.map((prod) => (
                  <div
                    key={prod.id}
                    className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md flex flex-wrap items-center justify-between gap-4 text-xs"
                  >
                    <div className="flex items-center gap-3.5">
                      <img
                        src={prod.photoUrl}
                        alt={prod.name}
                        className="w-14 h-14 rounded object-cover bg-[#17201B] shrink-0"
                      />
                      <div className="space-y-0.5">
                        <div className="text-sm font-semibold">
                          {prod.name}{' '}
                          {prod.isArchived && (
                            <span className="text-red-500">(Archived)</span>
                          )}
                        </div>
                        <div className="font-mono-tabular text-[#294735] dark:text-[#D7E07A] font-semibold">
                          Verified Price: {formatPhpCurrency(prod.purchasePrice)}
                          {prod.barcode ? ` · Barcode: ${prod.barcode}` : ''}
                        </div>
                        <div className="text-[#17201B]/60 dark:text-[#C9C5B8]">
                          Last updated:{' '}
                          {new Date(prod.lastUpdatedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProductId(prod.id);
                          setProdName(prod.name);
                          setProdPrice(prod.purchasePrice.toString());
                          setProdBarcode(prod.barcode || '');
                          setProdPhotoUrl(prod.photoUrl);
                        }}
                        className="px-3 py-1.5 border border-[#C9C5B8] dark:border-[#294735] rounded cursor-pointer"
                      >
                        Edit / Update Price
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setProdFeedback('');
                          const res = await toggleArchiveProduct(prod.id);
                          if (!res.success) {
                            setProdFeedback(
                              res.error || 'Could not update archive status.'
                            );
                          }
                        }}
                        className="px-3 py-1.5 border border-[#C9C5B8] dark:border-[#294735] rounded cursor-pointer flex items-center gap-1"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>{prod.isArchived ? 'Unarchive' : 'Archive'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MODULE 5: CONTACT REPORTS */}
          {activeModule === 'reports' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  05. Contact Reports &amp; Price Alerts
                </h1>
              </div>

              {reportActionMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-700 dark:text-red-300">
                  {reportActionMsg}
                </div>
              )}

              <div className="space-y-3">
                {contactReports.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-[#294735] dark:text-[#D7E07A]">
                        {rep.category}
                      </span>
                      <span className="font-mono-tabular">
                        Status: <strong>{rep.status}</strong> ·{' '}
                        {new Date(rep.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-[#17201B] dark:text-[#F5F3EC]">
                      {rep.message}
                    </p>
                    <div className="text-[#17201B]/65 dark:text-[#C9C5B8]">
                      From: {rep.reporterName || 'Anonymous Visitor'}{' '}
                      {rep.reporterEmail ? `(${rep.reporterEmail})` : ''}
                    </div>
                    <div className="pt-2 flex flex-wrap items-center gap-2">
                      {(['Open', 'In Review', 'Resolved', 'Archived'] as const).map(
                        (st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={async () => {
                              setReportActionMsg('');
                              const res = await updateContactReportStatus(
                                rep.id,
                                st
                              );
                              if (!res.success) {
                                setReportActionMsg(
                                  res.error || 'Could not update report status.'
                                );
                              }
                            }}
                            className={`px-2.5 py-1 rounded border cursor-pointer ${
                              rep.status === st
                                ? 'bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] font-semibold'
                                : 'border-[#C9C5B8] dark:border-[#294735]'
                            }`}
                          >
                            Mark {st}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MODULE 6: QR CODE MANAGEMENT (Section 11 & 14) */}
          {activeModule === 'qrcodes' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  06. QR Code Management
                </h1>
                <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Only Published recipes receive public QR codes. Pending and Rejected submissions are excluded. QR codes automatically track the recipe&apos;s current public slug.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {publishedRecipes.map((rec) => {
                  const url = `${window.location.origin}/drinks/${rec.slug}`;
                  return (
                    <div
                      key={rec.id}
                      className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md flex items-center gap-4 text-xs"
                    >
                      <div className="p-2 bg-white rounded border border-[#C9C5B8]/40 shrink-0">
                        <QRCodeSVG
                          id={`qr-svg-${rec.slug}`}
                          value={url}
                          size={76}
                          bgColor="#FFFFFF"
                          fgColor="#17201B"
                        />
                      </div>
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate">
                          {rec.name}
                        </div>
                        <div className="font-mono-tabular text-[#17201B]/65 dark:text-[#C9C5B8] truncate">
                          /drinks/{rec.slug}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDownloadQrSvg(rec.slug)}
                          className="px-3 py-1.5 text-xs font-semibold bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download QR SVG</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* MODULE 7: REVISION HISTORY (Section 14) */}
          {activeModule === 'revisions' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  07. Recipe &amp; Price Revision History
                </h1>
                <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Tracks all recipe edits, price snapshot verifications, and non-destructive version restorations.
                </p>
              </div>

              {revisionActionMsg && (
                <div className="p-3 bg-[#294735]/20 border border-[#294735] dark:border-[#D7E07A] rounded text-xs">
                  {revisionActionMsg}
                </div>
              )}

              <div className="space-y-3">
                {recipeRevisions.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-4 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono-tabular font-bold text-[#294735] dark:text-[#D7E07A]">
                          v{rev.versionNumber}
                        </span>{' '}
                        · <span className="font-semibold">{rev.recipeName}</span> ·{' '}
                        <span>Changed: {rev.changedFields.join(', ')}</span>
                      </div>
                      <span className="font-mono-tabular text-[#17201B]/65 dark:text-[#C9C5B8]">
                        {new Date(rev.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[#17201B]/80 dark:text-[#C9C5B8]">
                      {rev.changeSummary}
                    </p>
                    <div className="pt-1 flex items-center justify-between">
                      <span className="text-[#17201B]/60 dark:text-[#C9C5B8]">
                        Author: {rev.createdBy}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          setRevisionActionMsg('');
                          const res = await restoreRecipeRevision(rev.id);
                          if (!res.success) {
                            setRevisionActionMsg(
                              res.error || 'Could not restore revision.'
                            );
                          } else {
                            setRevisionActionMsg(
                              `Restored "${rev.recipeName}" to v${rev.versionNumber} as a new revision.`
                            );
                          }
                        }}
                        className="px-3 py-1 text-xs font-medium border border-[#294735] dark:border-[#D7E07A] rounded flex items-center gap-1 cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>Restore This Version (Creates New Revision)</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MODULE 8: BACKUP AND DATA EXPORT (Section 20) */}
          {activeModule === 'backups' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  08. Manual Backup &amp; Complete Data Restoration
                </h1>
                <p className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
                  Generates a structured relational JSON package preserving IDs, timestamps, recipes, product catalog, price snapshots, revisions, likes, and the uploaded image storage asset manifest.
                </p>
              </div>

              {backupFeedback && (
                <div className="p-4 bg-[#294735]/20 border border-[#294735] dark:border-[#D7E07A] rounded text-xs">
                  {backupFeedback}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider">
                    Export Structured System Backup
                  </h2>
                  <p className="text-xs text-[#17201B]/75 dark:text-[#C9C5B8] leading-relaxed">
                    Includes all database entities plus the storage image asset manifest (published drink photos, verified product photos, and pending submission uploads) so no visual assets are excluded.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleDownloadBackup()}
                    className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Complete Backup (.JSON)</span>
                  </button>
                </div>

                <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider">
                    Validate &amp; Restore from Backup File
                  </h2>
                  <p className="text-xs text-[#17201B]/75 dark:text-[#C9C5B8] leading-relaxed">
                    Select a <code>711acks-v1.0</code> backup file. Schema integrity and image manifest completeness are verified before destructive restoration.
                  </p>
                  <input
                    type="file"
                    accept="application/json"
                    onChange={handleBackupFileSelect}
                    className="text-xs"
                  />

                  {pendingRestoreJson !== null && (
                    <div className="p-3 bg-amber-950/20 border border-amber-500/60 rounded space-y-2 text-xs">
                      <div className="font-semibold text-amber-700 dark:text-amber-300">
                        Confirm Destructive Restoration?
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await restoreFromBackupPackage(
                              pendingRestoreJson
                            );
                            if (!res.success) {
                              setBackupFeedback(
                                res.error || 'Backup validation failed.'
                              );
                            } else {
                              setBackupFeedback(
                                'System state successfully restored from validated backup.'
                              );
                            }
                            setPendingRestoreJson(null);
                          }}
                          className="px-3 py-1.5 bg-amber-500 text-[#17201B] font-semibold rounded cursor-pointer"
                        >
                          Confirm &amp; Overwrite Current State
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingRestoreJson(null)}
                          className="px-3 py-1.5 border border-[#C9C5B8] rounded cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* MODULE 9: MAINTENANCE MODE (Section 19) */}
          {activeModule === 'maintenance' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  09. Administrator-Controlled Maintenance Mode
                </h1>
              </div>

              {maintenanceActionMsg && (
                <div className="p-3 bg-[#294735]/20 border border-[#294735] dark:border-[#D7E07A] rounded text-xs">
                  {maintenanceActionMsg}
                </div>
              )}

              <div className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-5 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      Public Website Maintenance Gate
                    </div>
                    <div className="text-[#17201B]/70 dark:text-[#C9C5B8]">
                      When enabled, visitors on all public routes see the branded maintenance screen while your admin console remains accessible.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setMaintenanceActionMsg('');
                      const res = await updateWebsiteSettings({
                        maintenanceMode: !websiteSettings.maintenanceMode,
                      });
                      if (!res.success) {
                        setMaintenanceActionMsg(
                          res.error || 'Could not update maintenance mode.'
                        );
                      } else {
                        setMaintenanceActionMsg(
                          !websiteSettings.maintenanceMode
                            ? 'Maintenance mode enabled.'
                            : 'Maintenance mode disabled.'
                        );
                      }
                    }}
                    className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded cursor-pointer ${
                      websiteSettings.maintenanceMode
                        ? 'bg-amber-500 text-[#17201B]'
                        : 'bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B]'
                    }`}
                  >
                    {websiteSettings.maintenanceMode
                      ? 'Disable Maintenance Mode'
                      : 'Enable Maintenance Mode'}
                  </button>
                </div>

                <div className="space-y-2 pt-3 border-t border-[#C9C5B8]/30 dark:border-[#294735]">
                  <label className="block font-semibold">
                    Custom Maintenance Headline
                  </label>
                  <input
                    type="text"
                    value={maintTitleDraft}
                    onChange={(e) => setMaintTitleDraft(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-semibold">
                    Custom Maintenance Message
                  </label>
                  <textarea
                    rows={3}
                    value={maintMsgDraft}
                    onChange={(e) => setMaintMsgDraft(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      setMaintenanceActionMsg('');
                      const res = await updateWebsiteSettings({
                        maintenanceTitle: maintTitleDraft,
                        maintenanceMessage: maintMsgDraft,
                      });
                      if (!res.success) {
                        setMaintenanceActionMsg(
                          res.error || 'Could not save maintenance message.'
                        );
                      } else {
                        setMaintenanceActionMsg('Maintenance screen copy saved.');
                      }
                    }}
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
                  >
                    Save Maintenance Copy
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MODULE 10: ADMIN SETTINGS & SECURITY AUDIT LOG */}
          {activeModule === 'settings' && (
            <div className="space-y-6">
              <div className="border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-4">
                <h1 className="font-display text-2xl font-light uppercase tracking-wider">
                  10. Admin Settings &amp; Security Event Log
                </h1>
              </div>

              <div className="p-5 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-3 text-xs">
                <div className="flex items-center gap-2 font-semibold text-[#294735] dark:text-[#D7E07A]">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Active Security Policies</span>
                </div>
                <ul className="space-y-1.5 text-[#17201B]/80 dark:text-[#C9C5B8]">
                  <li>• Inactivity Timeout: 30 Minutes (auto-expires session &amp; requires 2FA OTP re-verification)</li>
                  <li>• Second Factor: Six-Digit SHA-256 Hashed One-Time Email Code required after password verification</li>
                  <li>• Public Admin Registration: Disabled permanently (single owner architecture)</li>
                  <li>• Price History Log Entries: {priceHistory.length} recorded catalog price changes</li>
                  <li>• Product Suggestions Pending Review: {productSuggestions.length}</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Recent Security Audit Events
                </h2>
                {securityEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-3 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/50 dark:border-[#294735] rounded flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-mono-tabular font-semibold text-[#294735] dark:text-[#D7E07A]">
                        {evt.eventType}
                      </span>{' '}
                      · <span>{evt.details}</span>
                    </div>
                    <span className="font-mono-tabular text-[#17201B]/60 dark:text-[#C9C5B8]">
                      {new Date(evt.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
