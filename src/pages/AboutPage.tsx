import React from 'react';
import { PublicRoute } from '../components/Navbar';

interface AboutPageProps {
  onNavigate: (route: PublicRoute) => void;
}

/**
 * Section 17 Requirements:
 * Include:
 * 1. Our Story — Explain why 711acks was created.
 * 2. Our Concept — A collection of creative drink combinations using 7-Eleven Philippines products.
 * 3. Our Purpose — Make drink discovery fun, accessible, and easy to explore.
 * 4. Independent Project Disclaimer — Clearly state that 711acks is an independent fan-made project
 *    and is not officially affiliated with, sponsored by, or endorsed by 7-Eleven.
 */
export const AboutPage: React.FC<AboutPageProps> = ({ onNavigate }) => {
  return (
    <div className="min-h-dvh bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-14 px-6">
      <div className="max-w-4xl mx-auto space-y-14">
        {/* Editorial Title */}
        <div className="space-y-4 border-b border-[#17201B]/10 dark:border-[#D7E07A]/12 pb-8">
          <p className="font-mono-tabular text-xs uppercase tracking-[0.25em] text-[#294735] dark:text-[#D7E07A]">
            ABOUT THE ARCHIVE · WORDPLAY ON 7&#8209;ELEVEN + HACKS
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-light uppercase heading-tight">
            About 711acks
          </h1>
          <p className="text-base text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
            The name <strong>711acks</strong> combines <em>7&#8209;Eleven</em> and <em>hacks</em>, with the number <strong>11</strong> visually doubling as the letter <strong>H</strong>.
          </p>
        </div>

        {/* 3 Core Editorial Sections */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <section className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-3">
            <div className="font-mono-tabular text-xs uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
              01. Our Story
            </div>
            <h2 className="font-display text-xl font-light uppercase heading-tight">
              Why 711acks Was Created
            </h2>
            <p className="text-sm text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
              Across late-night study sessions, BPO night shifts, and spontaneous barkada road trips in the Philippines, convenience store drink mixing became a quiet local ritual. Scattered social media clips made it hard to know which combinations actually tasted good—or how much you truly needed to pay at the register. 711acks was built to organize those viral combinations into a single verifiable reference.
            </p>
          </section>

          <section className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-3">
            <div className="font-mono-tabular text-xs uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
              02. Our Concept
            </div>
            <h2 className="font-display text-xl font-light uppercase heading-tight">
              Real Products &amp; Full Purchase Costs
            </h2>
            <p className="text-sm text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
              711acks is a curated digital collection of creative drink combinations made exclusively from products available at 7&#8209;Eleven Philippines. Instead of calculating misleading fractional costs per tablespoon or half-bottle, every recipe calculates the <strong>Full Product Purchase Cost</strong>—the exact amount required to buy the whole unopened bottles, cans, and ice cups at the checkout counter.
            </p>
          </section>

          <section className="p-6 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-3">
            <div className="font-mono-tabular text-xs uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
              03. Our Purpose
            </div>
            <h2 className="font-display text-xl font-light uppercase heading-tight">
              Accessible Drink Discovery
            </h2>
            <p className="text-sm text-[#17201B]/80 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
              Our purpose is to make drink discovery fun, accessible, and effortless to explore without requiring visitor registration. Browse verified Coffee Mixes, Chocolate-Based blends, and Fruity &amp; Soda refreshers, save local favorites, scan QR codes on your phone, or submit your own discovery for editorial price verification.
            </p>
          </section>
        </div>

        {/* Independent Project Disclaimer */}
        <section
          aria-labelledby="heading-disclaimer"
          className="p-8 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card rounded-xl space-y-4"
        >
          <div className="font-mono-tabular text-xs uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
            OFFICIAL LEGAL &amp; BRAND NOTICE
          </div>
          <h2
            id="heading-disclaimer"
            className="font-display text-2xl font-light uppercase heading-tight"
          >
            Independent Project Disclaimer
          </h2>
          <p className="text-sm text-[#17201B]/85 dark:text-[#F5F3EC]/90 leading-relaxed max-w-[65ch]">
            <strong>711acks is an independent, fan-made personal portfolio project.</strong> It is NOT officially affiliated with, sponsored by, operated by, or endorsed by 7&#8209;Eleven, Inc., Seven &amp; i Holdings Co., Ltd., or Philippine Seven Corporation.
          </p>
          <p className="text-xs text-[#17201B]/75 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
            All product names, packaging references, and brand trademarks (including Kopiko, Nestlé Chuckie, Mogu Mogu, Yakult, Rite n Lite, Nescafé, Selecta, and 7&#8209;Eleven) remain the sole property of their respective trademark holders. Listed prices reflect administrator-verified purchase snapshots and do not guarantee real-time branch inventory or regional pricing.
          </p>

          <div className="pt-3 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate({ page: 'explore' })}
              className="pressable min-h-[44px] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded-lg cursor-pointer"
            >
              Explore the Collection
            </button>
            <button
              type="button"
              onClick={() => onNavigate({ page: 'contact' })}
              className="pressable min-h-[44px] px-5 py-2.5 text-xs font-medium border border-[#17201B]/18 dark:border-[#D7E07A]/20 rounded-lg cursor-pointer hover-border-accent"
            >
              Contact the Curator
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
