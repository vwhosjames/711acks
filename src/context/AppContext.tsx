import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BackupPackage,
  BackupRecordMetadata,
  CommunitySubmission,
  ContactReport,
  DrinkCategory,
  DrinkRecipe,
  ProductCatalogItem,
  ProductPriceHistoryEntry,
  ProductSuggestion,
  RecipeIngredient,
  RecipePriceSnapshot,
  RecipeRevision,
  ReportCategory,
  SecurityEvent,
  WebsiteSettings,
} from '../types/domain';
import {
  INITIAL_COMMUNITY_SUBMISSIONS,
  INITIAL_CONTACT_REPORTS,
  INITIAL_PRICE_HISTORY,
  INITIAL_PRODUCT_CATALOG,
  INITIAL_PRODUCT_SUGGESTIONS,
  INITIAL_RECIPES,
  INITIAL_REVISIONS,
  INITIAL_SECURITY_EVENTS,
  INITIAL_WEBSITE_SETTINGS,
} from '../data/seedData';
import {
  applyProductCatalogPriceUpdate,
  calculateFullPurchaseCost,
  resolveUniqueRecipeSlug,
  validateBackupPackage,
  validateBarcode,
} from '../utils/drinkLogic';
import {
  getAnonymousBrowserId,
  isSupabaseConfigured,
  supabase,
  validateAndOptimizeImageFile,
} from '../lib/supabaseClient';
import {
  SupabaseRepositoryError,
  fetchAdminBootstrapData,
  recordBackupMetadataAdmin,
  recordSecurityEventAdmin,
  rejectCommunitySubmissionAdmin,
  restoreRecipeRevisionAdmin,
  saveRecipePendingDraftAdmin,
  saveRecipeWithIngredientsAdmin,
  setProductArchivedAdmin,
  touchAdminActivityInDb,
  updateContactReportStatusAdmin,
  updateWebsiteSettingsAdmin,
  upsertProductAdmin,
  verifyRecipeCatalogPricesAdmin,
} from '../lib/supabaseRepository';
import {
  PendingUploadKind,
  UploadProgressPhase,
  createPendingSubmissionSignedUrl,
  uploadPendingSubmissionImage,
} from '../lib/supabaseStorage';
import { invokeApproveCommunitySubmissionEdgeFunction } from '../lib/communityApprovalController';
import {
  PendingPasswordRecovery,
  invokeAdminAuthCompleteRecovery,
  invokeAdminAuthInitiate,
  invokeAdminAuthLogout,
  invokeAdminAuthResend,
  invokeAdminAuthVerify,
  parsePasswordRecoveryUrl,
  performAdminActivityHeartbeat,
  validateNewAdminPassword,
} from '../lib/adminAuthController';
import {
  EMPTY_LIVE_SETTINGS,
  createInFlightGuard,
  executeSubmitCommunityHackByMode,
  executeSubmitContactReportByMode,
  executeToggleLikeByMode,
  extractErrorMessage,
  loadPublicDataByMode,
} from '../lib/appDataController';

export type ThemeMode = 'dark' | 'light';

interface AdminAuthChallenge {
  challengeId: string;
  challengeToken?: string; // Memory-only opaque token used in live Supabase mode; never persisted
  email: string;
  otpHash?: string; // Used ONLY in Local Preview Mode
  demoOtpDisplay?: string; // Used ONLY in Local Preview Mode when Supabase is not configured
  expiresAt: number;
  resendAvailableAt: number;
  attempts: number;
  maxAttempts: number;
}

export interface AdminSession {
  email: string;
  otpVerifiedAt: number;
  otpVerifiedUntil?: number;
  lastActiveAt: number;
  expiresAt: number;
}

interface AppContextValue {
  // Theme (browser-local preference)
  theme: ThemeMode;
  toggleTheme: () => void;
  // Data collections
  products: ProductCatalogItem[];
  priceHistory: ProductPriceHistoryEntry[];
  recipes: DrinkRecipe[];
  recipePriceSnapshots: RecipePriceSnapshot[];
  communitySubmissions: CommunitySubmission[];
  productSuggestions: ProductSuggestion[];
  recipeRevisions: RecipeRevision[];
  contactReports: ContactReport[];
  websiteSettings: WebsiteSettings;
  securityEvents: SecurityEvent[];
  backupRecords: BackupRecordMetadata[];
  isLiveSupabase: boolean;
  // Loading & Error states
  isLoadingData: boolean;
  dataError: string | null;
  isLoadingAdminData: boolean;
  adminDataError: string | null;
  refreshPublicData: () => Promise<void>;
  refreshAdminData: () => Promise<void>;
  // Favorites (Browser Local Storage per Section 9)
  favorites: string[];
  toggleFavorite: (recipeId: string) => void;
  isFavorite: (recipeId: string) => boolean;
  // Likes (Anonymous Browser ID + Phase 2A RPCs when live)
  likedRecipeIds: string[];
  toggleLike: (recipeId: string) => Promise<{ success: boolean; message?: string }>;
  hasLiked: (recipeId: string) => boolean;
  isLikePending: (recipeId: string) => boolean;
  // Storage (Private pending-submissions upload & admin signed URL)
  uploadPendingSubmissionPhoto: (
    file: File,
    kind: PendingUploadKind,
    onProgress?: (phase: UploadProgressPhase) => void
  ) => Promise<{
    success: boolean;
    previewUrl?: string;
    storagePath?: string;
    error?: string;
  }>;
  getPendingPhotoSignedUrl: (
    storagePath: string
  ) => Promise<{ success: boolean; signedUrl?: string; error?: string }>;
  // Community Submission (Section 12 — RPC when live)
  submitCommunityHack: (
    payload: Omit<CommunitySubmission, 'id' | 'status' | 'submittedAt'>
  ) => Promise<{ success: boolean; submissionId?: string; error?: string }>;
  // Contact Reports (Section 16 — RPC when live)
  submitContactReport: (payload: {
    reporterName?: string;
    reporterEmail?: string;
    category: ReportCategory;
    message: string;
    relatedRecipeSlug?: string;
  }) => Promise<{ success: boolean; reportId?: string; error?: string }>;
  // Admin Auth & 2FA OTP (Section 13 — Server-side Edge Functions when live; Local Preview when unconfigured)
  adminSession: AdminSession | null;
  pendingOtpChallenge: AdminAuthChallenge | null;
  pendingPasswordRecovery: PendingPasswordRecovery | null;
  lockoutUntil: number | null;
  sessionExpiredReason: string | null;
  clearSessionExpiredReason: () => void;
  initiateAdminLogin: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error?: string; requiresOtp?: boolean }>;
  verifyAdminOtp: (code: string) => Promise<{ success: boolean; error?: string }>;
  resendAdminOtp: () => Promise<{ success: boolean; error?: string }>;
  requestPasswordRecovery: (
    email: string
  ) => Promise<{ success: boolean; message: string }>;
  completePasswordRecovery: (
    newPassword: string
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  cancelPasswordRecovery: () => void;
  logoutAdmin: (reason?: string) => void;
  touchAdminActivity: () => void;
  // Admin Operations (Repository-wired when live, Local Preview when unconfigured)
  addOrUpdateProduct: (
    product: Omit<ProductCatalogItem, 'id' | 'lastUpdatedAt'> & { id?: string }
  ) => Promise<{
    success: boolean;
    error?: string;
    flaggedRecipesCount?: number;
    productId?: string;
  }>;
  toggleArchiveProduct: (
    productId: string
  ) => Promise<{ success: boolean; error?: string }>;
  saveRecipe: (
    recipeData: Omit<DrinkRecipe, 'id' | 'slug' | 'createdAt' | 'updatedAt' | 'likesCount'> & {
      id?: string;
      slug?: string;
    },
    asPendingDraftOnPublished?: boolean
  ) => Promise<{ success: boolean; error?: string; recipeId?: string }>;
  applyPendingDraftToPublished: (
    recipeId: string
  ) => Promise<{ success: boolean; error?: string }>;
  verifyRecipeCurrentCatalogPrices: (
    recipeId: string
  ) => Promise<{ success: boolean; error?: string }>;
  restoreRecipeRevision: (
    revisionId: string
  ) => Promise<{ success: boolean; error?: string }>;
  approveCommunitySubmission: (
    submissionId: string,
    overrides: {
      name: string;
      category: DrinkCategory;
      photoUrl: string;
      tasteNotes?: string;
      ingredients: RecipeIngredient[];
      adminNotes?: string;
    }
  ) => Promise<{ success: boolean; error?: string; recipeSlug?: string }>;
  rejectCommunitySubmission: (
    submissionId: string,
    reason: string
  ) => Promise<{ success: boolean; error?: string }>;
  updateContactReportStatus: (
    reportId: string,
    status: ContactReport['status'],
    adminNotes?: string
  ) => Promise<{ success: boolean; error?: string }>;
  updateWebsiteSettings: (
    partial: Partial<WebsiteSettings>
  ) => Promise<{ success: boolean; error?: string }>;
  generateBackupPackage: () => Promise<{
    success: boolean;
    backup?: BackupPackage;
    error?: string;
  }>;
  restoreFromBackupPackage: (
    payload: unknown
  ) => Promise<{ success: boolean; error?: string }>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const STORAGE_KEYS = {
  THEME: '711acks_theme_v1',
  FAVORITES: '711acks_favorites_v1',
  LIKES_MAP: '711acks_likes_map_v1',
  PRODUCTS: '711acks_products_v1',
  PRICE_HISTORY: '711acks_price_history_v1',
  PRICE_SNAPSHOTS: '711acks_price_snapshots_v1',
  RECIPES: '711acks_recipes_v1',
  SUBMISSIONS: '711acks_submissions_v1',
  SUGGESTIONS: '711acks_suggestions_v1',
  REVISIONS: '711acks_revisions_v1',
  REPORTS: '711acks_reports_v1',
  SETTINGS: '711acks_settings_v1',
  SECURITY: '711acks_security_v1',
  BACKUP_RECORDS: '711acks_backup_records_v1',
  ADMIN_SESSION: '711acks_admin_session_v1',
  ADMIN_LOCKOUT: '711acks_admin_lockout_v1',
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function sha256Hex(text: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    }
    return 'hash_' + Math.abs(h).toString(16);
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Concurrency guard to prevent duplicate submissions and double-click races
  const inFlightGuardRef = useRef(createInFlightGuard());
  const publicFetchSeqRef = useRef(0);
  const adminFetchSeqRef = useRef(0);
  const lastServerTouchRef = useRef(0);

  // Browser-local Theme state (Unified Day/Night Theme — defaults to Night Mode)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.THEME) as ThemeMode | null;
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // default dark (Night Mode)
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Application collections:
  // - Live Supabase mode starts clean (no demo seed data, no LocalStorage fallback)
  // - Local Preview mode (unconfigured) loads seeded preview data + LocalStorage
  const [products, setProducts] = useState<ProductCatalogItem[]>(() =>
    isSupabaseConfigured
      ? []
      : loadFromStorage(STORAGE_KEYS.PRODUCTS, INITIAL_PRODUCT_CATALOG)
  );
  const [priceHistory, setPriceHistory] = useState<ProductPriceHistoryEntry[]>(() =>
    isSupabaseConfigured
      ? []
      : loadFromStorage(STORAGE_KEYS.PRICE_HISTORY, INITIAL_PRICE_HISTORY)
  );
  const [recipes, setRecipes] = useState<DrinkRecipe[]>(() =>
    isSupabaseConfigured
      ? []
      : loadFromStorage(STORAGE_KEYS.RECIPES, INITIAL_RECIPES)
  );
  const [recipePriceSnapshots, setRecipePriceSnapshots] = useState<RecipePriceSnapshot[]>(
    () =>
      isSupabaseConfigured
        ? []
        : loadFromStorage(STORAGE_KEYS.PRICE_SNAPSHOTS, [])
  );
  const [communitySubmissions, setCommunitySubmissions] = useState<CommunitySubmission[]>(
    () =>
      isSupabaseConfigured
        ? []
        : loadFromStorage(STORAGE_KEYS.SUBMISSIONS, INITIAL_COMMUNITY_SUBMISSIONS)
  );
  const [productSuggestions, setProductSuggestions] = useState<ProductSuggestion[]>(() =>
    isSupabaseConfigured
      ? []
      : loadFromStorage(STORAGE_KEYS.SUGGESTIONS, INITIAL_PRODUCT_SUGGESTIONS)
  );
  const [recipeRevisions, setRecipeRevisions] = useState<RecipeRevision[]>(() =>
    isSupabaseConfigured
      ? []
      : loadFromStorage(STORAGE_KEYS.REVISIONS, INITIAL_REVISIONS)
  );
  const [contactReports, setContactReports] = useState<ContactReport[]>(() =>
    isSupabaseConfigured
      ? []
      : loadFromStorage(STORAGE_KEYS.REPORTS, INITIAL_CONTACT_REPORTS)
  );
  const [websiteSettings, setWebsiteSettings] = useState<WebsiteSettings>(() =>
    isSupabaseConfigured
      ? EMPTY_LIVE_SETTINGS
      : loadFromStorage(STORAGE_KEYS.SETTINGS, INITIAL_WEBSITE_SETTINGS)
  );
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>(() =>
    isSupabaseConfigured
      ? []
      : loadFromStorage(STORAGE_KEYS.SECURITY, INITIAL_SECURITY_EVENTS)
  );
  const [backupRecords, setBackupRecords] = useState<BackupRecordMetadata[]>(() =>
    isSupabaseConfigured
      ? []
      : loadFromStorage(STORAGE_KEYS.BACKUP_RECORDS, [])
  );

  // Loading & error states for live Supabase reads
  const [isLoadingData, setIsLoadingData] = useState<boolean>(isSupabaseConfigured);
  const [dataError, setDataError] = useState<string | null>(null);
  const [isLoadingAdminData, setIsLoadingAdminData] = useState<boolean>(false);
  const [adminDataError, setAdminDataError] = useState<string | null>(null);

  // Favorites (explicitly browser-local per Section 9)
  const [favorites, setFavorites] = useState<string[]>(() =>
    loadFromStorage(STORAGE_KEYS.FAVORITES, [])
  );

  // Likes state:
  // - Live mode: serverLikedRecipeIds fetched via `get_liked_recipe_ids` RPC
  // - Local preview mode: likesMap stored in LocalStorage
  const anonBrowserId = useMemo(() => getAnonymousBrowserId(), []);
  const [serverLikedRecipeIds, setServerLikedRecipeIds] = useState<string[]>([]);
  const [pendingLikeRecipeIds, setPendingLikeRecipeIds] = useState<string[]>([]);
  const [likesMap, setLikesMap] = useState<Record<string, string[]>>(() =>
    isSupabaseConfigured ? {} : loadFromStorage(STORAGE_KEYS.LIKES_MAP, {})
  );
  const [lastLikeTimestamp, setLastLikeTimestamp] = useState<number>(0);

  // Admin Auth state:
  // - Live mode NEVER loads an unverified local admin session from LocalStorage!
  const [adminSession, setAdminSession] = useState<AdminSession | null>(() => {
    if (isSupabaseConfigured) return null;
    const saved = loadFromStorage<AdminSession | null>(STORAGE_KEYS.ADMIN_SESSION, null);
    if (saved && saved.expiresAt > Date.now()) {
      return saved;
    }
    return null;
  });
  const [pendingOtpChallenge, setPendingOtpChallenge] =
    useState<AdminAuthChallenge | null>(null);
  const [failedLoginCount, setFailedLoginCount] = useState<number>(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
    if (isSupabaseConfigured) return null;
    const saved = loadFromStorage<number | null>(STORAGE_KEYS.ADMIN_LOCKOUT, null);
    return saved && saved > Date.now() ? saved : null;
  });
  const [sessionExpiredReason, setSessionExpiredReason] = useState<string | null>(null);
  const [pendingPasswordRecovery, setPendingPasswordRecovery] =
    useState<PendingPasswordRecovery | null>(() => {
      if (!isSupabaseConfigured || typeof window === 'undefined') return null;
      return parsePasswordRecoveryUrl(window.location);
    });
  const isTouchingServerRef = useRef<boolean>(false);

  // M-04: Immediately scrub recovery tokens from URL history while keeping them strictly in memory
  useEffect(() => {
    if (!isSupabaseConfigured || !pendingPasswordRecovery || typeof window === 'undefined') {
      return;
    }
    if (window.location.search || window.location.hash) {
      window.history.replaceState({}, '', '/admin/login');
    }
  }, [pendingPasswordRecovery]);

  const clearSessionExpiredReason = useCallback(() => {
    setSessionExpiredReason(null);
  }, []);

  const clearLiveAdminWorkspaceState = useCallback(() => {
    if (!isSupabaseConfigured) return;
    setPriceHistory([]);
    setRecipePriceSnapshots([]);
    setCommunitySubmissions([]);
    setProductSuggestions([]);
    setRecipeRevisions([]);
    setContactReports([]);
    setSecurityEvents([]);
    setBackupRecords([]);
    setAdminDataError(null);
  }, []);

  // Always persist browser-local Favorites (Section 9)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
    } catch {
      // ignore storage quota error
    }
  }, [favorites]);

  // Persist application collections to LocalStorage ONLY in Local Preview Mode
  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
      localStorage.setItem(STORAGE_KEYS.PRICE_HISTORY, JSON.stringify(priceHistory));
      localStorage.setItem(STORAGE_KEYS.PRICE_SNAPSHOTS, JSON.stringify(recipePriceSnapshots));
      localStorage.setItem(STORAGE_KEYS.RECIPES, JSON.stringify(recipes));
      localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(communitySubmissions));
      localStorage.setItem(STORAGE_KEYS.SUGGESTIONS, JSON.stringify(productSuggestions));
      localStorage.setItem(STORAGE_KEYS.REVISIONS, JSON.stringify(recipeRevisions));
      localStorage.setItem(STORAGE_KEYS.REPORTS, JSON.stringify(contactReports));
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(websiteSettings));
      localStorage.setItem(STORAGE_KEYS.SECURITY, JSON.stringify(securityEvents));
      localStorage.setItem(STORAGE_KEYS.BACKUP_RECORDS, JSON.stringify(backupRecords));
      localStorage.setItem(STORAGE_KEYS.LIKES_MAP, JSON.stringify(likesMap));
    } catch {
      // ignore storage quota error
    }
  }, [
    products,
    priceHistory,
    recipePriceSnapshots,
    recipes,
    communitySubmissions,
    productSuggestions,
    recipeRevisions,
    contactReports,
    websiteSettings,
    securityEvents,
    backupRecords,
    likesMap,
  ]);

  // Live Supabase Public Bootstrap Read (with sequence guard against race conditions)
  const refreshPublicData = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const seq = ++publicFetchSeqRef.current;
    setIsLoadingData(true);
    setDataError(null);

    const result = await loadPublicDataByMode({
      isLiveSupabase: isSupabaseConfigured,
      client: supabase,
      anonymousBrowserId: anonBrowserId,
      getLocalPreviewData: () => ({
        recipes: [],
        products: [],
        websiteSettings: EMPTY_LIVE_SETTINGS,
        likedRecipeIds: [],
      }),
    });

    if (seq !== publicFetchSeqRef.current) return;

    if (!result.success) {
      setDataError(result.error);
      setIsLoadingData(false);
      return;
    }

    setRecipes(result.data.recipes);
    setProducts(result.data.products);
    setWebsiteSettings(result.data.websiteSettings);
    setServerLikedRecipeIds(result.data.likedRecipeIds);
    setIsLoadingData(false);
  }, [anonBrowserId]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void refreshPublicData();
  }, [refreshPublicData]);

  // Live Supabase Protected Admin Bootstrap Read (enforced by RLS + is_verified_admin())
  const refreshAdminData = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const seq = ++adminFetchSeqRef.current;
    setIsLoadingAdminData(true);
    setAdminDataError(null);

    try {
      const data = await fetchAdminBootstrapData(supabase);
      if (seq !== adminFetchSeqRef.current) return;
      setRecipes(data.recipes);
      setProducts(data.products);
      setPriceHistory(data.priceHistory);
      setRecipePriceSnapshots(data.recipePriceSnapshots);
      setCommunitySubmissions(data.communitySubmissions);
      setProductSuggestions(data.productSuggestions);
      setRecipeRevisions(data.recipeRevisions);
      setContactReports(data.contactReports);
      setWebsiteSettings(data.websiteSettings);
      setSecurityEvents(data.securityEvents);
      setBackupRecords(data.backupRecords);
    } catch (err) {
      if (seq !== adminFetchSeqRef.current) return;
      setAdminDataError(
        extractErrorMessage(
          err,
          'Protected admin data could not be loaded from Supabase.'
        )
      );
    } finally {
      if (seq === adminFetchSeqRef.current) {
        setIsLoadingAdminData(false);
      }
    }
  }, []);

  const appendSecurityEvent = useCallback(
    (eventType: SecurityEvent['eventType'], actor: string, details: string) => {
      if (isSupabaseConfigured) {
        // In live mode, attempt authenticated security event logging without faking local state
        recordSecurityEventAdmin(supabase, { eventType, actor, details }).catch(() => {
          // Intentionally suppressed when caller is not an OTP-verified admin (RLS blocks unverified writes)
        });
        return;
      }

      const evt: SecurityEvent = {
        id: 'sec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        eventType,
        actor,
        details,
        createdAt: new Date().toISOString(),
      };
      setSecurityEvents((prev) => [evt, ...prev.slice(0, 99)]);
    },
    []
  );

  // Monitor live Supabase Auth session state so server-revoked / signed-out tokens clear admin UI immediately
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAdminSession(null);
        setPendingOtpChallenge(null);
        clearLiveAdminWorkspaceState();
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [clearLiveAdminWorkspaceState]);

  const expireAdminSession = useCallback(
    (actorEmail: string, noticeMessage: string, auditReason: string) => {
      setAdminSession(null);
      setPendingOtpChallenge(null);
      setSessionExpiredReason(noticeMessage);
      if (!isSupabaseConfigured) {
        localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
        appendSecurityEvent('ADMIN_SESSION_TIMEOUT', actorEmail, auditReason);
        return;
      }
      clearLiveAdminWorkspaceState();
      if (supabase) {
        invokeAdminAuthLogout(supabase, {
          eventType: 'ADMIN_SESSION_TIMEOUT',
          reason: auditReason,
        })
          .catch(() => {})
          .finally(() => {
            void supabase?.auth.signOut().catch(() => {});
          });
      }
    },
    [appendSecurityEvent, clearLiveAdminWorkspaceState]
  );

  // 30-Minute Inactivity & Absolute OTP Expiration Monitor (Section 13)
  useEffect(() => {
    if (!adminSession) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      const otpExpired =
        typeof adminSession.otpVerifiedUntil === 'number' &&
        now >= adminSession.otpVerifiedUntil;
      if (now >= adminSession.expiresAt || otpExpired) {
        expireAdminSession(
          adminSession.email,
          otpExpired
            ? 'Your OTP verification window has expired. Please sign in and verify a new 6-digit code.'
            : 'Your administrator session expired due to inactivity. Please sign in and complete Email OTP verification again.',
          otpExpired
            ? 'Admin OTP verification window expired. Re-authentication and OTP required.'
            : 'Admin session expired after inactivity. Re-authentication and OTP required.'
        );
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [adminSession, expireAdminSession]);

  const touchAdminActivity = useCallback(() => {
    if (isSupabaseConfigured) {
      if (!adminSession) return;
      const now = Date.now();
      const otpExpired =
        typeof adminSession.otpVerifiedUntil === 'number' &&
        now >= adminSession.otpVerifiedUntil;
      if (now >= adminSession.expiresAt || otpExpired) {
        expireAdminSession(
          adminSession.email,
          'Your administrator session expired. Please sign in and complete Email OTP verification again.',
          'Admin session expired prior to activity update.'
        );
        return;
      }

      // H-01: Do NOT optimistically extend adminSession.expiresAt before the server confirms.
      // Throttle server-side activity heartbeat to at most once every 30 seconds.
      if (isTouchingServerRef.current || now - lastServerTouchRef.current < 30_000) {
        return;
      }

      isTouchingServerRef.current = true;
      lastServerTouchRef.current = now;
      const targetEmail = adminSession.email;
      const otpVerifiedUntilMs = adminSession.otpVerifiedUntil;
      const timeoutMinutes = websiteSettings.sessionTimeoutMinutes || 30;

      void performAdminActivityHeartbeat({
        touchServer: () => touchAdminActivityInDb(supabase),
        otpVerifiedUntilMs,
        sessionTimeoutMinutes: timeoutMinutes,
        onConfirmed: (serverNowMs, confirmedExpiresAtMs) => {
          setAdminSession((prev) =>
            prev && prev.email === targetEmail
              ? {
                  ...prev,
                  lastActiveAt: serverNowMs,
                  expiresAt: confirmedExpiresAtMs,
                }
              : prev
          );
        },
        onExpired: (noticeMessage, auditReason) => {
          expireAdminSession(targetEmail, noticeMessage, auditReason);
        },
      })
        .then((result) => {
          if (result.status === 'transient_error') {
            // Allow retry on next interaction without extending the local expiry window
            lastServerTouchRef.current = 0;
          }
        })
        .finally(() => {
          isTouchingServerRef.current = false;
        });
      return;
    }

    setAdminSession((prev) => {
      if (!prev) return null;
      const now = Date.now();
      if (now >= prev.expiresAt) {
        localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
        return null;
      }
      const timeoutMs = (websiteSettings.sessionTimeoutMinutes || 30) * 60 * 1000;
      const updated: AdminSession = {
        ...prev,
        lastActiveAt: now,
        expiresAt: now + timeoutMs,
      };
      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, JSON.stringify(updated));
      return updated;
    });
  }, [adminSession, expireAdminSession, websiteSettings.sessionTimeoutMinutes]);

  // Favorites handlers (Browser Local Storage)
  const toggleFavorite = useCallback((recipeId: string) => {
    setFavorites((prev) =>
      prev.includes(recipeId) ? prev.filter((id) => id !== recipeId) : [...prev, recipeId]
    );
  }, []);

  const isFavorite = useCallback(
    (recipeId: string) => favorites.includes(recipeId),
    [favorites]
  );

  // Likes handlers (Phase 2A RPCs when live; Local Preview fallback when unconfigured)
  const hasLiked = useCallback(
    (recipeId: string) => {
      if (isSupabaseConfigured) {
        return serverLikedRecipeIds.includes(recipeId);
      }
      const voters = likesMap[recipeId] || [];
      return voters.includes(anonBrowserId);
    },
    [anonBrowserId, likesMap, serverLikedRecipeIds]
  );

  const isLikePending = useCallback(
    (recipeId: string) => pendingLikeRecipeIds.includes(recipeId),
    [pendingLikeRecipeIds]
  );

  const likedRecipeIds = useMemo(
    () =>
      isSupabaseConfigured
        ? serverLikedRecipeIds
        : recipes.filter((r) => (likesMap[r.id] || []).includes(anonBrowserId)).map((r) => r.id),
    [anonBrowserId, likesMap, recipes, serverLikedRecipeIds]
  );

  const toggleLike = useCallback(
    async (recipeId: string): Promise<{ success: boolean; message?: string }> => {
      setPendingLikeRecipeIds((prev) =>
        prev.includes(recipeId) ? prev : [...prev, recipeId]
      );

      try {
        const res = await executeToggleLikeByMode({
          isLiveSupabase: isSupabaseConfigured,
          client: supabase,
          guard: inFlightGuardRef.current,
          recipeId,
          anonymousBrowserId: anonBrowserId,
          localToggle: () => {
            const now = Date.now();
            if (now - lastLikeTimestamp < 600) {
              return {
                success: false,
                message: 'Please wait a moment before toggling likes again.',
              };
            }
            setLastLikeTimestamp(now);

            const currentVoters = likesMap[recipeId] || [];
            const alreadyLiked = currentVoters.includes(anonBrowserId);
            const nextVoters = alreadyLiked
              ? currentVoters.filter((id) => id !== anonBrowserId)
              : [...currentVoters, anonBrowserId];

            setLikesMap((prev) => ({
              ...prev,
              [recipeId]: nextVoters,
            }));

            let nextCount = 0;
            setRecipes((prev) =>
              prev.map((r) => {
                if (r.id !== recipeId) return r;
                const delta = alreadyLiked ? -1 : 1;
                nextCount = Math.max(0, r.likesCount + delta);
                return { ...r, likesCount: nextCount };
              })
            );

            return {
              success: true,
              liked: !alreadyLiked,
              likesCount: nextCount,
            };
          },
        });

        if (isSupabaseConfigured && res.success) {
          if (typeof res.liked === 'boolean') {
            setServerLikedRecipeIds((prev) =>
              res.liked
                ? prev.includes(recipeId)
                  ? prev
                  : [...prev, recipeId]
                : prev.filter((id) => id !== recipeId)
            );
          }
          if (typeof res.likesCount === 'number') {
            setRecipes((prev) =>
              prev.map((r) =>
                r.id === recipeId ? { ...r, likesCount: res.likesCount! } : r
              )
            );
          }
        }

        return { success: res.success, message: res.message };
      } finally {
        setPendingLikeRecipeIds((prev) => prev.filter((id) => id !== recipeId));
      }
    },
    [anonBrowserId, lastLikeTimestamp, likesMap]
  );

  // Private Storage upload for pending community submission photos (Section 5 & Section 23)
  const uploadPendingSubmissionPhoto = useCallback(
    async (
      file: File,
      kind: PendingUploadKind,
      onProgress?: (phase: UploadProgressPhase) => void
    ): Promise<{
      success: boolean;
      previewUrl?: string;
      storagePath?: string;
      error?: string;
    }> => {
      onProgress?.('validating');
      const validated = await validateAndOptimizeImageFile(file);
      if (!validated.valid || !validated.dataUrl) {
        onProgress?.('error');
        return {
          success: false,
          error: validated.error || 'Selected image failed validation.',
        };
      }

      if (!isSupabaseConfigured) {
        onProgress?.('uploaded');
        return {
          success: true,
          previewUrl: validated.dataUrl,
          storagePath: undefined,
        };
      }

      if (!validated.blob || !validated.mimeType || !validated.sizeBytes) {
        onProgress?.('error');
        return {
          success: false,
          error: 'Could not prepare optimized image binary for private storage upload.',
        };
      }

      try {
        const uploaded = await uploadPendingSubmissionImage(supabase, {
          blob: validated.blob,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          width: validated.width,
          height: validated.height,
          kind,
          onProgress,
        });
        return {
          success: true,
          previewUrl: validated.dataUrl,
          storagePath: uploaded.storagePath,
        };
      } catch (err) {
        onProgress?.('error');
        return {
          success: false,
          error: extractErrorMessage(
            err,
            'Could not upload image to private pending-submissions storage.'
          ),
        };
      }
    },
    []
  );

  const getPendingPhotoSignedUrl = useCallback(
    async (
      storagePath: string
    ): Promise<{ success: boolean; signedUrl?: string; error?: string }> => {
      if (!isSupabaseConfigured) {
        return { success: true, signedUrl: storagePath };
      }

      try {
        const signedUrl = await createPendingSubmissionSignedUrl(supabase, storagePath, 300);
        return { success: true, signedUrl };
      } catch (err) {
        return {
          success: false,
          error: extractErrorMessage(
            err,
            'Unable to generate authorized signed URL for private submission photo.'
          ),
        };
      }
    },
    []
  );

  // Community Submission Handler (Section 12 — Transactional RPC when live, Pending only)
  const submitCommunityHack = useCallback(
    async (
      payload: Omit<CommunitySubmission, 'id' | 'status' | 'submittedAt'>
    ): Promise<{ success: boolean; submissionId?: string; error?: string }> => {
      const cleanSubmitter =
        payload.submitterName && payload.submitterName.trim().length > 0
          ? payload.submitterName.trim()
          : 'Anonymous Creator';

      return executeSubmitCommunityHackByMode({
        isLiveSupabase: isSupabaseConfigured,
        client: supabase,
        guard: inFlightGuardRef.current,
        input: {
          drinkName: payload.drinkName.trim(),
          category: payload.category,
          submitterName: cleanSubmitter,
          tasteNotes: payload.tasteNotes?.trim() || undefined,
          finishedPhotoStoragePath: payload.finishedPhotoUrl || undefined,
          duplicateWarningNotes: payload.duplicateWarningNotes || undefined,
          ingredients: payload.ingredients.map((ing) => ({
            productId: ing.productId,
            suggestedProductName: ing.suggestedProductName?.trim() || undefined,
            suggestedProductPrice:
              typeof ing.suggestedProductPrice === 'number'
                ? ing.suggestedProductPrice
                : null,
            suggestedProductPhotoPath: ing.suggestedProductPhotoUrl || undefined,
            quantityUsed: ing.quantityUsed.trim(),
            unitsToPurchase: Math.max(1, Math.floor(Number(ing.unitsToPurchase) || 1)),
          })),
        },
        localSubmit: () => {
          const submissionId = 'sub-' + Date.now();
          const newSubmission: CommunitySubmission = {
            ...payload,
            id: submissionId,
            submitterName: cleanSubmitter,
            status: 'Pending',
            submittedAt: new Date().toISOString(),
          };

          setCommunitySubmissions((prev) => [newSubmission, ...prev]);

          const newSuggestions: ProductSuggestion[] = payload.ingredients
            .filter((ing) => !ing.productId && ing.suggestedProductName)
            .map((ing, idx) => ({
              id: `psug-${Date.now()}-${idx}`,
              submissionId,
              suggestedName: ing.suggestedProductName!,
              suggestedPrice:
                typeof ing.suggestedProductPrice === 'number'
                  ? ing.suggestedProductPrice
                  : null,
              photoUrl: ing.suggestedProductPhotoUrl,
              status: 'Pending',
              createdAt: new Date().toISOString(),
            }));

          if (newSuggestions.length > 0) {
            setProductSuggestions((prev) => [...newSuggestions, ...prev]);
          }

          return { success: true, submissionId };
        },
      });
    },
    []
  );

  // Contact Report Submission Handler (Section 16 — RPC when live)
  const [lastReportTimestamp, setLastReportTimestamp] = useState<number>(0);

  const submitContactReport = useCallback(
    async (payload: {
      reporterName?: string;
      reporterEmail?: string;
      category: ReportCategory;
      message: string;
      relatedRecipeSlug?: string;
    }): Promise<{ success: boolean; reportId?: string; error?: string }> => {
      return executeSubmitContactReportByMode({
        isLiveSupabase: isSupabaseConfigured,
        client: supabase,
        guard: inFlightGuardRef.current,
        input: payload,
        localSubmit: () => {
          const now = Date.now();
          if (now - lastReportTimestamp < 5000) {
            return {
              success: false,
              error:
                'Rate limit active: Please wait a few seconds before sending another report.',
            };
          }
          setLastReportTimestamp(now);
          const reportId = 'rep-' + now;
          const newReport: ContactReport = {
            id: reportId,
            reporterName: payload.reporterName?.trim() || undefined,
            reporterEmail: payload.reporterEmail?.trim() || undefined,
            category: payload.category,
            message: payload.message.trim(),
            relatedRecipeSlug: payload.relatedRecipeSlug?.trim() || undefined,
            status: 'Open',
            createdAt: new Date().toISOString(),
          };

          setContactReports((prev) => [newReport, ...prev]);
          return { success: true, reportId };
        },
      });
    },
    [lastReportTimestamp]
  );

  // Admin Authentication (Section 13 — Genuine server-side Email OTP in live mode; Local Preview when unconfigured)
  const initiateAdminLogin = useCallback(
    async (
      email: string,
      password: string
    ): Promise<{ success: boolean; error?: string; requiresOtp?: boolean }> => {
      const cleanEmail = email.trim().toLowerCase();
      setSessionExpiredReason(null);

      if (isSupabaseConfigured && supabase) {
        // CRITICAL SECURITY RULE (Phase 3):
        // Never call supabase.auth.signInWithPassword() from the browser.
        // Password verification + OTP issuance happen strictly server-side in `admin-auth-initiate`
        // without releasing any authenticated session prior to OTP verification.
        try {
          setAdminSession(null);
          const liveChallenge = await invokeAdminAuthInitiate(
            supabase,
            cleanEmail,
            password
          );
          setPendingOtpChallenge({
            challengeId: liveChallenge.challengeId,
            challengeToken: liveChallenge.challengeToken,
            email: liveChallenge.email,
            expiresAt: Date.parse(liveChallenge.expiresAt),
            resendAvailableAt: Date.parse(liveChallenge.resendAvailableAt),
            attempts: 0,
            maxAttempts: liveChallenge.maxAttempts,
          });
          return { success: true, requiresOtp: true };
        } catch (err) {
          setPendingOtpChallenge(null);
          return {
            success: false,
            error: extractErrorMessage(err, 'Invalid administrator credentials.'),
          };
        }
      }

      // Local Preview Mode only (when Supabase is NOT configured)
      const now = Date.now();
      if (lockoutUntil && lockoutUntil > now) {
        const remainingSec = Math.ceil((lockoutUntil - now) / 1000);
        return {
          success: false,
          error: `Account temporarily locked due to repeated failed attempts. Try again in ${remainingSec}s.`,
        };
      }

      const credentialsValid =
        cleanEmail === 'admin@711acks.ph' && password === 'Midnight711!Hacks';

      if (!credentialsValid) {
        const nextFailures = failedLoginCount + 1;
        setFailedLoginCount(nextFailures);
        appendSecurityEvent(
          'ADMIN_LOGIN_FAILED',
          cleanEmail || 'unknown',
          `Invalid credential attempt (${nextFailures}/5).`
        );

        if (nextFailures >= 5) {
          const lockExpires = now + 2 * 60 * 1000;
          setLockoutUntil(lockExpires);
          localStorage.setItem(STORAGE_KEYS.ADMIN_LOCKOUT, JSON.stringify(lockExpires));
          appendSecurityEvent(
            'ADMIN_LOCKOUT_TRIGGERED',
            cleanEmail || 'unknown',
            'Temporary 2-minute login lockout triggered after 5 consecutive failures.'
          );
          return {
            success: false,
            error: 'Too many failed attempts. Login is temporarily locked for 2 minutes.',
          };
        }

        return {
          success: false,
          error: 'Invalid administrator credentials.',
        };
      }

      setFailedLoginCount(0);
      setLockoutUntil(null);
      localStorage.removeItem(STORAGE_KEYS.ADMIN_LOCKOUT);

      const randomSixDigits = Math.floor(100000 + Math.random() * 900000).toString();
      const challengeId = 'chl_' + now;
      const otpHash = await sha256Hex(`${challengeId}:${randomSixDigits}`);

      const challenge: AdminAuthChallenge = {
        challengeId,
        email: cleanEmail,
        otpHash,
        demoOtpDisplay: randomSixDigits,
        expiresAt: now + 5 * 60 * 1000,
        resendAvailableAt: now + 30 * 1000,
        attempts: 0,
        maxAttempts: 5,
      };

      setPendingOtpChallenge(challenge);
      appendSecurityEvent(
        'ADMIN_PASSWORD_VERIFIED',
        cleanEmail,
        'Primary password verified (Local Preview Mode). Awaiting preview OTP confirmation.'
      );
      appendSecurityEvent(
        'ADMIN_OTP_ISSUED',
        cleanEmail,
        `Preview challenge ${challengeId} generated (expires in 5 minutes).`
      );

      return { success: true, requiresOtp: true };
    },
    [appendSecurityEvent, failedLoginCount, lockoutUntil]
  );

  const verifyAdminOtp = useCallback(
    async (code: string): Promise<{ success: boolean; error?: string }> => {
      if (!pendingOtpChallenge) {
        return {
          success: false,
          error:
            'No active OTP challenge found. Please sign in with your email and password first.',
        };
      }

      const cleanCode = code.trim();
      if (!/^\d{6}$/.test(cleanCode)) {
        return {
          success: false,
          error: 'Please enter a valid 6-digit numeric verification code.',
        };
      }

      if (isSupabaseConfigured && supabase) {
        if (!pendingOtpChallenge.challengeToken) {
          setPendingOtpChallenge(null);
          return {
            success: false,
            error: 'Verification challenge state is incomplete. Please sign in again.',
          };
        }

        try {
          const verified = await invokeAdminAuthVerify(supabase, {
            challengeId: pendingOtpChallenge.challengeId,
            challengeToken: pendingOtpChallenge.challengeToken,
            otpCode: cleanCode,
          });

          const { error: sessionErr } = await supabase.auth.setSession({
            access_token: verified.session.access_token,
            refresh_token: verified.session.refresh_token,
          });

          if (sessionErr) {
            setAdminSession(null);
            return {
              success: false,
              error:
                'Verification succeeded, but establishing the browser session failed. Please sign in again.',
            };
          }

          const now = Date.now();
          const otpVerifiedUntilMs = Date.parse(verified.admin.otpVerifiedUntil);
          const timeoutMs =
            (verified.admin.sessionTimeoutMinutes ||
              websiteSettings.sessionTimeoutMinutes ||
              30) *
            60 *
            1000;
          const expiresAt = Number.isFinite(otpVerifiedUntilMs)
            ? Math.min(otpVerifiedUntilMs, now + timeoutMs)
            : now + timeoutMs;

          lastServerTouchRef.current = now;
          setPendingOtpChallenge(null);
          setSessionExpiredReason(null);
          setAdminSession({
            email: verified.admin.email,
            otpVerifiedAt: now,
            otpVerifiedUntil: Number.isFinite(otpVerifiedUntilMs)
              ? otpVerifiedUntilMs
              : undefined,
            lastActiveAt: now,
            expiresAt,
          });

          void refreshAdminData();
          return { success: true };
        } catch (err) {
          if (
            err instanceof SupabaseRepositoryError &&
            err.code === 'CHALLENGE_INVALIDATED'
          ) {
            setPendingOtpChallenge(null);
          } else {
            setPendingOtpChallenge((prev) =>
              prev ? { ...prev, attempts: prev.attempts + 1 } : null
            );
          }
          return {
            success: false,
            error: extractErrorMessage(err, 'Verification code check failed.'),
          };
        }
      }

      // Local Preview Mode only
      const now = Date.now();
      if (now > pendingOtpChallenge.expiresAt) {
        setPendingOtpChallenge(null);
        return {
          success: false,
          error: 'This one-time verification code has expired. Please sign in again.',
        };
      }

      if (pendingOtpChallenge.attempts >= pendingOtpChallenge.maxAttempts) {
        setPendingOtpChallenge(null);
        appendSecurityEvent(
          'ADMIN_OTP_FAILED',
          pendingOtpChallenge.email,
          'Maximum OTP verification attempts exceeded. Challenge invalidated.'
        );
        return {
          success: false,
          error: 'Maximum verification attempts exceeded. Please sign in again.',
        };
      }

      const candidateHash = await sha256Hex(
        `${pendingOtpChallenge.challengeId}:${cleanCode}`
      );

      if (candidateHash !== pendingOtpChallenge.otpHash) {
        const nextAttempts = pendingOtpChallenge.attempts + 1;
        setPendingOtpChallenge({
          ...pendingOtpChallenge,
          attempts: nextAttempts,
        });
        appendSecurityEvent(
          'ADMIN_OTP_FAILED',
          pendingOtpChallenge.email,
          `Incorrect OTP code entered (attempt ${nextAttempts}/${pendingOtpChallenge.maxAttempts}).`
        );
        return {
          success: false,
          error: `Invalid verification code. ${
            pendingOtpChallenge.maxAttempts - nextAttempts
          } attempt(s) remaining.`,
        };
      }

      const timeoutMs = (websiteSettings.sessionTimeoutMinutes || 30) * 60 * 1000;
      const newSession: AdminSession = {
        email: pendingOtpChallenge.email,
        otpVerifiedAt: now,
        lastActiveAt: now,
        expiresAt: now + timeoutMs,
      };

      setPendingOtpChallenge(null);
      setSessionExpiredReason(null);
      setAdminSession(newSession);
      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, JSON.stringify(newSession));
      appendSecurityEvent(
        'ADMIN_OTP_VERIFIED',
        newSession.email,
        'Local preview OTP verified. Preview dashboard session granted.'
      );

      return { success: true };
    },
    [
      appendSecurityEvent,
      pendingOtpChallenge,
      refreshAdminData,
      websiteSettings.sessionTimeoutMinutes,
    ]
  );

  const resendAdminOtp = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    if (!pendingOtpChallenge) {
      return { success: false, error: 'No active login challenge.' };
    }

    if (isSupabaseConfigured && supabase) {
      if (!pendingOtpChallenge.challengeToken) {
        setPendingOtpChallenge(null);
        return {
          success: false,
          error: 'Verification challenge state is incomplete. Please sign in again.',
        };
      }

      try {
        const refreshed = await invokeAdminAuthResend(
          supabase,
          pendingOtpChallenge.challengeId,
          pendingOtpChallenge.challengeToken
        );
        setPendingOtpChallenge({
          challengeId: refreshed.challengeId,
          challengeToken: refreshed.challengeToken,
          email: refreshed.email || pendingOtpChallenge.email,
          expiresAt: Date.parse(refreshed.expiresAt),
          resendAvailableAt: Date.parse(refreshed.resendAvailableAt),
          attempts: 0,
          maxAttempts: refreshed.maxAttempts,
        });
        return { success: true };
      } catch (err) {
        if (
          err instanceof SupabaseRepositoryError &&
          err.code === 'CHALLENGE_INVALIDATED'
        ) {
          setPendingOtpChallenge(null);
        }
        return {
          success: false,
          error: extractErrorMessage(
            err,
            'Could not resend verification code right now.'
          ),
        };
      }
    }

    // Local Preview Mode only
    const now = Date.now();
    if (now < pendingOtpChallenge.resendAvailableAt) {
      const waitSec = Math.ceil((pendingOtpChallenge.resendAvailableAt - now) / 1000);
      return {
        success: false,
        error: `Please wait ${waitSec}s before requesting a new code.`,
      };
    }

    const randomSixDigits = Math.floor(100000 + Math.random() * 900000).toString();
    const challengeId = 'chl_' + now;
    const otpHash = await sha256Hex(`${challengeId}:${randomSixDigits}`);

    setPendingOtpChallenge({
      ...pendingOtpChallenge,
      challengeId,
      otpHash,
      demoOtpDisplay: randomSixDigits,
      expiresAt: now + 5 * 60 * 1000,
      resendAvailableAt: now + 30 * 1000,
      attempts: 0,
    });

    appendSecurityEvent(
      'ADMIN_OTP_ISSUED',
      pendingOtpChallenge.email,
      `Resent preview 6-digit challenge ${challengeId}. Previous code invalidated.`
    );

    return { success: true };
  }, [appendSecurityEvent, pendingOtpChallenge]);

  const requestPasswordRecovery = useCallback(
    async (email: string): Promise<{ success: boolean; message: string }> => {
      const cleanEmail = email.trim().toLowerCase();
      if (isSupabaseConfigured && supabase) {
        const redirectTo =
          typeof window !== 'undefined'
            ? `${window.location.origin}/admin?recovery=1`
            : undefined;
        const { error } = await supabase.auth.resetPasswordForEmail(
          cleanEmail,
          redirectTo ? { redirectTo } : undefined
        );
        if (error) {
          return {
            success: false,
            message: 'Unable to dispatch password recovery email right now.',
          };
        }
      }
      return {
        success: true,
        message:
          'If that email matches the registered administrator account, a password recovery link has been dispatched.',
      };
    },
    []
  );

  const completePasswordRecovery = useCallback(
    async (
      newPassword: string
    ): Promise<{ success: boolean; message?: string; error?: string }> => {
      const pwError = validateNewAdminPassword(newPassword);
      if (pwError) {
        return { success: false, error: pwError };
      }

      if (!isSupabaseConfigured || !supabase) {
        setPendingPasswordRecovery(null);
        return {
          success: true,
          message:
            'Preview recovery completed. Please sign in with your password and complete 6-digit OTP verification.',
        };
      }

      if (
        !pendingPasswordRecovery ||
        (!pendingPasswordRecovery.tokenHash && !pendingPasswordRecovery.accessToken)
      ) {
        setPendingPasswordRecovery(null);
        return {
          success: false,
          error:
            'Recovery session token is missing or expired. Please request a new password recovery email.',
        };
      }

      try {
        const res = await invokeAdminAuthCompleteRecovery(supabase, {
          tokenHash: pendingPasswordRecovery.tokenHash,
          accessToken: pendingPasswordRecovery.accessToken,
          newPassword,
        });
        // Clear recovery state & ensure zero authenticated session exists prior to full Password + OTP login
        setPendingPasswordRecovery(null);
        setPendingOtpChallenge(null);
        setAdminSession(null);
        clearLiveAdminWorkspaceState();
        void supabase.auth.signOut().catch(() => {});
        return { success: true, message: res.message };
      } catch (err) {
        return {
          success: false,
          error: extractErrorMessage(
            err,
            'Unable to complete password recovery. Please request a new recovery link.'
          ),
        };
      }
    },
    [clearLiveAdminWorkspaceState, pendingPasswordRecovery]
  );

  const cancelPasswordRecovery = useCallback(() => {
    setPendingPasswordRecovery(null);
    if (typeof window !== 'undefined' && (window.location.search || window.location.hash)) {
      window.history.replaceState({}, '', '/admin/login');
    }
  }, []);

  const logoutAdmin = useCallback(
    (reason?: string) => {
      const actor = adminSession?.email || pendingOtpChallenge?.email || 'admin@711acks.ph';
      const hadActiveSession = Boolean(adminSession);
      setAdminSession(null);
      setPendingOtpChallenge(null);
      if (!isSupabaseConfigured) {
        localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
        appendSecurityEvent(
          'ADMIN_LOGOUT',
          actor,
          reason || 'Administrator signed out manually.'
        );
        return;
      }

      clearLiveAdminWorkspaceState();
      if (supabase) {
        if (hadActiveSession) {
          // Invoke server-side revocation BEFORE clearing local memory JWT so Bearer auth reaches the Edge Function
          invokeAdminAuthLogout(supabase, {
            eventType: 'ADMIN_LOGOUT',
            reason: reason || 'Administrator signed out manually.',
          })
            .catch(() => {})
            .finally(() => {
              void supabase?.auth.signOut().catch(() => {});
            });
        } else {
          void supabase.auth.signOut().catch(() => {});
        }
      }
    },
    [adminSession, appendSecurityEvent, clearLiveAdminWorkspaceState, pendingOtpChallenge]
  );

  // Admin: Product Catalog Management with Price Snapshot Protection (Section 15)
  const addOrUpdateProduct = useCallback(
    async (
      productInput: Omit<ProductCatalogItem, 'id' | 'lastUpdatedAt'> & { id?: string }
    ): Promise<{
      success: boolean;
      error?: string;
      flaggedRecipesCount?: number;
      productId?: string;
    }> => {
      if (!adminSession) {
        return {
          success: false,
          error: 'Unauthorized: Verified admin session required.',
        };
      }
      touchAdminActivity();

      const cleanName = productInput.name.trim();
      if (!cleanName) {
        return { success: false, error: 'Product name is required.' };
      }
      if (!productInput.photoUrl) {
        return { success: false, error: 'Actual product photo is required.' };
      }
      if (
        typeof productInput.purchasePrice !== 'number' ||
        Number.isNaN(productInput.purchasePrice) ||
        productInput.purchasePrice < 0
      ) {
        return {
          success: false,
          error: 'Valid non-negative purchase price is required.',
        };
      }

      const otherBarcodes = products
        .filter((p) => p.id !== productInput.id && p.barcode)
        .map((p) => p.barcode!);

      const barcodeCheck = validateBarcode(productInput.barcode, otherBarcodes);
      if (!barcodeCheck.valid) {
        return { success: false, error: barcodeCheck.error };
      }

      if (isSupabaseConfigured) {
        try {
          const saved = await upsertProductAdmin(supabase, {
            id: productInput.id,
            name: cleanName,
            photoUrl: productInput.photoUrl,
            purchasePrice: productInput.purchasePrice,
            barcode: productInput.barcode,
            isArchived: productInput.isArchived,
          });
          await refreshAdminData();
          return {
            success: true,
            productId: saved.id,
          };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(err, 'Failed to save product to Supabase.'),
          };
        }
      }

      const nowIso = new Date().toISOString();

      if (productInput.id) {
        const existing = products.find((p) => p.id === productInput.id);
        if (!existing) {
          return { success: false, error: 'Product record not found.' };
        }

        const priceChanged = existing.purchasePrice !== productInput.purchasePrice;
        let flaggedCount = 0;

        setProducts((prev) =>
          prev.map((p) =>
            p.id === productInput.id
              ? {
                  ...p,
                  name: cleanName,
                  photoUrl: productInput.photoUrl,
                  purchasePrice: Number(productInput.purchasePrice.toFixed(2)),
                  barcode: productInput.barcode?.trim() || undefined,
                  isArchived: productInput.isArchived,
                  lastUpdatedAt: nowIso,
                }
              : p
          )
        );

        if (priceChanged) {
          setPriceHistory((prev) => [
            {
              id: 'pph-' + Date.now(),
              productId: existing.id,
              productName: cleanName,
              previousPrice: existing.purchasePrice,
              newPrice: Number(productInput.purchasePrice.toFixed(2)),
              changedAt: nowIso,
            },
            ...prev,
          ]);

          const { updatedRecipes, flaggedRecipeIds } = applyProductCatalogPriceUpdate(
            recipes,
            existing.id,
            Number(productInput.purchasePrice.toFixed(2))
          );
          flaggedCount = flaggedRecipeIds.length;
          setRecipes(updatedRecipes);
        }

        return {
          success: true,
          flaggedRecipesCount: flaggedCount,
          productId: existing.id,
        };
      } else {
        const newId = 'prod-' + Date.now();
        const created: ProductCatalogItem = {
          id: newId,
          name: cleanName,
          photoUrl: productInput.photoUrl,
          purchasePrice: Number(productInput.purchasePrice.toFixed(2)),
          barcode: productInput.barcode?.trim() || undefined,
          isArchived: false,
          lastUpdatedAt: nowIso,
        };
        setProducts((prev) => [created, ...prev]);
        return { success: true, flaggedRecipesCount: 0, productId: newId };
      }
    },
    [adminSession, products, recipes, refreshAdminData, touchAdminActivity]
  );

  const toggleArchiveProduct = useCallback(
    async (productId: string): Promise<{ success: boolean; error?: string }> => {
      if (!adminSession) {
        return { success: false, error: 'Unauthorized: Verified admin session required.' };
      }
      touchAdminActivity();

      const target = products.find((p) => p.id === productId);
      if (!target) {
        return { success: false, error: 'Product not found.' };
      }

      if (isSupabaseConfigured) {
        try {
          await setProductArchivedAdmin(supabase, productId, !target.isArchived);
          await refreshAdminData();
          return { success: true };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(err, 'Failed to update product archive status.'),
          };
        }
      }

      setProducts((prev) =>
        prev.map((p) =>
          p.id === productId
            ? { ...p, isArchived: !p.isArchived, lastUpdatedAt: new Date().toISOString() }
            : p
        )
      );
      return { success: true };
    },
    [adminSession, products, refreshAdminData, touchAdminActivity]
  );

  // Admin: Save or Update Recipe + Automatic Revision History (Section 14)
  const saveRecipe = useCallback(
    async (
      recipeData: Omit<
        DrinkRecipe,
        'id' | 'slug' | 'createdAt' | 'updatedAt' | 'likesCount'
      > & {
        id?: string;
        slug?: string;
      },
      asPendingDraftOnPublished = false
    ): Promise<{ success: boolean; error?: string; recipeId?: string }> => {
      if (!adminSession) {
        return {
          success: false,
          error: 'Unauthorized: Verified admin session required.',
        };
      }
      touchAdminActivity();

      const cleanName = recipeData.name.trim();
      if (!cleanName) {
        return { success: false, error: 'Drink name is required.' };
      }
      if (!recipeData.ingredients || recipeData.ingredients.length === 0) {
        return { success: false, error: 'At least one ingredient is required.' };
      }

      const calc = calculateFullPurchaseCost(recipeData.ingredients);
      if (recipeData.status === 'Published' && !calc.allPricesVerified) {
        return {
          success: false,
          error: `Cannot publish recipe with unverified ingredient prices (${calc.missingPriceIngredients.join(
            ', '
          )}). Save as Draft or verify all prices first.`,
        };
      }

      const nowIso = new Date().toISOString();

      if (isSupabaseConfigured) {
        try {
          if (recipeData.id && asPendingDraftOnPublished) {
            await saveRecipePendingDraftAdmin(supabase, recipeData.id, {
              name: cleanName,
              category: recipeData.category,
              tasteNotes: recipeData.tasteNotes,
              photoUrl: recipeData.photoUrl,
              ingredients: recipeData.ingredients,
              savedAt: nowIso,
            });
            await refreshAdminData();
            return { success: true, recipeId: recipeData.id };
          }

          const resolvedSlug = resolveUniqueRecipeSlug(cleanName, recipes, {
            editingRecipeId: recipeData.id,
            explicitSlug: recipeData.slug,
            fallbackPrefix: 'drink-recipe',
          });
          if (!resolvedSlug.success || !resolvedSlug.slug) {
            return {
              success: false,
              error: resolvedSlug.error || 'Could not resolve a unique recipe slug.',
            };
          }

          const saved = await saveRecipeWithIngredientsAdmin(supabase, {
            id: recipeData.id,
            slug: resolvedSlug.slug,
            name: cleanName,
            category: recipeData.category,
            status: recipeData.status,
            photoUrl: recipeData.photoUrl,
            submitterName: recipeData.submitterName || 'Admin',
            tasteNotes: recipeData.tasteNotes,
            isEditorsPick: recipeData.isEditorsPick,
            isTrending: recipeData.isTrending,
            ingredients: recipeData.ingredients,
            actorEmail: adminSession.email,
          });
          await refreshAdminData();
          return { success: true, recipeId: saved.recipeId };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(err, 'Failed to save recipe to Supabase.'),
          };
        }
      }

      // Local Preview Mode
      if (recipeData.id) {
        const existing = recipes.find((r) => r.id === recipeData.id);
        if (!existing) {
          return { success: false, error: 'Recipe not found.' };
        }

        if (existing.status === 'Published' && asPendingDraftOnPublished) {
          setRecipes((prev) =>
            prev.map((r) =>
              r.id === existing.id
                ? {
                    ...r,
                    pendingDraft: {
                      name: cleanName,
                      category: recipeData.category,
                      tasteNotes: recipeData.tasteNotes,
                      photoUrl: recipeData.photoUrl,
                      ingredients: recipeData.ingredients,
                      savedAt: nowIso,
                    },
                    updatedAt: nowIso,
                  }
                : r
            )
          );
          return { success: true, recipeId: existing.id };
        }

        const changedFields: string[] = [];
        const previousValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};

        if (existing.name !== cleanName) {
          changedFields.push('name');
          previousValues.name = existing.name;
          newValues.name = cleanName;
        }
        if (existing.category !== recipeData.category) {
          changedFields.push('category');
          previousValues.category = existing.category;
          newValues.category = recipeData.category;
        }
        if (existing.status !== recipeData.status) {
          changedFields.push('status');
          previousValues.status = existing.status;
          newValues.status = recipeData.status;
        }
        if (existing.totalPurchaseCost !== calc.totalPurchaseCost) {
          changedFields.push('totalPurchaseCost');
          previousValues.totalPurchaseCost = existing.totalPurchaseCost;
          newValues.totalPurchaseCost = calc.totalPurchaseCost;
        }
        if (JSON.stringify(existing.ingredients) !== JSON.stringify(recipeData.ingredients)) {
          changedFields.push('ingredients');
          previousValues.ingredients = existing.ingredients;
          newValues.ingredients = recipeData.ingredients;
        }

        if (changedFields.length > 0) {
          const existingRevs = recipeRevisions.filter((rev) => rev.recipeId === existing.id);
          const nextVersion = existingRevs.length + 1;
          const newRev: RecipeRevision = {
            id: 'rev-' + Date.now(),
            recipeId: existing.id,
            recipeName: cleanName,
            versionNumber: nextVersion,
            changedFields,
            previousValues,
            newValues,
            changeSummary: `Updated ${changedFields.join(', ')} on "${cleanName}".`,
            createdBy: adminSession.email,
            createdAt: nowIso,
          };
          setRecipeRevisions((prev) => [newRev, ...prev]);
        }

        if (calc.allPricesVerified && calc.totalPurchaseCost !== null) {
          setRecipePriceSnapshots((prev) => [
            {
              id: 'snap-' + Date.now(),
              recipeId: existing.id,
              totalPurchaseCost: calc.totalPurchaseCost!,
              ingredientBreakdown: recipeData.ingredients.map((ing) => ({
                productId: ing.productId,
                productNameSnapshot: ing.productNameSnapshot,
                quantityUsed: ing.quantityUsed,
                unitsToPurchase: ing.unitsToPurchase,
                priceSnapshot: ing.priceSnapshot ?? 0,
                lineTotal: Number(((ing.priceSnapshot ?? 0) * ing.unitsToPurchase).toFixed(2)),
              })),
              verifiedBy: adminSession.email,
              verifiedAt: nowIso,
            },
            ...prev,
          ]);
        }

        const editSlugResolution = resolveUniqueRecipeSlug(cleanName, recipes, {
          editingRecipeId: existing.id,
          explicitSlug: recipeData.slug,
        });
        if (!editSlugResolution.success || !editSlugResolution.slug) {
          return {
            success: false,
            error:
              editSlugResolution.error || 'Slug collides with another recipe.',
          };
        }

        setRecipes((prev) =>
          prev.map((r) =>
            r.id === existing.id
              ? {
                  ...r,
                  name: cleanName,
                  slug: editSlugResolution.slug!,
                  category: recipeData.category,
                  status: recipeData.status,
                  photoUrl: recipeData.photoUrl,
                  submitterName: recipeData.submitterName || 'Anonymous Creator',
                  tasteNotes: recipeData.tasteNotes,
                  ingredients: recipeData.ingredients,
                  totalPurchaseCost: calc.totalPurchaseCost,
                  priceVerified: calc.allPricesVerified,
                  needsPriceReview: false,
                  lastPriceVerifiedAt: calc.allPricesVerified
                    ? nowIso
                    : r.lastPriceVerifiedAt,
                  isEditorsPick: recipeData.isEditorsPick,
                  isTrending: recipeData.isTrending,
                  pendingDraft: null,
                  publishedAt:
                    recipeData.status === 'Published' && !r.publishedAt
                      ? nowIso
                      : r.publishedAt,
                  updatedAt: nowIso,
                }
              : r
          )
        );

        return { success: true, recipeId: existing.id };
      } else {
        const newId = 'rec-' + Date.now();
        const createSlugResolution = resolveUniqueRecipeSlug(cleanName, recipes, {
          explicitSlug: recipeData.slug,
          fallbackPrefix: 'drink-recipe',
        });
        if (!createSlugResolution.success || !createSlugResolution.slug) {
          return {
            success: false,
            error:
              createSlugResolution.error ||
              'Unable to allocate a unique recipe slug.',
          };
        }
        const finalSlug = createSlugResolution.slug;

        const created: DrinkRecipe = {
          id: newId,
          slug: finalSlug,
          name: cleanName,
          category: recipeData.category,
          status: recipeData.status,
          photoUrl: recipeData.photoUrl,
          submitterName: recipeData.submitterName || 'Admin',
          tasteNotes: recipeData.tasteNotes,
          ingredients: recipeData.ingredients,
          totalPurchaseCost: calc.totalPurchaseCost,
          priceVerified: calc.allPricesVerified,
          needsPriceReview: false,
          lastPriceVerifiedAt: calc.allPricesVerified ? nowIso : null,
          isEditorsPick: recipeData.isEditorsPick,
          isTrending: recipeData.isTrending,
          likesCount: 0,
          publishedAt: recipeData.status === 'Published' ? nowIso : null,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        setRecipes((prev) => [created, ...prev]);

        const initialRev: RecipeRevision = {
          id: 'rev-' + Date.now(),
          recipeId: newId,
          recipeName: cleanName,
          versionNumber: 1,
          changedFields: ['created', 'status', 'totalPurchaseCost'],
          previousValues: {},
          newValues: {
            name: cleanName,
            category: created.category,
            status: created.status,
            totalPurchaseCost: created.totalPurchaseCost,
            ingredients: created.ingredients,
          },
          changeSummary: `Created recipe "${cleanName}" (${created.status}).`,
          createdBy: adminSession.email,
          createdAt: nowIso,
        };
        setRecipeRevisions((prev) => [initialRev, ...prev]);

        return { success: true, recipeId: newId };
      }
    },
    [adminSession, recipeRevisions, recipes, refreshAdminData, touchAdminActivity]
  );

  const applyPendingDraftToPublished = useCallback(
    async (recipeId: string): Promise<{ success: boolean; error?: string }> => {
      if (!adminSession) {
        return { success: false, error: 'Unauthorized: Verified admin session required.' };
      }
      const target = recipes.find((r) => r.id === recipeId);
      if (!target || !target.pendingDraft) {
        return { success: false, error: 'Pending draft not found.' };
      }

      return saveRecipe(
        {
          id: target.id,
          slug: target.slug,
          name: target.pendingDraft.name,
          category: target.pendingDraft.category,
          status: 'Published',
          photoUrl: target.pendingDraft.photoUrl,
          submitterName: target.submitterName,
          tasteNotes: target.pendingDraft.tasteNotes,
          ingredients: target.pendingDraft.ingredients,
          totalPurchaseCost: null,
          priceVerified: true,
          needsPriceReview: false,
          lastPriceVerifiedAt: new Date().toISOString(),
          isEditorsPick: target.isEditorsPick,
          isTrending: target.isTrending,
          publishedAt: target.publishedAt,
        },
        false
      );
    },
    [adminSession, recipes, saveRecipe]
  );

  const verifyRecipeCurrentCatalogPrices = useCallback(
    async (recipeId: string): Promise<{ success: boolean; error?: string }> => {
      if (!adminSession) {
        return { success: false, error: 'Unauthorized: Verified admin session required.' };
      }
      touchAdminActivity();

      if (isSupabaseConfigured) {
        try {
          await verifyRecipeCatalogPricesAdmin(supabase, recipeId, adminSession.email);
          await refreshAdminData();
          return { success: true };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(
              err,
              'Failed to verify recipe prices against catalog in Supabase.'
            ),
          };
        }
      }

      const target = recipes.find((r) => r.id === recipeId);
      if (!target) return { success: false, error: 'Recipe not found.' };

      const updatedIngredients: RecipeIngredient[] = target.ingredients.map((ing) => {
        if (!ing.productId) return ing;
        const catalogProduct = products.find((p) => p.id === ing.productId);
        if (!catalogProduct) return ing;
        return {
          ...ing,
          productNameSnapshot: catalogProduct.name,
          productPhotoSnapshot: catalogProduct.photoUrl,
          priceSnapshot: catalogProduct.purchasePrice,
          priceVerified: true,
        };
      });

      const calc = calculateFullPurchaseCost(updatedIngredients);
      const nowIso = new Date().toISOString();

      const existingRevs = recipeRevisions.filter((rev) => rev.recipeId === target.id);
      const newRev: RecipeRevision = {
        id: 'rev-' + Date.now(),
        recipeId: target.id,
        recipeName: target.name,
        versionNumber: existingRevs.length + 1,
        changedFields: ['totalPurchaseCost', 'ingredients_price_snapshot'],
        previousValues: {
          totalPurchaseCost: target.totalPurchaseCost,
          ingredients: target.ingredients,
        },
        newValues: {
          totalPurchaseCost: calc.totalPurchaseCost,
          ingredients: updatedIngredients,
        },
        changeSummary: `Reviewed and updated price snapshot from ₱${
          target.totalPurchaseCost?.toFixed(2) ?? 'N/A'
        } to ₱${calc.totalPurchaseCost?.toFixed(2) ?? 'N/A'}.`,
        createdBy: adminSession.email,
        createdAt: nowIso,
      };

      setRecipeRevisions((prev) => [newRev, ...prev]);
      setRecipes((prev) =>
        prev.map((r) =>
          r.id === target.id
            ? {
                ...r,
                ingredients: updatedIngredients,
                totalPurchaseCost: calc.totalPurchaseCost,
                priceVerified: calc.allPricesVerified,
                needsPriceReview: false,
                lastPriceVerifiedAt: nowIso,
                updatedAt: nowIso,
              }
            : r
        )
      );
      return { success: true };
    },
    [
      adminSession,
      products,
      recipeRevisions,
      recipes,
      refreshAdminData,
      touchAdminActivity,
    ]
  );

  const restoreRecipeRevision = useCallback(
    async (revisionId: string): Promise<{ success: boolean; error?: string }> => {
      if (!adminSession) {
        return { success: false, error: 'Unauthorized.' };
      }
      touchAdminActivity();

      if (isSupabaseConfigured) {
        try {
          await restoreRecipeRevisionAdmin(supabase, revisionId, adminSession.email);
          await refreshAdminData();
          return { success: true };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(err, 'Failed to restore recipe revision in Supabase.'),
          };
        }
      }

      const rev = recipeRevisions.find((r) => r.id === revisionId);
      if (!rev) {
        return { success: false, error: 'Revision record not found.' };
      }
      const targetRecipe = recipes.find((r) => r.id === rev.recipeId);
      if (!targetRecipe) {
        return { success: false, error: 'Associated recipe not found.' };
      }

      const sourceSnapshot =
        Object.keys(rev.previousValues).length > 0 ? rev.previousValues : rev.newValues;

      const restoredName =
        typeof sourceSnapshot.name === 'string' ? sourceSnapshot.name : targetRecipe.name;
      const restoredCategory =
        typeof sourceSnapshot.category === 'string'
          ? (sourceSnapshot.category as DrinkCategory)
          : targetRecipe.category;
      const restoredIngredients = Array.isArray(sourceSnapshot.ingredients)
        ? (sourceSnapshot.ingredients as RecipeIngredient[])
        : targetRecipe.ingredients;

      const calc = calculateFullPurchaseCost(restoredIngredients);
      const nowIso = new Date().toISOString();

      const existingRevs = recipeRevisions.filter((r) => r.recipeId === targetRecipe.id);
      const restoreRev: RecipeRevision = {
        id: 'rev-' + Date.now(),
        recipeId: targetRecipe.id,
        recipeName: restoredName,
        versionNumber: existingRevs.length + 1,
        changedFields: ['restored_version'],
        previousValues: {
          name: targetRecipe.name,
          category: targetRecipe.category,
          totalPurchaseCost: targetRecipe.totalPurchaseCost,
          ingredients: targetRecipe.ingredients,
        },
        newValues: {
          name: restoredName,
          category: restoredCategory,
          totalPurchaseCost: calc.totalPurchaseCost,
          ingredients: restoredIngredients,
        },
        changeSummary: `Restored state from Revision v${rev.versionNumber} (non-destructive).`,
        restoredFromRevisionId: rev.id,
        createdBy: adminSession.email,
        createdAt: nowIso,
      };

      setRecipeRevisions((prev) => [restoreRev, ...prev]);
      setRecipes((prev) =>
        prev.map((r) =>
          r.id === targetRecipe.id
            ? {
                ...r,
                name: restoredName,
                category: restoredCategory,
                ingredients: restoredIngredients,
                totalPurchaseCost: calc.totalPurchaseCost,
                priceVerified: calc.allPricesVerified,
                needsPriceReview: false,
                updatedAt: nowIso,
              }
            : r
        )
      );

      return { success: true };
    },
    [adminSession, recipeRevisions, recipes, refreshAdminData, touchAdminActivity]
  );

  const approveCommunitySubmission = useCallback(
    async (
      submissionId: string,
      overrides: {
        name: string;
        category: DrinkCategory;
        photoUrl: string;
        tasteNotes?: string;
        ingredients: RecipeIngredient[];
        adminNotes?: string;
      }
    ): Promise<{ success: boolean; error?: string; recipeSlug?: string }> => {
      if (!adminSession) {
        return { success: false, error: 'Unauthorized.' };
      }
      touchAdminActivity();

      const calc = calculateFullPurchaseCost(overrides.ingredients);
      if (!calc.allPricesVerified) {
        return {
          success: false,
          error:
            'All ingredient purchase prices must be verified before approving a community submission for public display.',
        };
      }

      const slugResolution = resolveUniqueRecipeSlug(overrides.name, recipes, {
        fallbackPrefix: 'community-hack',
      });
      if (!slugResolution.success || !slugResolution.slug) {
        return {
          success: false,
          error:
            slugResolution.error ||
            'Unable to allocate a unique slug for the approved recipe.',
        };
      }
      const finalSlug = slugResolution.slug;

      if (isSupabaseConfigured) {
        try {
          const res = await invokeApproveCommunitySubmissionEdgeFunction(
            supabase,
            {
              submissionId,
              name: overrides.name.trim(),
              slug: finalSlug,
              category: overrides.category,
              photoUrl: overrides.photoUrl,
              tasteNotes: overrides.tasteNotes,
              ingredients: overrides.ingredients,
              adminNotes: overrides.adminNotes,
            }
          );
          await refreshAdminData();
          return { success: true, recipeSlug: res.slug };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(
              err,
              'Failed to promote image and approve community submission.'
            ),
          };
        }
      }

      const sub = communitySubmissions.find((s) => s.id === submissionId);
      if (!sub) {
        return { success: false, error: 'Submission not found.' };
      }

      const nowIso = new Date().toISOString();
      const newRecipeId = 'rec-' + Date.now();
      const publishedRecipe: DrinkRecipe = {
        id: newRecipeId,
        slug: finalSlug,
        name: overrides.name.trim(),
        category: overrides.category,
        status: 'Published',
        photoUrl: overrides.photoUrl,
        submitterName: sub.submitterName || 'Anonymous Creator',
        tasteNotes: overrides.tasteNotes,
        ingredients: overrides.ingredients,
        totalPurchaseCost: calc.totalPurchaseCost,
        priceVerified: true,
        needsPriceReview: false,
        lastPriceVerifiedAt: nowIso,
        isEditorsPick: false,
        isTrending: false,
        likesCount: 1,
        publishedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      setRecipes((prev) => [publishedRecipe, ...prev]);
      setCommunitySubmissions((prev) =>
        prev.map((item) =>
          item.id === submissionId
            ? {
                ...item,
                status: 'Published',
                adminReviewNotes:
                  overrides.adminNotes || 'Approved and verified by Admin.',
                reviewedAt: nowIso,
              }
            : item
        )
      );

      setRecipeRevisions((prev) => [
        {
          id: 'rev-' + Date.now(),
          recipeId: newRecipeId,
          recipeName: publishedRecipe.name,
          versionNumber: 1,
          changedFields: ['community_submission_approved'],
          previousValues: { submissionId },
          newValues: {
            totalPurchaseCost: publishedRecipe.totalPurchaseCost,
            ingredients: publishedRecipe.ingredients,
          },
          changeSummary: `Approved community submission by ${
            publishedRecipe.submitterName
          }. Verified total purchase cost: ₱${publishedRecipe.totalPurchaseCost?.toFixed(
            2
          )}.`,
          createdBy: adminSession.email,
          createdAt: nowIso,
        },
        ...prev,
      ]);

      return { success: true, recipeSlug: finalSlug };
    },
    [adminSession, communitySubmissions, recipes, refreshAdminData, touchAdminActivity]
  );

  const rejectCommunitySubmission = useCallback(
    async (
      submissionId: string,
      reason: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!adminSession) {
        return { success: false, error: 'Unauthorized.' };
      }
      touchAdminActivity();

      if (isSupabaseConfigured) {
        try {
          await rejectCommunitySubmissionAdmin(supabase, submissionId, reason);
          await refreshAdminData();
          return { success: true };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(err, 'Failed to reject community submission.'),
          };
        }
      }

      setCommunitySubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId
            ? {
                ...s,
                status: 'Rejected',
                adminReviewNotes:
                  reason || 'Submission rejected during editorial review.',
                reviewedAt: new Date().toISOString(),
              }
            : s
        )
      );
      return { success: true };
    },
    [adminSession, refreshAdminData, touchAdminActivity]
  );

  const updateContactReportStatus = useCallback(
    async (
      reportId: string,
      status: ContactReport['status'],
      adminNotes?: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!adminSession) {
        return { success: false, error: 'Unauthorized.' };
      }
      touchAdminActivity();

      if (isSupabaseConfigured) {
        try {
          await updateContactReportStatusAdmin(supabase, reportId, status, adminNotes);
          await refreshAdminData();
          return { success: true };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(err, 'Failed to update contact report status.'),
          };
        }
      }

      const nowIso = new Date().toISOString();
      setContactReports((prev) =>
        prev.map((rep) =>
          rep.id === reportId
            ? {
                ...rep,
                status,
                adminNotes: adminNotes !== undefined ? adminNotes : rep.adminNotes,
                resolvedAt: status === 'Resolved' ? nowIso : rep.resolvedAt,
              }
            : rep
        )
      );
      return { success: true };
    },
    [adminSession, refreshAdminData, touchAdminActivity]
  );

  const updateWebsiteSettings = useCallback(
    async (
      partial: Partial<WebsiteSettings>
    ): Promise<{ success: boolean; error?: string }> => {
      if (!adminSession) {
        return { success: false, error: 'Unauthorized.' };
      }
      touchAdminActivity();

      if (isSupabaseConfigured) {
        try {
          const updated = await updateWebsiteSettingsAdmin(supabase, partial);
          setWebsiteSettings(updated);
          if (
            partial.maintenanceMode !== undefined &&
            partial.maintenanceMode !== websiteSettings.maintenanceMode
          ) {
            appendSecurityEvent(
              'MAINTENANCE_MODE_CHANGED',
              adminSession.email,
              `Maintenance Mode ${partial.maintenanceMode ? 'ENABLED' : 'DISABLED'}.`
            );
          }
          return { success: true };
        } catch (err) {
          return {
            success: false,
            error: extractErrorMessage(err, 'Failed to update website settings in Supabase.'),
          };
        }
      }

      setWebsiteSettings((prev) => {
        const next = {
          ...prev,
          ...partial,
          updatedAt: new Date().toISOString(),
        };
        if (
          partial.maintenanceMode !== undefined &&
          partial.maintenanceMode !== prev.maintenanceMode
        ) {
          appendSecurityEvent(
            'MAINTENANCE_MODE_CHANGED',
            adminSession.email,
            `Maintenance Mode ${partial.maintenanceMode ? 'ENABLED' : 'DISABLED'}.`
          );
        }
        return next;
      });
      return { success: true };
    },
    [
      adminSession,
      appendSecurityEvent,
      touchAdminActivity,
      websiteSettings.maintenanceMode,
    ]
  );

  // Backup and Data Export including Storage Asset Manifest (Section 20)
  const generateBackupPackage = useCallback(async (): Promise<{
    success: boolean;
    backup?: BackupPackage;
    error?: string;
  }> => {
    if (!adminSession) {
      return {
        success: false,
        error: 'Unauthorized: Verified admin session required.',
      };
    }
    touchAdminActivity();

    const exportedAt = new Date().toISOString();
    const publishedDrinkImages = recipes.map((r) => r.photoUrl);
    const verifiedProductPhotos = products.map((p) => p.photoUrl);
    const pendingSubmissionImages = communitySubmissions
      .map((s) => s.finishedPhotoUrl)
      .filter((u): u is string => Boolean(u));

    const pkg: BackupPackage = {
      schemaVersion: '711acks-v1.0',
      exportedAt,
      checksum: `chk_${Date.now()}_${recipes.length}r_${products.length}p`,
      storageAssetManifest: {
        totalAssets:
          publishedDrinkImages.length +
          verifiedProductPhotos.length +
          pendingSubmissionImages.length,
        publishedDrinkImages,
        verifiedProductPhotos,
        pendingSubmissionImages,
      },
      data: {
        products,
        productPriceHistory: priceHistory,
        recipes,
        communitySubmissions,
        productSuggestions,
        recipeRevisions,
        contactReports,
        likesMap,
        websiteSettings,
      },
    };

    const backupFilename = `711acks-full-backup-${exportedAt.slice(0, 10)}.json`;
    const recordCounts = {
      recipes: recipes.length,
      products: products.length,
      communitySubmissions: communitySubmissions.length,
      recipeRevisions: recipeRevisions.length,
      contactReports: contactReports.length,
    };

    if (isSupabaseConfigured) {
      try {
        const meta = await recordBackupMetadataAdmin(supabase, {
          backupFilename,
          recordCounts,
          includesStorageManifest: true,
          checksum: pkg.checksum,
        });
        setBackupRecords((prev) => [meta, ...prev]);
      } catch (err) {
        return {
          success: false,
          error: extractErrorMessage(
            err,
            'Could not record backup metadata in Supabase.'
          ),
        };
      }
    } else {
      setBackupRecords((prev) => [
        {
          id: 'bak-' + Date.now(),
          backupFilename,
          recordCounts,
          includesStorageManifest: true,
          checksum: pkg.checksum,
          createdBy: adminSession.email,
          createdAt: exportedAt,
        },
        ...prev,
      ]);
    }

    appendSecurityEvent(
      'BACKUP_EXPORTED',
      adminSession.email,
      `Exported full system backup (${recipes.length} recipes, ${products.length} products, ${pkg.storageAssetManifest.totalAssets} image assets).`
    );

    return { success: true, backup: pkg };
  }, [
    adminSession,
    appendSecurityEvent,
    communitySubmissions,
    contactReports,
    likesMap,
    priceHistory,
    productSuggestions,
    products,
    recipeRevisions,
    recipes,
    touchAdminActivity,
    websiteSettings,
  ]);

  const restoreFromBackupPackage = useCallback(
    async (payload: unknown): Promise<{ success: boolean; error?: string }> => {
      if (!adminSession) {
        return {
          success: false,
          error: 'Unauthorized: Verified admin session required.',
        };
      }
      touchAdminActivity();

      const validation = validateBackupPackage(payload);
      if (!validation.valid || !validation.parsed) {
        return { success: false, error: validation.error };
      }

      if (isSupabaseConfigured) {
        return {
          success: false,
          error:
            'Live PostgreSQL backup restoration requires a reviewed server-side transactional restore workflow and is disabled in Phase 2B.',
        };
      }

      const { data } = validation.parsed;
      setProducts(data.products);
      setPriceHistory(data.productPriceHistory || []);
      setRecipes(data.recipes);
      setCommunitySubmissions(data.communitySubmissions);
      setProductSuggestions(data.productSuggestions || []);
      setRecipeRevisions(data.recipeRevisions);
      setContactReports(data.contactReports);
      setLikesMap(data.likesMap || {});
      setWebsiteSettings(data.websiteSettings);

      appendSecurityEvent(
        'BACKUP_RESTORED',
        adminSession.email,
        `Restored local preview database & image manifest backup exported at ${validation.parsed.exportedAt}.`
      );

      return { success: true };
    },
    [adminSession, appendSecurityEvent, touchAdminActivity]
  );

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        products,
        priceHistory,
        recipes,
        recipePriceSnapshots,
        communitySubmissions,
        productSuggestions,
        recipeRevisions,
        contactReports,
        websiteSettings,
        securityEvents,
        backupRecords,
        isLiveSupabase: isSupabaseConfigured,
        isLoadingData,
        dataError,
        isLoadingAdminData,
        adminDataError,
        refreshPublicData,
        refreshAdminData,
        favorites,
        toggleFavorite,
        isFavorite,
        likedRecipeIds,
        toggleLike,
        hasLiked,
        isLikePending,
        uploadPendingSubmissionPhoto,
        getPendingPhotoSignedUrl,
        submitCommunityHack,
        submitContactReport,
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
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside an AppProvider');
  }
  return ctx;
}
