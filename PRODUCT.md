# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** Mobile-first convenience store shoppers, students, and young professionals in the Philippines standing in or near a 7-Eleven branch seeking creative, affordable drink hacks with exact in-store basket checkout costs.
- **Secondary:** At-home beverage enthusiasts exploring trending flavor combinations, saving favorites, and submitting community drink hacks.
- **Administrator:** The site owner moderating community recipe submissions, maintaining verified product catalog prices, and managing site settings.

## Product Purpose

An independent, fan-made digital catalog that lets visitors discover, calculate, and share creative drink combinations made exclusively from products available at 7-Eleven Philippines. Success means visitors can quickly find a drink recipe, know exactly what products to grab off store shelves, and know the true checkout cost before reaching the cashier.

## Positioning

Unlike generic recipe blogs or cocktail guides, 711acks is hyper-localized to 7-Eleven Philippines and enforces a transparent **full-unit purchase cost** model (charging for whole commercial units rather than fractional portions consumed). It provides zero-friction access—no account required to browse, like, save favorites locally, or submit community hacks.

## Operating Context

- **Environment:** Primarily accessed on mobile devices with touch navigation, frequently under bright convenience store lighting or variable cellular connections.
- **Workflow:** High-speed scanability is essential: clear packaging photos, exact unit counts, and verified Philippine Peso (PHP / ₱) prices.
- **Secondary Usage:** Desktop and tablet exploration for leisure browsing, community submission review, and comprehensive single-owner administration (`/admin`).

## Capabilities and Constraints

- **Three Strict Categories:** Coffee Mixes, Chocolate-Based, Fruity & Soda. No tea, matcha, or generic milk categories.
- **Full-Unit Pricing:** Total cost sums full package retail prices for all needed items (`Sum of (Product Purchase Price × Units to Purchase)`). Unverified or missing prices are explicitly flagged rather than estimated.
- **No Step-by-Step Cooking Steps:** Intentionally omits preparation times, difficulty ratings, and cooking instructions; acts as an ingredient & cost reference.
- **Zero-Account Public Features:** Browser `localStorage` for Saved Favorites; anonymous browser-fingerprinted Likes; anonymous community hack submissions.
- **Moderation Gate:** Community submissions are queued as Pending; image uploads go to private storage and require admin verification before public publishing.
- **Admin Console (`/admin`):** Single-owner administration secured by password + 6-digit email OTP (direct TLS SMTP).
- **Architecture:** React 19, TypeScript, Vite, Tailwind CSS v4, Supabase (PostgreSQL with RLS, Storage, Edge Functions). Free-tier compatible; no paid third-party APIs.

## Brand Commitments

- **Name:** 711acks (wordplay combining "7-Eleven" and "hacks", with "11" resembling "H").
- **Strict Fan Disclaimer:** Independent fan-made project; strictly not affiliated with, sponsored, or endorsed by 7-Eleven, Inc. or Philippine Seven Corporation. No imitation of official 7-Eleven brand assets or claims of official affiliation.
- **Visual Identity:** "Midnight Green" design system (#17201B Midnight, #294735 Forest, #D7E07A Lime, #F5F3EC Cream, #C9C5B8 Warm Gray, #FFFFFF White).
- **Voice & Tone:** Editorial, cinematic, clean, authentic, and direct.

## Evidence on Hand

- Seeded drink hacks and product catalog in `src/data/seedData.ts` with verified prices and local image assets in `src/assets/images/`.
- Verified SQL migrations `001`–`006` in `supabase/migrations/`.
- 95 automated unit, domain, and security contract test suites in `src/`.
- Interactive hero flashlight assets in `public/` and `src/components/heroScene.ts`.
- Local Preview Mode with full offline functionality; live Supabase deployment pending cloud provisioning.

## Product Principles

1. **True Checkout Cost:** Always calculate and display the real-world cost of purchasing full product units at the store; never hide behind fractional portions.
2. **Fast In-Store Utility:** Design for the mobile shopper standing in an aisle—instant legibility, packaging recognition, and zero friction without signups.
3. **Trust Through Verification:** Never publish unvetted community recipes or unverified prices; transparently flag unconfirmed data.
4. **Independent Editorial Identity:** Maintain original Midnight Green aesthetic and prominent disclaimers that honor fan culture while respecting trademark boundaries.

## Accessibility & Inclusion

- High-contrast readability across Midnight Green color tokens (especially body copy, price tags, and product labels).
- Mobile-first touch targets (minimum 44x44px for buttons, toggles, and cards) and no hover-only dependencies for core actions.
- Reduced-motion support respecting `prefers-reduced-motion` (specifically on the interactive hero flashlight reveal).
