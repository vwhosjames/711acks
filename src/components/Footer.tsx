import React, { useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { PublicRoute } from './Navbar';

interface FooterProps {
  onNavigate: (route: PublicRoute) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const { isLiveSupabase } = useApp();

  useEffect(() => {
    if (!import.meta.env.DEV) {
      console.info(
        '[711ACKS] Data Mode:',
        isLiveSupabase ? 'Live Supabase PostgreSQL' : 'Local Preview Catalog'
      );
    }
  }, [isLiveSupabase]);

  const go = (route: PublicRoute) => {
    onNavigate(route);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const linkClass =
    'min-h-[44px] md:min-h-0 inline-flex items-center py-1 text-sm text-[#35443B] dark:text-[#C9C5B8] hover:text-[#294735] dark:hover:text-[#D7E07A] hover:underline underline-offset-4 transition-[color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#ECE9DF] dark:focus-visible:ring-offset-[#17201B] rounded-sm text-left';

  const headingClass =
    'text-[13px] font-medium text-[#294735] dark:text-[#E2DFD5]';

  return (
    <footer className="bg-[#ECE9DF] dark:bg-[#17201B] text-[#2F3E35] dark:text-[#C9C5B8] mt-20 safe-bottom transition-[background-color,color] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none">
      {/* 3px 7-Eleven-inspired orange, green, and red stripe accent */}
      <div aria-hidden="true" className="h-[3px] w-full flex">
        <span className="flex-1 bg-[#F58220]" />
        <span className="flex-1 bg-[#008061]" />
        <span className="flex-1 bg-[#EE2526]" />
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12 md:py-14">
        <div className="grid grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr] gap-x-8 gap-y-10 pb-10 border-b border-[#17201B]/12 dark:border-[#D7E07A]/14">
          {/* Brand Block */}
          <div className="col-span-2 md:col-span-1 space-y-3.5">
            <div className="font-display text-2xl font-light tracking-[0.22em] uppercase text-[#17201B] dark:text-[#F5F3EC]">
              711ACKS
            </div>
            <p className="text-sm text-[#2F3E35] dark:text-[#C9C5B8] max-w-[36ch] leading-relaxed text-balance">
              Fan-made drink hacks gamit ang products ng 7&#8209;Eleven Philippines.
            </p>
          </div>

          {/* Browse Column */}
          <nav aria-label="Browse drinks" className="col-span-1 space-y-2.5">
            <h3 className={headingClass}>Browse</h3>
            <ul className="space-y-0.5 md:space-y-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'explore', initialCategory: 'ALL' })}
                  className={linkClass}
                >
                  All Hacks
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() =>
                    go({ page: 'explore', initialCategory: 'Coffee Mixes' })
                  }
                  className={linkClass}
                >
                  Coffee
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() =>
                    go({ page: 'explore', initialCategory: 'Chocolate-Based' })
                  }
                  className={linkClass}
                >
                  Chocolate
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() =>
                    go({ page: 'explore', initialCategory: 'Fruity & Soda' })
                  }
                  className={linkClass}
                >
                  Fruity &amp; Soda
                </button>
              </li>
            </ul>
          </nav>

          {/* Community Column */}
          <nav aria-label="Community" className="col-span-1 space-y-2.5">
            <h3 className={headingClass}>Community</h3>
            <ul className="space-y-0.5 md:space-y-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'submit' })}
                  className={linkClass}
                >
                  Submit a Hack
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'favorites' })}
                  className={linkClass}
                >
                  Favorites
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'about' })}
                  className={linkClass}
                >
                  About
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => go({ page: 'contact' })}
                  className={linkClass}
                >
                  Report an issue
                </button>
              </li>
            </ul>
          </nav>
        </div>

        {/* Bottom Row */}
        <div className="pt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-[#3A4A40] dark:text-[#C9C5B8]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>© 2026 711ACKS</span>
            <span aria-hidden="true">·</span>
            <span>
              Built by{' '}
              <a
                href="https://github.com/vwhosjames"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] md:min-h-0 inline-flex items-center font-medium text-[#294735] dark:text-[#E2DFD5] hover:text-[#17201B] dark:hover:text-[#D7E07A] hover:underline underline-offset-4 transition-[color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#ECE9DF] dark:focus-visible:ring-offset-[#17201B] rounded-sm"
              >
                James Narzoles
              </a>
            </span>
          </div>

          <p className="leading-relaxed text-[#3A4A40] dark:text-[#C9C5B8] md:text-right">
            Not affiliated with or endorsed by 7&#8209;Eleven Philippines. Prices and availability may change.
          </p>
        </div>
      </div>
    </footer>
  );
};
