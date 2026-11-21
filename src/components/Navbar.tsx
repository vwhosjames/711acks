import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

export type PublicRoute =
  | { page: 'home' }
  | { page: 'explore'; initialCategory?: string; initialSearch?: string }
  | { page: 'submit' }
  | { page: 'favorites' }
  | { page: 'about' }
  | { page: 'contact'; relatedSlug?: string }
  | { page: 'drink-detail'; slug: string }
  | { page: 'admin' };

interface NavbarProps {
  currentRoute: PublicRoute;
  onNavigate: (route: PublicRoute) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentRoute, onNavigate }) => {
  const { favorites, theme, toggleTheme } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: { label: string; route: PublicRoute; id: string }[] = [
    { label: 'Home', route: { page: 'home' }, id: 'home' },
    { label: 'Explore', route: { page: 'explore' }, id: 'explore' },
    { label: 'Favorites', route: { page: 'favorites' }, id: 'favorites' },
    { label: 'About', route: { page: 'about' }, id: 'about' },
    { label: 'Contact', route: { page: 'contact' }, id: 'contact' },
  ];

  const handleNav = (route: PublicRoute) => {
    onNavigate(route);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-[#F5F3EC]/95 dark:bg-[#17201B]/95 backdrop-blur-md border-b border-[#C9C5B8]/40 dark:border-[#294735]/60 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-4">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => handleNav({ page: 'home' })}
          className="font-display text-xl font-light tracking-[0.22em] uppercase text-[#17201B] dark:text-[#F5F3EC] whitespace-nowrap shrink-0 text-left focus-visible:outline-2 focus-visible:outline-[#D7E07A]"
        >
          711ACKS
        </button>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-[#17201B]/75 dark:text-[#C9C5B8]"
        >
          {navItems.map((item) => {
            const isActive = currentRoute.page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.route)}
                className={`relative py-1 transition-colors whitespace-nowrap shrink-0 hover:text-[#17201B] dark:hover:text-[#FFFFFF] ${
                  isActive
                    ? 'text-[#17201B] dark:text-[#D7E07A] font-semibold after:content-[""] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-[#294735] dark:after:bg-[#D7E07A]'
                    : ''
                }`}
              >
                {item.label}
                {item.id === 'favorites' && favorites.length > 0 && (
                  <span className="ml-1.5 font-mono-tabular text-xs text-[#294735] dark:text-[#D7E07A]">
                    ({favorites.length})
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action on desktop + mobile menu trigger */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleNav({ page: 'submit' })}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-md hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
          >
            Submit a Hack
          </button>

          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden p-2 rounded-md text-[#17201B] dark:text-[#F5F3EC] hover:bg-[#294735]/10 dark:hover:bg-[#294735]/40"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#C9C5B8]/40 dark:border-[#294735]/60 bg-[#F5F3EC] dark:bg-[#17201B] px-6 py-4 space-y-3">
          <div className="flex flex-col space-y-2">
            {navItems.map((item) => {
              const isActive = currentRoute.page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.route)}
                  className={`py-2.5 text-left text-sm font-medium border-b border-[#C9C5B8]/20 dark:border-[#294735]/30 flex items-center justify-between ${
                    isActive
                      ? 'text-[#294735] dark:text-[#D7E07A] font-semibold'
                      : 'text-[#17201B] dark:text-[#F5F3EC]'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.id === 'favorites' && (
                    <span className="font-mono-tabular text-xs">
                      {favorites.length} saved
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="pt-2 flex items-center justify-between">
            <span className="text-xs text-[#17201B]/70 dark:text-[#C9C5B8]">
              Appearance Mode
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              className="px-3 py-1.5 text-xs font-medium rounded border border-[#C9C5B8] dark:border-[#294735] text-[#17201B] dark:text-[#F5F3EC]"
            >
              Switch to {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
