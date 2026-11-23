import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_DEFAULT_DASHBOARD_PATH,
  ADMIN_LOGIN_PATH,
  ADMIN_MODULE_PATHS,
  adminRouteToPath,
  isAdminPathname,
  parseAdminPath,
  resolveProtectedAdminRoute,
} from './adminRoutes';
import { parsePasswordRecoveryUrl } from './adminAuthController';

const ROOT_DIR = process.cwd();

test('parseAdminPath resolves /admin and all dedicated /admin/* module routes', () => {
  assert.deepEqual(parseAdminPath('/admin'), { page: 'admin', adminView: 'overview' });
  assert.deepEqual(parseAdminPath('/admin/login'), { page: 'admin', adminView: 'login' });
  assert.deepEqual(parseAdminPath('/admin/dashboard'), { page: 'admin', adminView: 'overview' });
  assert.deepEqual(parseAdminPath('/admin/recipes'), { page: 'admin', adminView: 'recipes' });
  assert.deepEqual(parseAdminPath('/admin/submissions'), { page: 'admin', adminView: 'submissions' });
  assert.deepEqual(parseAdminPath('/admin/products'), { page: 'admin', adminView: 'products' });
  assert.deepEqual(parseAdminPath('/admin/reports'), { page: 'admin', adminView: 'reports' });
  assert.deepEqual(parseAdminPath('/admin/qrcodes'), { page: 'admin', adminView: 'qrcodes' });
  assert.deepEqual(parseAdminPath('/admin/revisions'), { page: 'admin', adminView: 'revisions' });
  assert.deepEqual(parseAdminPath('/admin/activity'), { page: 'admin', adminView: 'revisions' });
  assert.deepEqual(parseAdminPath('/admin/backups'), { page: 'admin', adminView: 'backups' });
  assert.deepEqual(parseAdminPath('/admin/maintenance'), { page: 'admin', adminView: 'maintenance' });
  assert.deepEqual(parseAdminPath('/admin/settings'), { page: 'admin', adminView: 'settings' });
  assert.deepEqual(parseAdminPath('/admin/security'), { page: 'admin', adminView: 'settings' });

  // Non-admin public paths return null
  assert.equal(parseAdminPath('/'), null);
  assert.equal(parseAdminPath('/explore'), null);
  assert.equal(parseAdminPath('/drinks/kopiko-latte'), null);
  assert.equal(isAdminPathname('/admin/recipes'), true);
  assert.equal(isAdminPathname('/explore'), false);
});

test('resolveProtectedAdminRoute redirects all unauthenticated /admin/* paths to /admin/login', () => {
  const modules = Object.keys(ADMIN_MODULE_PATHS) as Array<keyof typeof ADMIN_MODULE_PATHS>;
  for (const mod of modules) {
    const res = resolveProtectedAdminRoute(
      { page: 'admin', adminView: mod },
      false,
      ADMIN_MODULE_PATHS[mod]
    );
    assert.deepEqual(res.effectiveRoute, { page: 'admin', adminView: 'login' });
    assert.equal(res.redirectPath, ADMIN_LOGIN_PATH);
  }

  // Bare /admin when unauthenticated redirects to /admin/login
  const bare = resolveProtectedAdminRoute(
    { page: 'admin', adminView: 'overview' },
    false,
    '/admin'
  );
  assert.deepEqual(bare.effectiveRoute, { page: 'admin', adminView: 'login' });
  assert.equal(bare.redirectPath, ADMIN_LOGIN_PATH);

  // Already on /admin/login when unauthenticated needs no redirect
  const alreadyLogin = resolveProtectedAdminRoute(
    { page: 'admin', adminView: 'login' },
    false,
    '/admin/login'
  );
  assert.deepEqual(alreadyLogin.effectiveRoute, { page: 'admin', adminView: 'login' });
  assert.equal(alreadyLogin.redirectPath, null);
});

test('resolveProtectedAdminRoute redirects authenticated admins from /admin or /admin/login to /admin/dashboard', () => {
  const fromLogin = resolveProtectedAdminRoute(
    { page: 'admin', adminView: 'login' },
    true,
    '/admin/login'
  );
  assert.deepEqual(fromLogin.effectiveRoute, { page: 'admin', adminView: 'overview' });
  assert.equal(fromLogin.redirectPath, ADMIN_DEFAULT_DASHBOARD_PATH);

  const fromBare = resolveProtectedAdminRoute(
    { page: 'admin', adminView: 'overview' },
    true,
    '/admin'
  );
  assert.deepEqual(fromBare.effectiveRoute, { page: 'admin', adminView: 'overview' });
  assert.equal(fromBare.redirectPath, ADMIN_DEFAULT_DASHBOARD_PATH);

  const onRecipes = resolveProtectedAdminRoute(
    { page: 'admin', adminView: 'recipes' },
    true,
    '/admin/recipes'
  );
  assert.deepEqual(onRecipes.effectiveRoute, { page: 'admin', adminView: 'recipes' });
  assert.equal(onRecipes.redirectPath, null);
  assert.equal(adminRouteToPath(onRecipes.effectiveRoute), '/admin/recipes');
});

test('parsePasswordRecoveryUrl accepts both /admin and /admin/login while still rejecting public routes', () => {
  const onAdminLogin = parsePasswordRecoveryUrl({
    pathname: '/admin/login',
    search: '?recovery=1&token_hash=abcdef0123456789abcdef0123456789&type=recovery',
    hash: '',
  });
  assert.ok(onAdminLogin);
  assert.equal(onAdminLogin.tokenHash, 'abcdef0123456789abcdef0123456789');

  assert.equal(
    parsePasswordRecoveryUrl({
      pathname: '/about',
      search: '?token_hash=abcdef0123456789abcdef0123456789&type=recovery',
      hash: '',
    }),
    null
  );
});

test('Single global Day/Night controller: only HeroFlashlight invokes toggleTheme, and Footer/Navbar/Admin have no duplicate theme or public admin controls', () => {
  const footerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Footer.tsx'), 'utf8');
  const navbarSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Navbar.tsx'), 'utf8');
  const adminSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/AdminDashboardPage.tsx'), 'utf8');
  const heroSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/HeroFlashlight.tsx'), 'utf8');

  // Only HeroFlashlight calls toggleTheme
  assert.ok(heroSrc.includes('toggleTheme'));
  assert.ok(!footerSrc.includes('toggleTheme'));
  assert.ok(!navbarSrc.includes('toggleTheme'));
  assert.ok(!adminSrc.includes('toggleTheme'));

  // Public Footer & Navbar do not expose Owner Console
  assert.ok(!footerSrc.includes('Owner Console'));
  assert.ok(!footerSrc.includes("page: 'admin'"));
  assert.ok(!navbarSrc.includes('Owner Console'));
  assert.ok(!navbarSrc.includes("page: 'admin'"));

  // Footer includes verified James Narzoles GitHub link, tagline, 3px stripe, and Browse/Community links
  assert.ok(footerSrc.includes('https://github.com/vwhosjames'));
  assert.ok(footerSrc.includes('James Narzoles'));
  assert.ok(footerSrc.includes('Fan-made drink hacks gamit ang products ng 7&#8209;Eleven Philippines.'));
  assert.ok(!footerSrc.includes('Dev Diagnostic'));
  assert.ok(footerSrc.includes('grid-cols-[1.4fr_1fr_1fr]'));
  assert.ok(footerSrc.includes('max-w-6xl'));
});
