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

function parseLocationToRoute(): PublicRoute {
  const path = window.location.pathname;
  if (path.startsWith('/drinks/')) {
    const slug = decodeURIComponent(path.replace('/drinks/', '').replace(/\/$/, ''));
    if (slug) return { page: 'drink-detail', slug };
  }
  if (path === '/explore') return { page: 'explore' };
  if (path === '/submit') return { page: 'submit' };
  if (path === '/favorites') return { page: 'favorites' };
  if (path === '/about') return { page: 'about' };
  if (path === '/contact') return { page: 'contact' };
  if (path === '/admin') return { page: 'admin' };
  return { page: 'home' };
}

function routeToPath(route: PublicRoute): string {
  switch (route.page) {
    case 'home':
      return '/';
    case 'explore':
      return '/explore';
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
      return '/admin';
  }
}

const AppRouter: React.FC = () => {
  const { websiteSettings } = useApp();
  const [route, setRoute] = useState<PublicRoute>(() => parseLocationToRoute());

  const handleNavigate = useCallback((nextRoute: PublicRoute) => {
    setRoute(nextRoute);
    const nextPath = routeToPath(nextRoute);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseLocationToRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Admin route has its own separate protected layout (Section 5 & Section 14)
  if (route.page === 'admin') {
    return <AdminDashboardPage onNavigate={handleNavigate} />;
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
