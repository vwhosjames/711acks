import React from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PublicRoute } from './Navbar';

interface MaintenanceScreenProps {
  onNavigate: (route: PublicRoute) => void;
}

/**
 * Section 19 Requirements:
 * When enabled:
 * - Visitors see a branded maintenance page.
 * - Public website routes are temporarily unavailable.
 * - Admin can still access the dashboard.
 * - Existing database records remain intact.
 * - Admin can customize the maintenance message.
 */
export const MaintenanceScreen: React.FC<MaintenanceScreenProps> = ({
  onNavigate,
}) => {
  const { websiteSettings } = useApp();

  return (
    <div className="min-h-dvh safe-top safe-bottom bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] flex flex-col justify-between p-6 transition-[background-color,color] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)]">
      <div className="max-w-7xl mx-auto w-full py-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#17201B]/12 dark:border-[#D7E07A]/14">
        <span className="font-display text-xl font-light tracking-[0.22em] uppercase">
          711ACKS
        </span>
        <span className="font-mono-tabular text-xs uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
          Maintenance Mode Active
        </span>
      </div>

      <main className="max-w-xl mx-auto text-center space-y-6 py-20">
        <ShieldAlert className="w-12 h-12 text-[#294735] dark:text-[#D7E07A] mx-auto stroke-1" />
        <p className="font-mono-tabular text-xs uppercase tracking-[0.26em] text-[#294735] dark:text-[#D7E07A]">
          TEMPORARY ARCHIVE PAUSE
        </p>
        <h1 className="font-display text-3xl sm:text-5xl font-light uppercase heading-tight">
          {websiteSettings.maintenanceTitle}
        </h1>
        <p className="text-sm sm:text-base text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch] mx-auto">
          {websiteSettings.maintenanceMessage}
        </p>
        <div className="pt-4 text-xs text-[#17201B]/70 dark:text-[#C9C5B8]/70">
          All published recipes, product prices, and pending submissions remain safely preserved.
        </div>
      </main>

      <div className="max-w-7xl mx-auto w-full py-4 border-t border-[#17201B]/12 dark:border-[#D7E07A]/14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[#17201B]/75 dark:text-[#C9C5B8]/80">
        <span>Independent Fan-Made 7&#8209;Eleven Philippines Drink Archive</span>
        <button
          type="button"
          onClick={() => onNavigate({ page: 'admin', adminView: 'login' })}
          className="pressable min-h-[44px] sm:min-h-0 text-xs text-[#294735] dark:text-[#D7E07A] hover:underline underline-offset-4 flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A] rounded-sm"
        >
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>Administrator Console Access</span>
        </button>
      </div>
    </div>
  );
};
