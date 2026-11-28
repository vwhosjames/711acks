import React, { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Info, Mail, ShieldAlert } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { INITIAL_RECIPES } from '../data/seedData';
import { APPROVED_CATEGORIES } from '../types/domain';
import { formatPhpCurrency } from '../utils/drinkLogic';
import { PublicRoute } from '../components/Navbar';

interface AboutPageProps {
  onNavigate: (route: PublicRoute) => void;
}

const TRADEMARK_BRANDS = [
  'Kopiko',
  'Nestlé Chuckie',
  'Mogu Mogu',
  'Yakult',
  'Rite n Lite',
  'Nescafé',
  'Selecta',
  '7‑Eleven',
];

const PURPOSE_PILLARS = [
  {
    id: 'browse',
    title: `Browse ${APPROVED_CATEGORIES.length} categories`,
    detail: 'Coffee Mixes, Chocolate-Based blends, and Fruity & Soda refreshers.',
  },
  {
    id: 'save',
    title: 'Save local favorites',
    detail: 'Bookmark mixes directly in your browser with zero registration required.',
  },
  {
    id: 'shop',
    title: 'Bring to the aisle',
    detail: 'Pull up verified unit counts and shelf photos at 7‑Eleven Philippines.',
  },
  {
    id: 'submit',
    title: 'Submit discoveries',
    detail: 'Share combinations for administrator price verification.',
  },
];

interface FaqEntry {
  id: string;
  question: string;
  shortAnswer: string;
  expandedContent: React.ReactNode;
}

/**
 * Promoted Questions-First About Page (Section 17):
 * Delivers immediate 1-2 sentence answers to what visitors ask first
 * with progressive disclosure accordions, separates the CTA band cleanly
 * above the legal notice, and preserves verbatim trademark disclaimers at
 * accessible contrast alongside wrapped brand tags.
 */
export const AboutPage: React.FC<AboutPageProps> = ({ onNavigate }) => {
  const { recipes } = useApp();
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [showHWordplay, setShowHWordplay] = useState(true);

  const metrics = useMemo(() => {
    const published = recipes.filter((r) => r.status === 'Published');
    const pool = published.length > 0 ? published : INITIAL_RECIPES;
    const timestamps = pool
      .map((r) => r.lastPriceVerifiedAt)
      .filter((iso): iso is string => Boolean(iso))
      .map((iso) => new Date(iso).getTime())
      .filter((ms) => !Number.isNaN(ms));

    const latestMs = timestamps.length > 0 ? Math.max(...timestamps) : null;
    const latestPriceCheckLabel = latestMs
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(new Date(latestMs))
      : 'Pending Verification';

    const featuredRecipe =
      pool.find((r) => r.slug === 'chuckie-dirty-espresso-mudslide') ?? pool[0];

    return {
      publishedDrinkCount: pool.length,
      latestPriceCheckLabel,
      featuredRecipe,
    };
  }, [recipes]);

  const toggleFaq = (id: string) => {
    setOpenMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const faqItems: FaqEntry[] = [
    {
      id: 'what-is',
      question: 'What is 711acks?',
      shortAnswer:
        'A curated archive of drink combinations made from 7‑Eleven Philippines products—named for 7‑Eleven + hacks, where the number 11 visually doubles as the letter H.',
      expandedContent: (
        <div className="space-y-4 pt-2">
          <div className="inline-flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowHWordplay((v) => !v)}
              aria-pressed={showHWordplay}
              aria-label="Toggle 711 to H wordplay highlight"
              className="pressable min-h-[44px] px-4 py-2 rounded-xl bg-[#17201B] text-[#F5F3EC] border border-[#D7E07A]/40 inline-flex items-center gap-1 font-display text-2xl font-light tracking-tight cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A]"
            >
              <span className="text-[#F5F3EC]">7</span>
              <span
                aria-hidden="true"
                className="relative inline-flex items-center justify-center w-6 h-7 mx-0.5"
              >
                <span
                  className={`absolute left-0.5 top-1 bottom-1 w-[3px] rounded-full transition-colors duration-200 ease-out ${
                    showHWordplay ? 'bg-[#D7E07A]' : 'bg-[#F5F3EC]'
                  }`}
                />
                <span
                  className={`absolute left-0.5 right-0.5 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-[#D7E07A] origin-left transition-[transform,opacity] duration-250 ease-out ${
                    showHWordplay ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0'
                  }`}
                />
                <span
                  className={`absolute right-0.5 top-1 bottom-1 w-[3px] rounded-full transition-colors duration-200 ease-out ${
                    showHWordplay ? 'bg-[#D7E07A]' : 'bg-[#F5F3EC]'
                  }`}
                />
              </span>
              <span className="text-[#C9C5B8] text-xl ml-0.5">acks</span>
            </button>
            <span className="text-xs font-mono-tabular text-[#17201B]/80 dark:text-[#C9C5B8]">
              7‑Eleven + Hacks ({showHWordplay ? '11 → H' : '711'})
            </span>
          </div>

          <p className="text-sm text-[#17201B]/85 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
            Across late-night study sessions, BPO night shifts, and spontaneous barkada road trips in the Philippines, convenience store drink mixing became a quiet local ritual. Scattered social media clips made it hard to know which combinations actually tasted good—or how much you truly needed to pay at the register. 711acks was built to organize those viral combinations into a single verifiable reference.
          </p>
        </div>
      ),
    },
    {
      id: 'full-cost',
      question: 'Why does it show “Full Product Purchase Cost”?',
      shortAnswer:
        'Even if a recipe pours half a can, the cashier charges for the full unopened item. Every price reflects what you actually pay at checkout.',
      expandedContent: (
        <div className="space-y-3 pt-2">
          <p className="text-sm text-[#17201B]/85 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
            Instead of calculating misleading fractional costs per tablespoon or half-bottle, every recipe sums the exact retail amount needed to buy the whole unopened bottles, cans, and ice cups at the 7‑Eleven counter.
          </p>
          {metrics.featuredRecipe && (
            <p className="text-xs font-mono-tabular text-[#294735] dark:text-[#D7E07A]">
              Live catalog example: {metrics.featuredRecipe.name} totals{' '}
              {formatPhpCurrency(metrics.featuredRecipe.totalPurchaseCost)} across{' '}
              {metrics.featuredRecipe.ingredients.length} full shelf items.
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'prices-checked',
      question: 'How are prices checked?',
      shortAnswer:
        'Listed prices reflect administrator-verified purchase snapshots, updated when store branch price reports come in.',
      expandedContent: (
        <div className="space-y-2 pt-2 text-sm text-[#17201B]/85 dark:text-[#C9C5B8] max-w-[65ch]">
          <p>
            Latest snapshot recorded in archive data ({metrics.publishedDrinkCount} published mixes):{' '}
            <strong className="font-mono-tabular text-[#294735] dark:text-[#D7E07A]">
              {metrics.latestPriceCheckLabel}
            </strong>
            .
          </p>
          <p className="inline-flex items-start gap-1.5 text-xs font-mono-tabular text-[#17201B]/80 dark:text-[#C9C5B8]">
            <Info size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Visitors can flag shelf changes anytime using &ldquo;Report Outdated Price&rdquo;; regional store prices may vary by branch.
            </span>
          </p>
        </div>
      ),
    },
    {
      id: 'account-needed',
      question: 'Do I need an account?',
      shortAnswer:
        'No visitor registration is required. Browse verified mixes, save local favorites in your browser, and pull up checklists freely.',
      expandedContent: (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
          {PURPOSE_PILLARS.map((item) => (
            <li
              key={item.id}
              className="p-3 rounded-xl bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/10 dark:border-[#F5F3EC]/12 text-xs text-[#17201B]/85 dark:text-[#C9C5B8]"
            >
              <strong className="block text-[#17201B] dark:text-[#F5F3EC] mb-0.5">
                {item.title}
              </strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      ),
    },
  ];

  return (
    <div className="min-h-dvh bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-12 sm:py-14 px-6">
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <header className="space-y-3 border-b border-[#17201B]/12 dark:border-[#D7E07A]/15 pb-7">
          <p className="font-mono-tabular text-xs uppercase tracking-[0.25em] text-[#294735] dark:text-[#D7E07A]">
            About the Archive · Wordplay on 7&#8209;Eleven + Hacks
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-light uppercase heading-tight">
            About 711acks
          </h1>
          <p className="text-base text-[#17201B]/85 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
            Direct answers to what visitors ask before making a 7&#8209;Eleven drink run.
          </p>
        </header>

        {/* Questions-First Accordion Stack */}
        <section aria-label="Frequently asked questions about 711acks" className="space-y-3.5">
          {faqItems.map((item) => {
            const isExpanded = Boolean(openMap[item.id]);
            const panelId = `about-faq-${item.id}`;

            return (
              <article
                key={item.id}
                className="rounded-2xl bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card border border-[#17201B]/12 dark:border-[#D7E07A]/18 overflow-hidden"
              >
                <div className="p-5 sm:p-6 space-y-2.5">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="font-display text-xl sm:text-2xl font-light uppercase heading-tight text-[#17201B] dark:text-[#F5F3EC]">
                      {item.question}
                    </h2>

                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      onClick={() => toggleFaq(item.id)}
                      className="pressable min-h-[44px] min-w-[44px] px-3 rounded-lg bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/15 dark:border-[#D7E07A]/20 text-xs font-mono-tabular text-[#294735] dark:text-[#D7E07A] inline-flex items-center gap-1.5 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
                    >
                      <span>{isExpanded ? 'Less' : 'More'}</span>
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className={`transition-transform duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>

                  <p className="text-sm sm:text-base text-[#17201B]/85 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
                    {item.shortAnswer}
                  </p>

                  {isExpanded && (
                    <div
                      id={panelId}
                      className="about-panel-enter pt-3 mt-2 border-t border-[#17201B]/10 dark:border-[#D7E07A]/12"
                    >
                      {item.expandedContent}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        {/* Separated CTA Band ABOVE Disclaimer */}
        <section
          aria-label="Explore or contact actions"
          className="p-6 sm:p-8 rounded-2xl bg-[#294735] text-[#F5F3EC] border border-[#D7E07A]/25 flex flex-col md:flex-row md:items-center justify-between gap-5"
        >
          <div className="space-y-1 max-w-[48ch]">
            <p className="font-mono-tabular text-xs uppercase tracking-[0.2em] text-[#D7E07A]">
              Ready for your next 7&#8209;Eleven run
            </p>
            <h2 className="font-display text-2xl font-light uppercase heading-tight text-[#F5F3EC]">
              Browse verified shelf mixes
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate({ page: 'explore' })}
              className="pressable min-h-[44px] px-5 py-2.5 rounded-xl bg-[#D7E07A] text-[#17201B] text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-2 hover:brightness-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5F3EC]"
            >
              <span>Explore the Collection</span>
              <ArrowRight size={14} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate({ page: 'contact' })}
              className="pressable min-h-[44px] px-5 py-2.5 rounded-xl bg-[#17201B]/60 text-[#F5F3EC] border border-[#F5F3EC]/30 text-xs font-medium inline-flex items-center gap-2 hover:border-[#D7E07A] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A]"
            >
              <Mail size={14} aria-hidden="true" />
              <span>Contact the Curator</span>
            </button>
          </div>
        </section>

        {/* Always-Visible Independent Project Disclaimer */}
        <section
          aria-labelledby="heading-disclaimer"
          className="p-6 sm:p-8 bg-[#FFFFFF] dark:bg-[#1E2B23] surface-card border border-[#17201B]/12 dark:border-[#D7E07A]/20 rounded-2xl space-y-4"
        >
          <div className="inline-flex items-center gap-2 font-mono-tabular text-xs uppercase tracking-widest text-[#294735] dark:text-[#D7E07A]">
            <ShieldAlert size={14} aria-hidden="true" />
            <span>Official Legal &amp; Brand Notice</span>
          </div>

          <h2
            id="heading-disclaimer"
            className="font-display text-2xl font-light uppercase heading-tight text-[#17201B] dark:text-[#F5F3EC]"
          >
            Is 711acks Official? — Independent Project Disclaimer
          </h2>

          <p className="text-sm text-[#17201B] dark:text-[#F5F3EC] leading-relaxed max-w-[65ch]">
            <strong>711acks is an independent, fan-made personal portfolio project.</strong> It is NOT officially affiliated with, sponsored by, operated by, or endorsed by 7&#8209;Eleven, Inc., Seven &amp; i Holdings Co., Ltd., or Philippine Seven Corporation.
          </p>

          <p className="text-sm text-[#17201B]/85 dark:text-[#C9C5B8] leading-relaxed max-w-[65ch]">
            All product names, packaging references, and brand trademarks (including Kopiko, Nestlé Chuckie, Mogu Mogu, Yakult, Rite n Lite, Nescafé, Selecta, and 7&#8209;Eleven) remain the sole property of their respective trademark holders. Listed prices reflect administrator-verified purchase snapshots and do not guarantee real-time branch inventory or regional pricing.
          </p>

          <ul
            aria-label="Referenced trademark holders"
            className="flex flex-wrap gap-2 pt-1"
          >
            {TRADEMARK_BRANDS.map((brand) => (
              <li
                key={brand}
                className="px-2.5 py-1 rounded-md bg-[#F5F3EC] dark:bg-[#17201B] border border-[#17201B]/12 dark:border-[#F5F3EC]/15 font-mono-tabular text-xs text-[#17201B]/85 dark:text-[#C9C5B8]"
              >
                {brand}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};
