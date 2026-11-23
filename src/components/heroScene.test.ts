import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HERO_SCENE_ASSETS,
  buildSpotlightRadialMask,
  buildSpotlightRimBackground,
  getHeroSceneConfig,
  getNextHeroSceneMode,
} from './heroScene';

const ROOT_DIR = process.cwd();

test('all three hero scene assets exist in public/ with no broken paths', () => {
  for (const [key, assetPath] of Object.entries(HERO_SCENE_ASSETS)) {
    assert.ok(assetPath.startsWith('/assets/'), `${key} path must start with /assets/`);
    const diskPath = path.join(ROOT_DIR, 'public', assetPath.replace(/^\/+/, ''));
    assert.ok(fs.existsSync(diskPath), `Missing hero asset on disk for ${key}: ${diskPath}`);
    const stat = fs.statSync(diskPath);
    assert.ok(stat.size > 10_000, `Hero asset ${key} should be a non-empty image file`);
  }
});

test('preserves existing Night image and integrates new Day and Sunset assets', () => {
  assert.equal(
    HERO_SCENE_ASSETS.night,
    '/assets/aistudio/Hero_Section_Background_Night_2d852a71.jpg'
  );
  assert.equal(
    HERO_SCENE_ASSETS.day,
    '/assets/aistudio/Hero_Section_Background_Day_f3260161.png'
  );
  assert.equal(
    HERO_SCENE_ASSETS.sunset,
    '/assets/aistudio/Hero_Section_Background_Sunset_face38da.png'
  );
});

test('maps Night mode to Night background + Day flashlight reveal', () => {
  const nightConfig = getHeroSceneConfig('night');
  assert.equal(nightConfig.mode, 'night');
  assert.equal(nightConfig.backgroundSrc, HERO_SCENE_ASSETS.night);
  assert.equal(nightConfig.revealSrc, HERO_SCENE_ASSETS.day);
  assert.equal(nightConfig.toggleLabel, 'Toggle Full Daytime Scene');
});

test('maps Full Daytime mode to Day background + Sunset flashlight reveal', () => {
  const dayConfig = getHeroSceneConfig('day');
  assert.equal(dayConfig.mode, 'day');
  assert.equal(dayConfig.backgroundSrc, HERO_SCENE_ASSETS.day);
  assert.equal(dayConfig.revealSrc, HERO_SCENE_ASSETS.sunset);
  assert.equal(dayConfig.toggleLabel, 'Restore Nighttime Flashlight');
});

test('repeated scene-mode toggling alternates cleanly between night and day', () => {
  let mode: 'night' | 'day' = 'night';
  const sequence: Array<'night' | 'day'> = [];
  for (let i = 0; i < 6; i += 1) {
    mode = getNextHeroSceneMode(mode);
    sequence.push(mode);
  }
  assert.deepEqual(sequence, ['day', 'night', 'day', 'night', 'day', 'night']);
});

test('reusable circular spotlight mask and rim highlight preserve feathered circular geometry', () => {
  const mask = buildSpotlightRadialMask(420, 280, 250);
  assert.equal(
    mask,
    'radial-gradient(circle 250px at 420px 280px, rgba(0,0,0,1) 0%, rgba(0,0,0,0.96) 54%, rgba(0,0,0,0.45) 78%, rgba(0,0,0,0) 100%)'
  );

  const mobileMask = buildSpotlightRadialMask(180, 240, 160);
  assert.ok(mobileMask.startsWith('radial-gradient(circle 160px at 180px 240px,'));

  const rim = buildSpotlightRimBackground(420, 280, 250);
  assert.ok(rim.includes('circle 250px at 420px 280px'));
  assert.ok(rim.includes('rgba(215, 224, 122, 0.12)'));
});

test('HeroFlashlight keeps single reusable spotlight layer, aligned image classes, pointer leave handling, and approved copy', () => {
  const heroSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src/components/HeroFlashlight.tsx'),
    'utf8'
  );

  // Single reusable masked spotlight layer (no duplicated flashlight implementation)
  const maskMatches = heroSource.match(/maskImage:\s*radialMaskValue/g) ?? [];
  assert.equal(maskMatches.length, 1, 'Expected exactly one reusable masked spotlight layer');
  assert.ok(!heroSource.includes('1600px'), 'Must not disable flashlight by expanding mask to 1600px');

  // Pointer leave + touch handlers present
  assert.ok(heroSource.includes('onMouseMove={handleMouseMove}'));
  assert.ok(heroSource.includes('onMouseEnter={handleMouseEnter}'));
  assert.ok(heroSource.includes('onMouseLeave={handleMouseLeave}'));
  assert.ok(heroSource.includes('onTouchStart={handleTouchStart}'));
  assert.ok(heroSource.includes('onTouchMove={handleTouchMove}'));

  // All 4 mounted scene img elements share identical full-bleed cover/center alignment
  const alignedImgMatches =
    heroSource.match(/absolute inset-0 w-full h-full object-cover object-center/g) ?? [];
  assert.equal(alignedImgMatches.length, 4, 'All background and reveal scene layers must share identical sizing and alignment');

  // Approved copy and layout preserved (supports non-breaking hyphen in 7-Eleven)
  assert.ok(heroSource.includes('WELCOME TO 711ACKS'));
  assert.ok(heroSource.includes('HACK YOUR SIP.'));
  assert.ok(
    heroSource.includes(
      'Discover creative drink combinations made with your favorite 7-Eleven Philippines products.'
    ) ||
      heroSource.includes(
        'Discover creative drink combinations made with your favorite 7&#8209;Eleven Philippines products.'
      )
  );
  assert.ok(heroSource.includes('Explore Drink Hacks'));
  assert.ok(heroSource.includes('Create Your Own Hack'));
  assert.ok(heroSource.includes('min-h-[580px] lg:min-h-[680px]'));

  // Unified global Day/Night theme toggle connected via useApp()
  assert.ok(heroSource.includes("theme === 'dark' ? 'night' : 'day'"));
  assert.ok(heroSource.includes('toggleTheme()'));
});

