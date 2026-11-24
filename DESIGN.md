---
name: 711acks
description: Independent digital collection of creative 7-Eleven Philippines drink combinations
colors:
  primary: "#294735"
  secondary: "#D7E07A"
  neutral-dark: "#17201B"
  neutral-light: "#F5F3EC"
  neutral-muted: "#C9C5B8"
  pure-white: "#FFFFFF"
typography:
  display:
    fontFamily: "Outfit, sans-serif"
    fontWeight: 300
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Outfit, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontWeight: 600
    letterSpacing: "0.05em"
  mono:
    fontFamily: "JetBrains Mono, monospace"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-light}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
  button-accent:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.neutral-dark}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-dark}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  card-drink:
    backgroundColor: "{colors.pure-white}"
    rounded: "{rounded.lg}"
    padding: "0px"
  input-field:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.neutral-dark}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    height: "44px"
---

# Design System: 711acks

## Overview

**Creative North Star: "The Midnight Bodega"**

The visual world of 711acks reflects the ambient warmth, late-night quietude, and distinct glow of an after-hours 7-Eleven in the Philippines, reframed through a disciplined, high-craft editorial lens. Rather than mimicking commercial retail noise or adopting generic SaaS card templates, the interface treats beverage hacks as handcrafted discoveries. Deep cypress tones, obsidian shadows, and linen backgrounds provide a rich, tactile canvas illuminated by razor-sharp citron accents and soft light reveals.

Every screen balances high-utility mobile scanability with cinematic atmosphere. The dual-theme "Midnight Green" architecture transitions seamlessly between the warm daylight of Linen Cream (`#F5F3EC`) and the immersive nighttime depth of Obsidian Midnight (`#17201B`). Subtle micro-spring presses, 44px minimum touch targets, and fine-pointer hover lifts give the application a physical, responsive presence that honors convenience-store immediacy without sacrificing editorial restraint.

**Key Characteristics:**
- Atmospheric lighting and multi-stop eased gradients that eliminate banding
- Oversized ultra-light display typography paired with crystal-clear tabular figures
- Translucent hairline borders and ambient depth over heavy drop shadows
- High-contrast, touch-optimized ergonomics tailored for mobile convenience-store browsing
- Strict separation between fan-made editorial minimalism and commercial retail clutter

## Colors

The palette embraces the "Midnight Green" identity—a grounded, atmospheric harmony of deep botanicals, rich obsidian darks, and organic neutrals punctuated by an electric citron spark.

### Primary
- **Deep Cypress Forest** (`#294735`): Represents the foundational brand weight and grounded structure. Used for primary desktop action buttons, active navigation markers, and anchor containers in light mode.

### Secondary
- **Electric Citron Lime** (`#D7E07A`): The nocturnal spotlight accent. Used strategically for interactive likes, focus rings, dark-mode primary actions, and high-priority visual triggers.

### Neutral
- **Obsidian Midnight** (`#17201B`): The default dark-mode background and public text color in light mode. Evokes the atmosphere of a quiet city street at 2:00 AM.
- **Linen Cream** (`#F5F3EC`): The default light-mode canvas. Soft, organic, and easy on the eyes under harsh fluorescent convenience-store lighting.
- **Pumice Gray** (`#C9C5B8`): Used for secondary captions, metadata, inactive icons, and subtle dividers across both themes.
- **Pure White** (`#FFFFFF`): Light-mode card backgrounds, modal canvases, and dark-mode high-contrast headers.

### Named Rules
**The Citron Rarity Rule.** Electric Citron Lime (`#D7E07A`) must never cover more than 8% of any given screen. Its power comes from scarcity—a focused beam of light directing attention to likes, active filters, and primary confirmations.

**The Heritage Stripe Rule.** The official 7-Eleven-inspired colors (Orange `#F58220`, Green `#008061`, Red `#EE2526`) exist strictly as a single 3px decorative hairline in the site footer. They are never permitted on buttons, cards, or hero elements, preserving the project's independent identity.

## Typography

**Display Font:** Outfit (fallback: system-ui, sans-serif)  
**Body Font:** Plus Jakarta Sans (fallback: system-ui, -apple-system, sans-serif)  
**Label/Mono Font:** JetBrains Mono (fallback: monospace) with `font-variant-numeric: tabular-nums`

**Character:** Cinematic editorial elegance achieved through ultra-light, wide-tracked display headers contrasted against crisp, sturdy geometric sans body text and rigid tabular monospace figures.

### Hierarchy
- **Display** (Light 300, clamp 2.25rem to 4.5rem, line-height 1.05, tracking `-0.02em` or `0.22em`): Hero headlines ("HACK YOUR SIP") and top-level wordmark ("711ACKS").
- **Headline** (SemiBold 600, 1.5rem to 2rem, line-height 1.25, tracking `-0.01em`): Section titles, modal headers, and empty-state callouts.
- **Title** (SemiBold 600, 1.125rem to 1.25rem, line-height 1.35): Drink card titles and catalog product names.
- **Body** (Regular 400, 0.875rem to 1rem, line-height 1.5): Descriptive prose, ingredient quantities, and help notes.
- **Label** (SemiBold 600, 0.75rem to 0.8125rem, letter-spacing `0.05em`, uppercase): Action buttons, category badges, and table headers.
- **Numeric/Price** (Medium 500, tabular-nums, 0.875rem to 1.5rem): Verified Philippine Peso (₱) price totals and unit calculations.

### Named Rules
**The Tabular Price Rule.** Every currency figure, purchase cost, and quantity count must strictly render in `JetBrains Mono` or enforce `font-variant-numeric: tabular-nums` (`tabular-nums-strict`). Figures must never jump or misalign during state changes or real-time calculations.

**The Light Display Rule.** Display headings larger than 24px must always use font weights of 300 or lighter. Heavy display weights create brutish promotional posters; light weights create editorial luxury.

## Layout

The spatial model prioritizes breathability and rapid scanability. Screens anchor to a centered 7xl container (`max-w-7xl`, 1280px) with standard `px-6` horizontal padding.

- **Vertical Rhythm:** Generous multi-tiered separation (`py-16` on major page containers, `space-y-24` between home editorial sections, `space-y-8` on detail sidebars).
- **Grid Structure:** Explore grids adapt seamlessly across viewports:
  - Mobile (<640px): 1 column with full-width cards and touch-optimized controls.
  - Tablet (640px–1024px): 2 columns.
  - Desktop (>1024px): 3 to 4 columns.
- **Mobile Ergonomics:** Strict adherence to mobile safe areas via `.safe-top` and `.safe-bottom` (`env(safe-area-inset)`). Mobile navigation collapses to a clean sheet; dialogs on mobile convert into bottom sheets rather than centered desktop modals.

## Elevation & Depth

711acks deliberately avoids heavy drop shadows and glassmorphic blur stacks. Depth is established through tonal layering, translucent hairline boundaries, and multi-stop eased gradient scrims.

- **Hairline Borders:** Translucent 1px borders (`rgba(23, 32, 27, 0.11)` in light mode, `rgba(215, 224, 122, 0.13)` in dark mode) frame cards, headers, and inputs.
- **Ambient Card Shadows:**
  - Resting: `0 1px 2px rgba(23, 32, 27, 0.04), 0 6px 18px -8px rgba(23, 32, 27, 0.08)`
  - Hover: `0 2px 4px rgba(23, 32, 27, 0.06), 0 14px 30px -12px rgba(23, 32, 27, 0.14)`
- **Eased Scrims:** Multi-stop linear gradients (`hero-scrim-bottom`, `card-scrim-bottom`) span 5 distinct opacity steps (`96%`, `78%`, `48%`, `20%`, `5%`, `0%`) to eliminate banding over product photography.

### Named Rules
**The Fine-Pointer Hover Rule.** Transform lifts (`translate3d(0, -2px, 0)`) and card-zoom effects (`scale(1.04)`) are strictly scoped inside `@media (hover: hover) and (pointer: fine)`. Mobile touch screens never trigger sticky hover states.

**The Pressable Feedback Rule.** All interactive elements must implement the `.pressable` utility, applying GPU-accelerated scaling (`transform: scale(0.97)`) on `:active` with a snappy 160ms ease-out curve (`cubic-bezier(0.165, 0.84, 0.44, 1)`).

## Motion & Gesture Physics

Motion in 711acks is utilitarian, physical, and restrained. It gives visual weight and tactile immediacy to interactive elements without decorative delays, layout jank, or sluggish physics.

### Easing & Duration Curves
- **Standard UI Enter / Exit:** UI enter/exit transitions must strictly complete under 300ms (standard range: 150ms–250ms) using `--ease-out` (`cubic-bezier(0.165, 0.84, 0.44, 1)`). Used for button presses, like badges, dropdown menus, and card hovers.
- **Full-Width Sheets & Drawers:** 200ms–240ms using `--ease-sheet` (`cubic-bezier(0.32, 0.72, 0, 1)`). Provides organic deceleration as larger surfaces settle into the viewport.
- **Physical Spring Snap-Back:** 260ms using `cubic-bezier(0.22, 1.12, 0.36, 1)`. Applied strictly when snapping a dragged modal or drawer back to resting position.
- **Explicit Bans:** Never use `ease-in` for UI transitions (feels sluggish and unresponsive). Never apply blanket `transition: all` (causes costly layout recalculations and property fighting). Always specify exact animated properties.

### GPU-Only Animation
All transitions and animations must execute strictly on the GPU compositor thread:
- **Permitted Properties:** `transform` (`translate3d`, `scale`), `opacity`, and micro-blurs (`filter: blur(2px)` strictly < 20px).
- **Prohibited Layout Properties:** Never animate geometry or box-model properties: `width`, `height`, `top`, `left`, `bottom`, `right`, `padding`, or `margin`. Layout property animations trigger CPU reflows and break 60fps/120fps fluid interaction.

### Gesture Architecture (SwipeableModal & Hero Flashlight)
Direct touch and cursor gestures operate on a strict two-phase tracking lifecycle:
1. **Active Tracking Phase (1:1 Direct Manipulation):**
   - While dragging a bottom sheet (`SwipeableModal`) or moving the spotlight (`HeroFlashlight`), movement is mapped 1:1 directly to pointer coordinates.
   - Zero artificial easing, zero transition delay, and zero React state re-renders during active pointer movement (coordinates mutate live DOM styles via refs).
   - Upward dragging on bottom sheets applies rubber-band resistance (`dy * 0.2`), while downward dragging tracks 1:1 along the dismiss axis.
2. **Release & Dismissal Phase (Velocity-Seeded):**
   - **Dismissal Criteria:** A gesture dismisses if downward drag distance reaches **≥ 40%** of the panel height (`dy >= panelHeight * 0.4`) OR downward flick velocity exceeds **500px/s** (`velocityY > 500`).
   - **Spring Bounce Isolation:** Subtle spring bounce (`cubic-bezier(0.22, 1.12, 0.36, 1)`) triggers **only on physical drag release** when snapping back. Programmatic closes (close button click, backdrop tap, or keyboard `Escape`) complete cleanly with zero bounce via standard ease-out exit.

### Named Rules
**The Sub-300ms Transition Rule.** All standard UI interface transitions must complete in under 300ms (targeted 150ms–250ms). Animations exist to clarify physical state changes, never to entertain or keep users waiting.

**The Compositor-Only Rule.** Animations must touch only `transform`, `opacity`, or sub-20px `filter: blur`. Any animation touching layout or box-model dimensions is rejected during review.

**The Zero-Rerender Gesture Rule.** High-frequency pointer and touch move handlers must never call React `setState`. Store live coordinates in mutable refs and write styles directly to element refs.

**The Velocity-Seeded Dismiss Rule.** Bottom sheets dismiss on ≥40% displacement or >500px/s flick velocity. Subtle spring bounce is isolated strictly to physical drag snap-backs; button and Escape closes remain bounce-free.

## Shapes

- **Base Radius:** 8px (`rounded-lg`) is the canonical curvature for buttons, form inputs, badges, and small surface panels.
- **Card Radius:** 12px (`rounded-xl`) for drink cards, modal containers, and hero cards.
- **Pill Radius:** 9999px (`rounded-full`) reserved strictly for status chips, like counters, and the cursor spotlight.
- **Touch Target Integrity:** Every compact interactive target must embed `.hit-target-44`, ensuring an invisible minimum 44x44px hitbox even when the visible container is 32px or 36px.

## Components

### Buttons
- **Shape:** Softly curved corners (8px radius, `rounded-lg`).
- **Primary:** Deep Cypress Forest (`#294735`) in light mode; Electric Citron Lime (`#D7E07A`) with Obsidian text (`#17201B`) in dark mode. Height 40px, padding `8px 16px`, bold uppercase tracking.
- **Secondary / Ghost:** Transparent background, hairline border (`#17201B/20` light, `#D7E07A/30` dark), hover surface tint.
- **Like Button (Signature Pill):** Translucent backdrop-blur badge at rest; filled Citron Lime (`#D7E07A`) with Obsidian heart icon when liked. Always visible on mobile, reveals on hover on desktop.

### Cards / Containers
- **Corner Style:** 12px radius (`rounded-xl`).
- **Background:** Pure White (`#FFFFFF`) in light mode; dark forest slate (`#1E2B23`) in dark mode.
- **Aspect Ratio:** Fixed 4:3 for drink photography with lazy loading and object-cover positioning.
- **Border & Shadow:** 1px hairline border with micro ambient shadow, lifting smoothly on fine-pointer hover.

### Inputs / Fields
- **Style:** 44px minimum height, 8px radius, subtle hairline border, `Plus Jakarta Sans` body typography.
- **Focus:** 2px high-visibility focus ring without layout shift (`#294735` in light mode, `#D7E07A` in dark mode).
- **Touch Protection:** Minimum 16px font-size on coarse pointer viewports to prevent iOS Safari auto-zoom.

### Navigation
- **Header:** Sticky frosted glass header (`#F5F3EC/92` light, `#17201B/92` dark) with `backdrop-blur-md` and 1px hairline bottom border.
- **Wordmark:** Left-aligned single text element `711ACKS` in `Outfit` light (200/300) with wide tracking (`0.22em`).
- **Links:** 5 concise desktop text links with a 1.5px sliding active underline indicator.

### Signature Component: Dual-Scene Hero Flashlight
- **Description:** Interactive storefront canvas with a cursor-following circular spotlight revealing day and night transitions without blocking button clicks or text selection.

## Do's and Don'ts

### Do:
- **Do** display all product prices and total purchase sums in Philippine Pesos (₱) using strict tabular numeric typography.
- **Do** enforce an invisible 44x44px minimum hit target (`.hit-target-44`) on all touch targets regardless of their visible visual size.
- **Do** constrain all UI transitions to 150ms–250ms (strictly < 300ms) using `cubic-bezier(0.165, 0.84, 0.44, 1)`.
- **Do** animate only GPU-accelerated compositor properties (`transform`, `opacity`, and micro-blurs < 20px).
- **Do** track touch and pointer gestures 1:1 with zero artificial easing and zero React re-renders during drag events.
- **Do** dismiss swipeable modals when drag displacement reaches ≥ 40% or downward flick velocity exceeds 500px/s.
- **Do** isolate spring bounce strictly to physical drag release snap-backs (keeping button/Escape closes bounce-free).
- **Do** use multi-stop eased gradients (at least 4 stops) whenever overlaying dark scrims on food and beverage photography.
- **Do** honor reduced motion preferences by canceling spring transforms and auto-scroll behaviors under `@media (prefers-reduced-motion: reduce)`.
- **Do** keep product ingredient cards focused on commercial shelf packaging photos and full-unit retail pricing.

### Don't:
- **Don't** use `ease-in` timing curves or blanket `transition: all`.
- **Don't** animate layout geometry such as `width`, `height`, `top`, `left`, `padding`, or `margin`.
- **Don't** trigger React state re-renders inside `pointermove` or `touchmove` gesture loops.
- **Don't** add spring bounces to programmatic button clicks or keyboard `Escape` dismissals.
- **Don't** use standard two-stop linear gradients that create harsh banding edges over dark backgrounds.
- **Don't** attach hover effects (`:hover`) without qualifying `@media (hover: hover) and (pointer: fine)`.
- **Don't** apply heavy drop shadows or colored glow halos that distract from clean photographic packaging assets.
- **Don't** use official 7-Eleven logos, trademarked slogans, or official promotional badge graphics.
- **Don't** introduce step-by-step recipe cooking tutorials, difficulty meters, or prep-time badges.
