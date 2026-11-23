import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Flashlight, Moon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PublicRoute } from './Navbar';
import {
  HERO_SCENE_ASSETS,
  HeroSceneMode,
  buildSpotlightRadialMask,
  buildSpotlightRimBackground,
  getHeroSceneConfig,
  getNextHeroSceneMode,
} from './heroScene';

interface HeroFlashlightProps {
  onNavigate: (route: PublicRoute) => void;
}

export const HeroFlashlight: React.FC<HeroFlashlightProps> = ({ onNavigate }) => {
  const { theme, toggleTheme } = useApp();
  const containerRef = useRef<HTMLElement | null>(null);
  const spotlightLayerRef = useRef<HTMLDivElement | null>(null);
  const rimLayerRef = useRef<HTMLDivElement | null>(null);

  // Zero-rerender pointer tracking: store live spotlight coords in refs and write directly to DOM
  const coordsRef = useRef<{ x: number; y: number }>({ x: 520, y: 310 });
  const radiusRef = useRef<number>(230);
  const interactedRef = useRef<boolean>(false);

  const [isSpotlightVisible, setIsSpotlightVisible] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [spotlightRadius, setSpotlightRadius] = useState<number>(230);
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);

  // Unified global Day/Night mode: dark theme = Night Mode, light theme = Day Mode
  const sceneMode: HeroSceneMode = theme === 'dark' ? 'night' : 'day';

  const applySpotlightToDom = useCallback((x: number, y: number, radius: number) => {
    coordsRef.current = { x, y };
    const mask = buildSpotlightRadialMask(x, y, radius);
    if (spotlightLayerRef.current) {
      spotlightLayerRef.current.style.webkitMaskImage = mask;
      spotlightLayerRef.current.style.maskImage = mask;
    }
    if (rimLayerRef.current) {
      rimLayerRef.current.style.background = buildSpotlightRimBackground(x, y, radius);
    }
  }, []);

  const centerSpotlight = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    applySpotlightToDom(
      Math.round(rect.width * 0.56),
      Math.round(rect.height * 0.44),
      radiusRef.current
    );
  }, [applySpotlightToDom]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);

    const handleResize = () => {
      const nextRadius = window.innerWidth < 768 ? 160 : 250;
      radiusRef.current = nextRadius;
      setSpotlightRadius(nextRadius);
      applySpotlightToDom(coordsRef.current.x, coordsRef.current.y, nextRadius);
    };
    handleResize();
    centerSpotlight();
    window.addEventListener('resize', handleResize);

    return () => {
      mediaQuery.removeEventListener('change', handler);
      window.removeEventListener('resize', handleResize);
    };
  }, [applySpotlightToDom, centerSpotlight]);

  const markInteractedOnce = useCallback(() => {
    if (!interactedRef.current) {
      interactedRef.current = true;
      setHasInteracted(true);
    }
  }, []);

  const updateCoordinates = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      // 1:1 TRACK phase: direct DOM ref write with zero easing, zero duration, zero React rerender
      applySpotlightToDom(x, y, radiusRef.current);
    },
    [applySpotlightToDom]
  );

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    markInteractedOnce();
    if (!isSpotlightVisible) setIsSpotlightVisible(true);
    updateCoordinates(e.clientX, e.clientY);
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    setIsSpotlightVisible(true);
    updateCoordinates(e.clientX, e.clientY);
  };

  const handleMouseLeave = () => {
    setIsSpotlightVisible(false);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length > 0) {
      markInteractedOnce();
      if (!isSpotlightVisible) setIsSpotlightVisible(true);
      updateCoordinates(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length > 0) {
      markInteractedOnce();
      setIsSpotlightVisible(true);
      updateCoordinates(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleToggleSceneMode = () => {
    markInteractedOnce();
    // Intentional toggle switches the unified global Day/Night theme (pointer movement never changes theme)
    getNextHeroSceneMode(sceneMode);
    toggleTheme();
    // Keep the circular flashlight visible and interactive in both Night (Day reveal) and Day (Sunset reveal) modes
    centerSpotlight();
    setIsSpotlightVisible(true);
  };

  const activeScene = getHeroSceneConfig(sceneMode);
  const isDaytimeMode = sceneMode === 'day';

  // Single reusable circular radial mask shared across both Night (Day reveal) and Daytime (Sunset reveal) modes
  const radialMaskValue = buildSpotlightRadialMask(
    coordsRef.current.x,
    coordsRef.current.y,
    spotlightRadius
  );
  const initialRimBackground = buildSpotlightRimBackground(
    coordsRef.current.x,
    coordsRef.current.y,
    spotlightRadius
  );
  const layerTransitionClass = reducedMotion
    ? 'transition-none'
    : 'transition-[opacity] duration-250 ease-[cubic-bezier(0.165,0.84,0.44,1)]';

  return (
    <section
      ref={containerRef}
      data-scene-mode={sceneMode}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      aria-label="711acks Interactive Storefront Hero"
      className="relative w-full min-h-[580px] lg:min-h-[680px] bg-[#17201B] overflow-hidden select-none touch-pan-y flex items-end"
    >
      {/* LAYER 1: Active Base Scene Background — Night (default) or Full Daytime (mounted identically to avoid flicker or shift) */}
      <div
        data-testid="hero-background-layer"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <img
          src={HERO_SCENE_ASSETS.night}
          alt={getHeroSceneConfig('night').backgroundAlt}
          aria-hidden={isDaytimeMode}
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover object-center"
          draggable={false}
        />
        <img
          src={HERO_SCENE_ASSETS.day}
          alt={getHeroSceneConfig('day').backgroundAlt}
          aria-hidden={!isDaytimeMode}
          referrerPolicy="no-referrer"
          className={`absolute inset-0 w-full h-full object-cover object-center ${layerTransitionClass} ${
            isDaytimeMode ? 'opacity-100' : 'opacity-0'
          }`}
          draggable={false}
        />
      </div>

      {/* LAYER 2: Single Reusable Circular Flashlight Reveal Layer — Day (in Night mode) or Sunset (in Daytime mode) */}
      <div
        ref={spotlightLayerRef}
        data-testid="hero-daytime-spotlight-layer"
        data-reveal-scene={isDaytimeMode ? 'sunset' : 'day'}
        className={`absolute inset-0 w-full h-full pointer-events-none ${layerTransitionClass}`}
        style={{
          WebkitMaskImage: radialMaskValue,
          maskImage: radialMaskValue,
          opacity: isSpotlightVisible ? 1 : 0,
        }}
      >
        <img
          src={HERO_SCENE_ASSETS.day}
          alt={getHeroSceneConfig('night').revealAlt}
          aria-hidden={isDaytimeMode}
          referrerPolicy="no-referrer"
          className={`absolute inset-0 w-full h-full object-cover object-center ${
            isDaytimeMode ? 'opacity-0' : 'opacity-100'
          }`}
          draggable={false}
        />
        <img
          src={HERO_SCENE_ASSETS.sunset}
          alt={getHeroSceneConfig('day').revealAlt}
          aria-hidden={!isDaytimeMode}
          referrerPolicy="no-referrer"
          className={`absolute inset-0 w-full h-full object-cover object-center ${
            isDaytimeMode ? 'opacity-100' : 'opacity-0'
          }`}
          draggable={false}
        />
      </div>

      {/* Subtle Ambient Spotlight Rim Highlight (Non-blocking, shared across both modes) */}
      {!reducedMotion && (
        <div
          ref={rimLayerRef}
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none transition-[opacity] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)]"
          style={{
            opacity: isSpotlightVisible ? 1 : 0,
            background: initialRimBackground,
          }}
        />
      )}

      {/* Multi-stop Eased Contrast Scrims (zero banding, >= 4.5:1 legibility) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none hero-scrim-bottom"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none hero-scrim-left"
      />

      {/* Interactive Content Overlay */}
      <div className="relative z-10 max-w-7xl mx-auto w-full px-6 pt-28 pb-14 lg:pb-20 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
        <div className="max-w-2xl space-y-5">
          {/* Small label: exact copy from Section 4 */}
          <p className="font-mono-tabular text-xs tracking-[0.28em] uppercase text-[#D7E07A]">
            WELCOME TO 711ACKS
          </p>

          {/* Main headline: exact copy from Section 4 */}
          <h1
            className="font-display font-extralight uppercase tracking-[0.14em] text-[#FFFFFF] leading-[1.05] text-balance"
            style={{
              fontSize: 'clamp(2.5rem, 5.2vw, 4.5rem)',
              textShadow: '0 4px 28px rgba(0, 0, 0, 0.65)',
              textWrap: 'balance',
            }}
          >
            HACK YOUR SIP.
          </h1>

          {/* Supporting text: exact copy from Section 4 */}
          <p className="text-base sm:text-lg text-[#F5F3EC]/90 font-normal leading-relaxed max-w-[48ch] text-balance">
            Discover creative drink combinations made with your favorite 7&#8209;Eleven Philippines products.
          </p>

          {/* Hero CTA Buttons: exact copy from Section 4 */}
          <div className="pt-3 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate({ page: 'explore' })}
              className="pressable min-h-[44px] px-6 py-3 text-sm font-semibold bg-[#D7E07A] text-[#17201B] rounded-lg hover:bg-[#e2ea8b] flex items-center gap-2.5 whitespace-nowrap shrink-0 cursor-pointer shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#17201B]"
            >
              <span>Explore Drink Hacks</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate({ page: 'submit' })}
              className="pressable min-h-[44px] px-6 py-3 text-sm font-medium bg-[#17201B]/80 text-[#F5F3EC] border border-[#F5F3EC]/25 hover:border-[#D7E07A]/80 hover:text-[#D7E07A] rounded-lg whitespace-nowrap shrink-0 cursor-pointer backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#17201B]"
            >
              Create Your Own Hack
            </button>
          </div>
        </div>

        {/* Compact Floating Flashlight Toggle & Auto-Hiding Tooltip at Bottom-Right */}
        <div
          onMouseMove={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="relative self-end shrink-0 group flex items-center justify-end"
        >
          <div
            role="tooltip"
            className={`pointer-events-none absolute bottom-full right-0 mb-2.5 origin-bottom-right w-max max-w-[230px] sm:max-w-none sm:whitespace-nowrap px-3 py-1.5 rounded-lg bg-[#17201B]/92 backdrop-blur-md border border-[#D7E07A]/20 text-[11px] text-[#F5F3EC] shadow-[0_12px_28px_-8px_rgba(0,0,0,0.55)] transition-[transform,opacity,filter] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] ${
              hasInteracted
                ? 'opacity-0 scale-95 blur-[2px] group-hover:opacity-100 group-hover:scale-100 group-hover:blur-none group-focus-within:opacity-100 group-focus-within:scale-100 group-focus-within:blur-none'
                : 'opacity-100 scale-100 blur-none'
            }`}
          >
            {isDaytimeMode
              ? 'Move your cursor to reveal sunset view'
              : 'Move your cursor to reveal daytime view'}
          </div>

          <button
            type="button"
            onClick={handleToggleSceneMode}
            aria-pressed={isDaytimeMode}
            aria-label={activeScene.toggleLabel}
            title={
              isDaytimeMode
                ? 'Move your cursor to reveal sunset view'
                : 'Move your cursor to reveal daytime view'
            }
            className="pressable w-11 h-11 rounded-full bg-[#17201B]/85 backdrop-blur-md border border-[#D7E07A]/25 hover:border-[#D7E07A] text-[#D7E07A] hover:bg-[#294735] shadow-[0_8px_24px_-6px_rgba(0,0,0,0.5)] flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D7E07A]"
          >
            {isDaytimeMode ? (
              <Moon className="w-4 h-4 shrink-0" />
            ) : (
              <Flashlight className="w-4 h-4 shrink-0" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
};
