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
    <div className="min-h-screen bg-[#17201B] text-[#F5F3EC] flex flex-col justify-between p-6">
      <div className="max-w-7xl mx-auto w-full py-4 flex items-center justify-between border-b border-[#294735]">
        <span className="font-display text-xl font-light tracking-[0.22em] uppercase">
          711ACKS
        </span>
        <span className="font-mono-tabular text-xs uppercase tracking-widest text-[#D7E07A]">
          Maintenance Mode Active
        </span>
      </div>

      <main className="max-w-xl mx-auto text-center space-y-6 py-20">
        <ShieldAlert className="w-12 h-12 text-[#D7E07A] mx-auto stroke-1" />
        <p className="font-mono-tabular text-xs uppercase tracking-[0.26em] text-[#D7E07A]">
          TEMPORARY ARCHIVE PAUSE
        </p>
        <h1 className="font-display text-3xl sm:text-5xl font-light uppercase tracking-[0.12em]">
          {websiteSettings.maintenanceTitle}
        </h1>
        <p className="text-sm sm:text-base text-[#C9C5B8] leading-relaxed">
          {websiteSettings.maintenanceMessage}
        </p>
        <div className="pt-4 text-xs text-[#C9C5B8]/70">
          All published recipes, product prices, and pending submissions remain safely preserved.
        </div>
      </main>

      <div className="max-w-7xl mx-auto w-full py-4 border-t border-[#294735] flex items-center justify-between text-xs text-[#C9C5B8]/70">
        <span>Independent Fan-Made 7-Eleven Philippines Drink Archive</span>
        <button
          type="button"
          onClick={() => onNavigate({ page: 'admin' })}
          className="text-xs text-[#D7E07A] hover:underline flex items-center gap-1.5 cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Administrator Console Access</span>
        </button>
      </div>
    </div>
  );
};
