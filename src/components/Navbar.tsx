import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AdminRoute } from '../lib/adminRoutes';

export type PublicRoute =
  | { page: 'home' }
  | { page: 'explore'; initialCategory?: string; initialSearch?: string }
  | { page: 'submit' }
  | { page: 'favorites' }
  | { page: 'about' }
  | { page: 'contact'; relatedSlug?: string }
  | { page: 'drink-detail'; slug: string }
  | AdminRoute;

interface NavbarProps {
  currentRoute: PublicRoute;
  onNavigate: (route: PublicRoute) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentRoute, onNavigate }) => {
  const { favorites } = useApp();
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
    <header className="sticky top-0 z-40 w-full safe-top bg-[#F5F3EC]/92 dark:bg-[#17201B]/92 backdrop-blur-md border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 transition-[background-color,border-color] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)]">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-3.5">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => handleNav({ page: 'home' })}
          className="pressable font-display text-xl font-light tracking-[0.22em] uppercase text-[#17201B] dark:text-[#F5F3EC] whitespace-nowrap shrink-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] rounded-sm cursor-pointer"
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
                className={`relative py-1 transition-[color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] whitespace-nowrap shrink-0 hover:text-[#17201B] dark:hover:text-[#FFFFFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] rounded-sm cursor-pointer ${
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
            className="pressable min-h-[40px] px-4 py-2 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F3EC] dark:focus-visible:ring-offset-[#17201B]"
          >
            Submit a Hack
          </button>

          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="pressable md:hidden min-w-[44px] min-h-[44px] p-2 rounded-lg text-[#17201B] dark:text-[#F5F3EC] hover-surface-tint inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden origin-top border-t border-[#17201B]/10 dark:border-[#D7E07A]/12 bg-[#F5F3EC] dark:bg-[#17201B] px-6 py-4">
          <div className="flex flex-col">
            {navItems.map((item) => {
              const isActive = currentRoute.page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.route)}
                  className={`pressable min-h-[44px] py-2.5 text-left text-sm font-medium border-b border-[#17201B]/8 dark:border-[#D7E07A]/10 last:border-b-0 flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] rounded-sm cursor-pointer ${
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
        </div>
      )}
    </header>
  );
};
