import React from 'react';
import { Sun, Moon, Lock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PublicRoute } from './Navbar';

interface FooterProps {
  onNavigate: (route: PublicRoute) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const { theme, toggleTheme, isLiveSupabase } = useApp();

  const go = (route: PublicRoute) => {
    onNavigate(route);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-[#17201B] text-[#C9C5B8] border-t border-[#294735] mt-20">
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-10 border-b border-[#294735]/70">
          {/* Brand & Independent Disclaimer */}
          <div className="md:col-span-6 space-y-4">
            <div className="font-display text-2xl font-light tracking-[0.22em] uppercase text-[#F5F3EC]">
              711ACKS
            </div>
            <p className="text-sm text-[#C9C5B8] max-w-md leading-relaxed">
              An independent, fan-made digital collection of creative drink combinations made exclusively from products available at 7-Eleven Philippines.
            </p>
          </div>

          {/* Public Navigation Links */}
          <div className="md:col-span-3 space-y-3">
            <h3 className="text-xs font-mono-tabular uppercase tracking-widest text-[#D7E07A]">
              Explore Archive
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'explore' })}
                  className="hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  All Drink Hacks
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'explore', initialCategory: 'Coffee Mixes' })}
                  className="hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  Coffee Mixes
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'explore', initialCategory: 'Chocolate-Based' })}
                  className="hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  Chocolate-Based
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'explore', initialCategory: 'Fruity & Soda' })}
                  className="hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  Fruity &amp; Soda
                </button>
              </li>
            </ul>
          </div>

          {/* Community & Appearance */}
          <div className="md:col-span-3 space-y-3">
            <h3 className="text-xs font-mono-tabular uppercase tracking-widest text-[#D7E07A]">
              Community &amp; Info
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'submit' })}
                  className="hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  Submit a Drink Hack
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'favorites' })}
                  className="hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  Saved Browser Favorites
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'about' })}
                  className="hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  About &amp; Disclaimer
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'contact' })}
                  className="hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  Report a Price or Issue
                </button>
              </li>
            </ul>

            <div className="pt-3">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
                className="px-3.5 py-2 text-xs font-medium rounded border border-[#294735] bg-[#1E2B23] text-[#F5F3EC] hover:border-[#D7E07A] transition-colors flex items-center gap-2 cursor-pointer"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-[#D7E07A]" />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-[#D7E07A]" />
                    <span>Dark Mode</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Copyright & Quiet Owner Portal Entry */}
        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#C9C5B8]/70">
          <div className="flex flex-wrap items-center gap-2">
            <span>© {new Date().getFullYear()} 711acks Portfolio Project</span>
            <span aria-hidden="true">·</span>
            <span>
              Data Mode:{' '}
              {isLiveSupabase
                ? 'Live Supabase PostgreSQL'
                : 'Verified Demo Catalog (Configure VITE_SUPABASE_URL for cloud persistence)'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => go({ page: 'admin' })}
            className="text-xs text-[#C9C5B8]/60 hover:text-[#D7E07A] transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Lock className="w-3 h-3" />
            <span>Owner Console</span>
          </button>
        </div>
      </div>
    </footer>
  );
};
