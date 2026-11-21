export type HeroSceneMode = 'night' | 'day';

export interface HeroSceneConfig {
  mode: HeroSceneMode;
  backgroundSrc: string;
  backgroundAlt: string;
  revealSrc: string;
  revealAlt: string;
  hintText: string;
  toggleLabel: string;
}

export const HERO_SCENE_ASSETS = {
  night: '/assets/aistudio/Hero_Section_Background_Night_2d852a71.jpg',
  day: '/assets/aistudio/Hero_Section_Background_Day_f3260161.png',
  sunset: '/assets/aistudio/Hero_Section_Background_Sunset_face38da.png',
} as const;

export const HERO_SCENE_MAP: Record<HeroSceneMode, HeroSceneConfig> = {
  night: {
    mode: 'night',
    backgroundSrc: HERO_SCENE_ASSETS.night,
    backgroundAlt: 'Nighttime 7-Eleven Philippines storefront scene',
    revealSrc: HERO_SCENE_ASSETS.day,
    revealAlt: 'Daytime 7-Eleven Philippines storefront revealed by spotlight',
    hintText: 'Move cursor or drag on storefront to reveal daytime view',
    toggleLabel: 'Toggle Full Daytime Scene',
  },
  day: {
    mode: 'day',
    backgroundSrc: HERO_SCENE_ASSETS.day,
    backgroundAlt: 'Daytime 7-Eleven Philippines storefront scene',
    revealSrc: HERO_SCENE_ASSETS.sunset,
    revealAlt: 'Sunset 7-Eleven Philippines storefront revealed by spotlight',
    hintText: 'Move cursor or drag on storefront to reveal sunset view',
    toggleLabel: 'Restore Nighttime Flashlight',
  },
};

export function getHeroSceneConfig(mode: HeroSceneMode): HeroSceneConfig {
  return HERO_SCENE_MAP[mode];
}

export function getNextHeroSceneMode(mode: HeroSceneMode): HeroSceneMode {
  return mode === 'night' ? 'day' : 'night';
}

export function buildSpotlightRadialMask(x: number, y: number, radius: number): string {
  return `radial-gradient(circle ${radius}px at ${x}px ${y}px, rgba(0,0,0,1) 0%, rgba(0,0,0,0.96) 54%, rgba(0,0,0,0.45) 78%, rgba(0,0,0,0) 100%)`;
}

export function buildSpotlightRimBackground(x: number, y: number, radius: number): string {
  return `radial-gradient(circle ${radius}px at ${x}px ${y}px, rgba(215, 224, 122, 0.12) 0%, rgba(215, 224, 122, 0.04) 68%, transparent 100%)`;
}
