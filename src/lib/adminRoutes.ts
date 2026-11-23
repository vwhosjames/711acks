export type AdminModule =
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

export type AdminView = 'login' | AdminModule;

export interface AdminRoute {
  page: 'admin';
  adminView: AdminView;
}

export const ADMIN_LOGIN_PATH = '/admin/login';
export const ADMIN_DEFAULT_DASHBOARD_PATH = '/admin/dashboard';

export const ADMIN_MODULE_PATHS: Record<AdminModule, string> = {
  overview: '/admin/dashboard',
  recipes: '/admin/recipes',
  submissions: '/admin/submissions',
  products: '/admin/products',
  reports: '/admin/reports',
  qrcodes: '/admin/qrcodes',
  revisions: '/admin/revisions',
  backups: '/admin/backups',
  maintenance: '/admin/maintenance',
  settings: '/admin/settings',
};

const PATH_TO_ADMIN_VIEW: Record<string, AdminView> = {
  '/admin/login': 'login',
  '/admin/dashboard': 'overview',
  '/admin/recipes': 'recipes',
  '/admin/submissions': 'submissions',
  '/admin/products': 'products',
  '/admin/reports': 'reports',
  '/admin/qrcodes': 'qrcodes',
  '/admin/revisions': 'revisions',
  '/admin/activity': 'revisions',
  '/admin/backups': 'backups',
  '/admin/maintenance': 'maintenance',
  '/admin/settings': 'settings',
  '/admin/security': 'settings',
};

export function normalizePathname(pathname: string): string {
  const cleaned = (pathname || '/').replace(/\/+$/, '');
  return cleaned === '' ? '/' : cleaned;
}

export function isAdminPathname(pathname: string): boolean {
  const normalized = normalizePathname(pathname).toLowerCase();
  return normalized === '/admin' || normalized.startsWith('/admin/');
}

export function parseAdminPath(pathname: string): AdminRoute | null {
  const normalized = normalizePathname(pathname).toLowerCase();
  if (normalized === '/admin') {
    return { page: 'admin', adminView: 'overview' };
  }
  if (!normalized.startsWith('/admin/')) {
    return null;
  }
  const matchedView = PATH_TO_ADMIN_VIEW[normalized];
  if (matchedView) {
    return { page: 'admin', adminView: matchedView };
  }
  // Any unrecognized /admin/* sub-path falls back safely to dashboard (which redirects to /admin/login if unauthenticated)
  return { page: 'admin', adminView: 'overview' };
}

export function adminRouteToPath(route: AdminRoute): string {
  if (route.adminView === 'login') {
    return ADMIN_LOGIN_PATH;
  }
  return ADMIN_MODULE_PATHS[route.adminView] || ADMIN_DEFAULT_DASHBOARD_PATH;
}

/**
 * Enforces client-side route protection for all /admin/* paths:
 * - Unauthenticated visitors on any /admin/* route are redirected to /admin/login.
 * - Authenticated admins on /admin/login or bare /admin are redirected to /admin/dashboard.
 */
export function resolveProtectedAdminRoute(
  route: AdminRoute,
  isAuthenticated: boolean,
  currentPathname?: string
): {
  effectiveRoute: AdminRoute;
  redirectPath: string | null;
} {
  const normalizedCurrent = currentPathname
    ? normalizePathname(currentPathname).toLowerCase()
    : null;

  if (!isAuthenticated) {
    const effectiveRoute: AdminRoute = { page: 'admin', adminView: 'login' };
    const needsRedirect =
      route.adminView !== 'login' ||
      (normalizedCurrent !== null && normalizedCurrent !== ADMIN_LOGIN_PATH);
    return {
      effectiveRoute,
      redirectPath: needsRedirect ? ADMIN_LOGIN_PATH : null,
    };
  }

  if (route.adminView === 'login') {
    return {
      effectiveRoute: { page: 'admin', adminView: 'overview' },
      redirectPath: ADMIN_DEFAULT_DASHBOARD_PATH,
    };
  }

  const canonicalPath = adminRouteToPath(route);
  const needsCanonicalize =
    normalizedCurrent !== null && normalizedCurrent !== canonicalPath;

  return {
    effectiveRoute: route,
    redirectPath: needsCanonicalize ? canonicalPath : null,
  };
}
