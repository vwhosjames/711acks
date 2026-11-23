/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar, PublicRoute } from './components/Navbar';
import { Footer } from './components/Footer';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { HomePage } from './pages/HomePage';
import { ExplorePage } from './pages/ExplorePage';
import { DrinkDetailsPage } from './pages/DrinkDetailsPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { SubmitHackPage } from './pages/SubmitHackPage';
import { AboutPage } from './pages/AboutPage';
import { ContactPage } from './pages/ContactPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { APPROVED_CATEGORIES } from './types/domain';
import {
  adminRouteToPath,
  normalizePathname,
  parseAdminPath,
  resolveProtectedAdminRoute,
} from './lib/adminRoutes';

function parseLocationToRoute(): PublicRoute {
  const path = normalizePathname(window.location.pathname);

  const adminRoute = parseAdminPath(path);
  if (adminRoute) {
    return adminRoute;
  }

  if (path.startsWith('/drinks/')) {
    const slug = decodeURIComponent(path.replace('/drinks/', '').replace(/\/$/, ''));
    if (slug) return { page: 'drink-detail', slug };
  }
  if (path === '/explore') {
    const params = new URLSearchParams(window.location.search);
    const categoryParam = params.get('category') || undefined;
    const searchParam = params.get('q') || undefined;
    return {
      page: 'explore',
      initialCategory:
        categoryParam && (APPROVED_CATEGORIES as string[]).includes(categoryParam)
          ? categoryParam
          : 'ALL',
      initialSearch: searchParam,
    };
  }
  if (path === '/submit') return { page: 'submit' };
  if (path === '/favorites') return { page: 'favorites' };
  if (path === '/about') return { page: 'about' };
  if (path === '/contact') return { page: 'contact' };
  return { page: 'home' };
}

function routeToUrl(route: PublicRoute): string {
  switch (route.page) {
    case 'home':
      return '/';
    case 'explore': {
      const params = new URLSearchParams();
      if (
        route.initialCategory &&
        (APPROVED_CATEGORIES as string[]).includes(route.initialCategory)
      ) {
        params.set('category', route.initialCategory);
      }
      if (route.initialSearch && route.initialSearch.trim()) {
        params.set('q', route.initialSearch.trim());
      }
      const query = params.toString();
      return query ? `/explore?${query}` : '/explore';
    }
    case 'submit':
      return '/submit';
    case 'favorites':
      return '/favorites';
    case 'about':
      return '/about';
    case 'contact':
      return '/contact';
    case 'drink-detail':
      return `/drinks/${encodeURIComponent(route.slug)}`;
    case 'admin':
      return adminRouteToPath(route);
  }
}

const AppRouter: React.FC = () => {
  const { websiteSettings, adminSession } = useApp();
  const [route, setRoute] = useState<PublicRoute>(() => parseLocationToRoute());

  const handleNavigate = useCallback((nextRoute: PublicRoute) => {
    const resolvedRoute: PublicRoute =
      nextRoute.page === 'admin'
        ? resolveProtectedAdminRoute(nextRoute, Boolean(adminSession)).effectiveRoute
        : nextRoute;

    setRoute(resolvedRoute);
    const nextUrl = routeToUrl(resolvedRoute);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
  }, [adminSession]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseLocationToRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Enforce protected /admin/* routing: redirect unauthenticated users to /admin/login
  // and authenticated admins visiting /admin or /admin/login to /admin/dashboard.
  useEffect(() => {
    if (route.page !== 'admin') return;
    const { effectiveRoute, redirectPath } = resolveProtectedAdminRoute(
      route,
      Boolean(adminSession),
      window.location.pathname
    );
    if (effectiveRoute.adminView !== route.adminView) {
      setRoute(effectiveRoute);
    }
    if (redirectPath && window.location.pathname !== redirectPath) {
      window.history.replaceState({}, '', redirectPath);
    }
  }, [adminSession, route]);

  // Dedicated protected Admin layout (no public navbar or public footer)
  if (route.page === 'admin') {
    const { effectiveRoute } = resolveProtectedAdminRoute(
      route,
      Boolean(adminSession),
      window.location.pathname
    );
    return (
      <AdminDashboardPage
        activeView={effectiveRoute.adminView}
        onNavigate={handleNavigate}
      />
    );
  }

  // Maintenance Mode Gate (Section 19): blocks public routes while allowing Admin access
  if (websiteSettings.maintenanceMode) {
    return <MaintenanceScreen onNavigate={handleNavigate} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] transition-colors">
      <Navbar currentRoute={route} onNavigate={handleNavigate} />

      <main className="flex-1">
        {route.page === 'home' && <HomePage onNavigate={handleNavigate} />}
        {route.page === 'explore' && (
          <ExplorePage
            initialCategory={route.initialCategory}
            initialSearch={route.initialSearch}
            onNavigate={handleNavigate}
          />
        )}
        {route.page === 'drink-detail' && (
          <DrinkDetailsPage slug={route.slug} onNavigate={handleNavigate} />
        )}
        {route.page === 'favorites' && (
          <FavoritesPage onNavigate={handleNavigate} />
        )}
        {route.page === 'submit' && (
          <SubmitHackPage onNavigate={handleNavigate} />
        )}
        {route.page === 'about' && <AboutPage onNavigate={handleNavigate} />}
        {route.page === 'contact' && (
          <ContactPage
            relatedSlug={route.relatedSlug}
            onNavigate={handleNavigate}
          />
        )}
      </main>

      <Footer onNavigate={handleNavigate} />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
