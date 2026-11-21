# 711ACKS — MASTER WEBSITE DEVELOPMENT PROMPT

## 1. PROJECT OVERVIEW

Build a complete, polished, responsive, full-stack website called **711acks**.

711acks is an independent, fan-made digital collection of creative drink combinations made exclusively from products available at 7-Eleven Philippines.

The name 711acks is a wordplay combining 7-Eleven and hacks, with the number 11 visually resembling the letter H.

The website allows visitors to:
- Discover creative drink combinations.
- Browse drink hacks and their ingredients.
- See actual 7-Eleven product photos and purchase prices.
- Calculate and view the total purchase cost of a drink hack.
- Like and save their favorite drinks.
- Submit their own drink hacks without registering.
- Share recipes through links and QR codes.

The website also includes a private administrator dashboard for managing products, recipes, prices, community submissions, contact reports, and website settings.

This is a personal portfolio project, not a commercial business.

### Important brand disclaimer

711acks is an independent fan-made project.

It is NOT officially affiliated with, sponsored by, operated by, or endorsed by 7-Eleven or its parent companies.

Do not imitate the official 7-Eleven website or imply official ownership.

Use original branding and include a clear disclaimer on the About page and footer.

---

# 2. TECHNOLOGY STACK

Use the following technology stack:

### Frontend
- React
- TypeScript
- Tailwind CSS
- Modern component-based architecture
- Responsive layouts
- Accessible UI components

### Backend
Use Supabase exclusively.

Required Supabase services:
- Supabase PostgreSQL Database
- Supabase Authentication
- Supabase Storage
- Supabase Row Level Security (RLS)
- Supabase Edge Functions when necessary

### Hosting
- Vercel Hobby
- Deploy using a GitHub-connected workflow or Vercel deployment.

### Strict technology restrictions

DO NOT use:
- Firebase
- Cloudinary
- Paid image hosting services
- Paid APIs
- External services requiring a credit card
- Services that require a billing account to operate the initial version

Use Supabase Free and Vercel Hobby-compatible solutions.

Never silently introduce paid dependencies.

If a requested capability cannot be implemented within the selected free-tier architecture, explain the limitation and propose a free alternative before implementing it.

Do not hardcode Supabase credentials.

Use environment variables:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

Never expose the Supabase service-role key in frontend code.

Provide an `.env.example` file without real credentials.

---

# 3. BRAND IDENTITY AND VISUAL DESIGN

The visual direction is premium, cinematic, minimalist, and editorial.

The website should feel like a professionally designed digital experience rather than a generic template.

### Color palette: Midnight Green

Use these approved colors:

- Midnight: #17201B
- Forest: #294735
- Lime: #D7E07A
- Cream: #F5F3EC
- Warm Gray: #C9C5B8
- White: #FFFFFF

Use the palette consistently across public pages and admin interfaces.

### Typography

Use a minimalist geometric sans-serif typeface.

Headings:
- Ultra-light or light font weights.
- Oversized uppercase typography.
- Wide letter spacing.
- Cinematic editorial appearance.
- Spacious compositions.
- Subtle light or glow treatments where appropriate.

Body text:
- Clean and highly readable.
- Comfortable font sizes.
- Good contrast.
- No unnecessarily thin body text.

Buttons, navigation, product names, ingredient labels, and prices must remain easy to read.

### General UI principles

Follow these principles:
- Clarity
- Simplicity
- Consistency
- Accessibility
- Responsiveness
- High-quality visual craftsmanship

Avoid:
- Excessive rounded cards.
- Unnecessary gradients.
- Overused glassmorphism.
- Generic dashboard layouts.
- Excessive animations.
- Crowded sections.
- Decorative elements that interfere with usability.

Every section should have a clear visual purpose.

---

# 4. HOMEPAGE HERO EXPERIENCE

The homepage must begin with a cinematic hero section.

### Default scene

Show a realistic nighttime 7-Eleven-style storefront environment.

The visual should feel cinematic, atmospheric, and immersive.

Do not use copyrighted website screenshots or imply official endorsement.

### Interactive flashlight effect

Implement a cursor-following circular spotlight.

The default scene displays the nighttime version.

Inside the spotlight:
- Reveal a daytime or morning version of the same scene.
- The illuminated area should follow the visitor's cursor.
- Use smooth movement and transitions.
- The reveal should feel natural and polished.

This interaction should work on desktop.

On mobile, provide a touch-friendly alternative or a simplified visual reveal because there is no conventional mouse cursor.

Respect reduced-motion preferences.

Do not allow the interaction to block navigation or interfere with buttons.

### Hero copy

Use the following exact content:

Small label:
WELCOME TO 711ACKS

Main headline:

HACK YOUR SIP.

Supporting text:

Discover creative drink combinations made with your favorite 7-Eleven Philippines products.

### Hero buttons

Primary:
Explore Drink Hacks

Secondary:
Create Your Own Hack

The primary button navigates to Explore.

The secondary button navigates to Submit a Hack.

### Scroll transition

When visitors scroll down:
- Transition smoothly from the cinematic hero into clean editorial sections.
- Use subtle animation.
- Avoid excessive parallax or distracting movement.
- Maintain good performance.

---

# 5. PUBLIC WEBSITE NAVIGATION

Create the following navigation:

1. Home
2. Explore
3. Submit a Hack
4. Favorites
5. About
6. Contact

Include a prominent Submit a Hack button.

### Responsive navigation

Desktop:
- Horizontal navigation.
- Clearly visible primary action.
- Theme toggle.

Mobile:
- Compact responsive menu.
- Easy access to Favorites.
- Prominent Submit a Hack action.
- Touch-friendly controls.

Admin navigation must be separate from the public navigation.

Do not expose private admin links unnecessarily.

---

# 6. HOMEPAGE CONTENT SECTIONS

Include all five featured sections.

### 1. Trending Drink Hacks
Show popular drink combinations based on engagement.

### 2. Newest Creations
Show recently published drink hacks.

### 3. Budget-Friendly Drinks
Show drinks with the lowest verified total purchase costs.

### 4. Community Favorites
Show recipes ranked by likes.

### 5. Editor's Picks
Show recipes manually selected by the administrator.

Use a clean editorial layout.

Avoid displaying all sections as identical grids.

Use different visual compositions where appropriate while maintaining consistent branding.

The homepage must not feel overcrowded.

---

# 7. EXPLORE PAGE

Create a dedicated Explore page.

### Search

Allow visitors to search by:
- Drink name
- Ingredient or product name

### Categories

Use exactly these three primary drink categories:

1. Coffee Mixes
2. Chocolate-Based
3. Fruity & Soda

Do not add:
- Matcha & Tea
- Milk-Based

Each drink hack must have exactly one primary category.

### Sorting

Provide these options:
- Newest
- Most Popular
- Lowest Price
- Highest Price

### Drink grid

Each drink card should show only:
- Finished drink image
- Drink name
- Total purchase cost

Keep cards clean and uncluttered.

### Card interactions

Desktop:
- Subtle image zoom.
- Soft lighting effect.
- Like button appears on hover.
- Smooth visual transitions.

Mobile:
- Like button remains visible.
- Touch-friendly interaction.
- No hover-dependent functionality.

Clicking a card opens its Drink Details page.

### Empty states

Create helpful empty states when:
- No results match a search.
- No drinks exist in a category.
- No favorite recipes have been saved.

Provide clear actions to return to Explore or reset filters.

---

# 8. DRINK DETAILS PAGE

Every published drink hack must have its own public URL.

Example route:

/drinks/example-drink-slug

### Required information

Display:

1. Finished drink photo
2. Drink name
3. Primary category
4. Total purchase cost
5. Ingredient list
6. Ingredient product photos
7. Product names
8. Ingredient quantities
9. Individual product purchase prices
10. Last price verification date
11. Like button
12. Favorite button
13. Share button
14. QR code

### Explicit exclusions

Do not include:
- Preparation instructions
- Estimated preparation time
- Difficulty level
- Easy, Medium, or Hard labels

The website is intended to be a drink discovery and ingredient-cost reference, not a step-by-step recipe tutorial.

### Ingredient presentation

Each ingredient must display:
- Actual product photo.
- Product name.
- Quantity needed.
- Individual purchase price.

Example:

Product: 7-Eleven bottled coffee  
Quantity: 1 bottle  
Purchase price: ₱XX.XX

Ingredient photos must be clickable.

When clicked:
- Open a larger image viewer or lightbox.
- Allow closing the image.
- Return to the same Drink Details page.
- Support desktop and mobile interactions.

Use actual product packaging photos rather than generic illustrations.

### Total purchase cost calculation

IMPORTANT: Use FULL PRODUCT PURCHASE COST.

Do not calculate the price based on the fraction or amount consumed.

For example, if a drink uses only half a bottle but the visitor needs to buy the entire bottle, charge the full bottle price in the total purchase cost.

Formula:

Total Purchase Cost = Sum of (Product Purchase Price × Number of Units to Purchase)

Store purchase quantity separately from the amount used in the drink when both are known.

Do not treat ½ cup or 2 tablespoons as fractional product purchase quantities.

Never invent prices.

If one or more ingredient prices are missing or unverified:
- Do not display a misleading confirmed total.
- Display a clear price verification status.
- Do not publish an inaccurate purchase cost.

### Price information

Display:
- Total Purchase Cost
- Individual product prices
- Last verified or updated date

Prices must be managed by the administrator.

Do not claim that a product is currently in stock.

---

# 9. FAVORITES

Visitors do not need accounts.

Use browser Local Storage to save Favorites.

Requirements:
- Add to Favorites.
- Remove from Favorites.
- Dedicated Favorites page.
- Persist saved favorites across visits on the same browser.
- Provide an empty state.

Explain that Favorites may not transfer between devices and can be lost when browser data is cleared.

Do not require visitor registration or login.

---

# 10. LIKE SYSTEM

Visitors can like drink hacks without registering.

Requirements:
- Display like counts on drink cards and detail pages.
- Use likes to rank Community Favorites.
- Prevent casual repeated likes from the same browser/device.
- Use a persistent anonymous browser identifier.
- Enforce uniqueness and validation server-side where possible.
- Apply rate limiting and abuse protection.

Do not claim that anonymous browser-based likes guarantee one vote per real person.

Favorites and Likes must remain separate features:

- Favorites are stored locally in the visitor's browser.
- Likes contribute to public recipe popularity.

Do not create comments, ratings, or written reviews.

---

# 11. SHARING AND QR CODES

### Share functionality

Every published drink hack must have:
- Share button.
- Copy Link option.
- Native device sharing where supported.

Support sharing through:
- Facebook
- Messenger
- Other compatible sharing applications

Use the actual public recipe URL.

### QR codes

Generate a unique QR code for each published drink hack.

Requirements:
- QR code points to its public recipe URL.
- Admin can download QR codes.
- Visitors can scan the code to open the recipe.
- Pending and rejected submissions must not receive public QR codes.
- Update or invalidate QR destinations appropriately when a recipe URL changes.

---

# 12. COMMUNITY SUBMISSION FORM

Visitors must be able to submit drink hacks without creating an account.

All submissions must initially be saved as Pending.

They must never become public automatically.

### Required fields

- Drink name
- Primary category
- Ingredients
- Ingredient quantities
- Product selection or new product details
- Submission confirmation

Use only these categories:
- Coffee Mixes
- Chocolate-Based
- Fruity & Soda

### Optional fields

- Submitter name
- Description or taste notes
- Finished drink photo
- Ingredient/product photos
- Ingredient prices, if not already available from the Product Catalog

If no submitter name is provided, display:

Anonymous Creator

### Existing Product Catalog selection

Allow community members to search and select existing products.

When a product is selected:
- Show its product name.
- Show its verified product photo.
- Show its current purchase price.
- Allow quantity selection.

Do not require visitors to upload an existing product photo again.

### New product suggestions

If a product does not exist:
- Allow the visitor to suggest a new product.
- Allow an optional product photo upload.
- Allow an optional product price submission.
- Save the suggestion for admin review.

Community members must never directly modify the Product Catalog.

### Image uploads

Allow optional uploads of:
- Finished drink photos.
- Ingredient/product photos.

Support uploads from mobile and desktop.

Provide:
- Image preview.
- File validation.
- File-size validation.
- Supported image formats.
- Clear upload errors.
- Automatic image optimization where practical.

Use Supabase Storage.

Do not make pending submission images publicly accessible.

Admin must review submitted images before public publication.

### Price handling

Community members may submit recipes even when some prices are missing.

The admin must:
- Review the product.
- Verify its purchase price.
- Update the Product Catalog if necessary.
- Confirm the recipe's total purchase cost.

Do not automatically treat community-provided prices as verified.

### Duplicate detection

Implement automatic duplicate detection.

Check:
- Similar drink names.
- Matching ingredient combinations.
- Similar product selections.

Show a warning if a potentially similar recipe exists.

Do not automatically reject a submission.

Admin makes the final duplicate decision.

### Submission preview

Before submitting:
- Display a complete preview.
- Show selected ingredients.
- Show quantities.
- Show uploaded photos.
- Show available price information.
- Clearly identify missing or unverified prices.

After submission:
- Display a confirmation message.
- Explain that the submission is pending admin approval.

---

# 13. ADMIN AUTHENTICATION AND SECURITY

Only one administrator is required.

The administrator is the website owner.

### Authentication

Use Supabase Auth for the admin account.

Provide:
- Email and password login.
- Email-based password recovery.
- No public admin registration.
- No public admin signup page.

The initial administrator account must be provisioned through a secure setup process.

Never create a publicly accessible admin registration route.

### Email OTP second factor

The required login flow is:

1. Administrator enters email and password.
2. Credentials are verified.
3. A six-digit one-time email code is sent to the registered admin email.
4. Administrator enters the code.
5. The code is validated.
6. Only after successful verification can the administrator access the dashboard.

Security requirements:
- OTP expiration.
- One-time use.
- Resend cooldown.
- Verification attempt limits.
- Server-side validation.
- Rate limiting.
- No plaintext OTP storage.
- No dashboard access before verification.

CRITICAL:

Do not implement a fake frontend-only OTP screen.

Do not claim that two-factor authentication is secure if the administrator already has an unrestricted authenticated session before OTP verification.

Supabase Auth's available authentication and MFA capabilities must be checked against the actual implementation requirements.

If email OTP as a second factor requires a custom secure server-side authentication flow:
- Design it properly using Supabase Edge Functions and secure temporary challenge storage.
- Keep temporary credentials and tokens server-side.
- Use short-lived challenges.
- Prevent replay and session bypass.
- Never expose service-role credentials.
- Do not release an authenticated client session before successful verification.

If the chosen architecture cannot safely implement this requirement, clearly explain the limitation and propose a secure alternative. Do not fake security.

### Login protection

Implement:
- Login rate limiting.
- Temporary lockout after repeated failed attempts.
- OTP rate limiting.
- OTP resend cooldown.
- Security event logging.
- Generic authentication error messages.

Security must be enforced server-side.

### Session management

Use a 30-minute inactivity timeout for admin sessions.

Requirements:
- Reset inactivity timer after valid activity.
- Warn the admin before timeout when possible.
- Expire the session after inactivity.
- Require authentication and OTP verification again.
- Protect all admin routes and operations.
- Prevent expired sessions from executing sensitive operations.

### Database security

Implement Supabase Row Level Security.

Visitors may:
- Read published recipes.
- Read public product information needed for recipe browsing.
- Submit community entries.
- Submit contact reports.
- Register anonymous likes through the controlled backend flow.

Visitors must NOT:
- Read pending submissions from other visitors.
- Read private admin records.
- Edit published recipes.
- Modify verified product prices.
- Approve submissions.
- Access revision history.
- Change website settings.

Admin operations must be protected by verified authorization.

Do not rely on hidden buttons or frontend route guards alone.

---

# 14. ADMIN DASHBOARD

Create a dedicated, protected Admin Dashboard.

Use a clean, professional, functional interface.

Avoid unnecessary animations and decorative elements.

### Dashboard analytics

Display:
- Total Published Drinks
- Pending Submissions
- Total Likes
- Most Popular Drinks
- Recent Submissions
- Recent Activity

Use simple charts and statistic cards.

### Admin modules

Create the following modules:

1. Overview / Analytics
2. Recipe Management
3. Community Submission Approvals
4. Product Catalog
5. Contact Reports
6. QR Code Management
7. Revision History
8. Backup and Data Export
9. Maintenance Mode
10. Admin Settings

### Recipe Management

Admin can:
- Create recipes.
- Edit recipes.
- Save drafts.
- Publish recipes.
- Archive recipes.
- Review published recipes.
- Update drink images.
- Manage ingredients.
- Manage quantities.
- Verify prices.
- Select one primary category.

### Recipe statuses

Use:

- Draft
- Pending
- Published
- Rejected
- Archived

Draft:
Created or edited privately by admin.

Pending:
Community submission awaiting approval.

Published:
Approved and visible publicly.

Rejected:
Submission not approved.

Archived:
Previously published recipe temporarily removed from public listings.

### Community approval workflow

Admin can:
- View pending submissions.
- Review all fields.
- Review photos.
- Review ingredient selections.
- Review product suggestions.
- Verify prices.
- Detect possible duplicates.
- Approve.
- Reject.
- Edit and complete missing information before approval.

Never automatically publish community submissions.

### Published recipe editing

Allow editing without immediately removing the published recipe.

Requirements:
- Existing published version remains accessible during editing.
- Admin can save changes.
- Admin can save changes as a draft for review.
- Incomplete or unverified prices must not silently replace verified prices.

### Revision history

Automatically create revisions when important recipe data changes.

Track:
- Ingredients.
- Quantities.
- Product selections.
- Prices.
- Images.
- Recipe metadata.
- Category.

Display:
- Previous versions.
- Timestamp.
- Changed fields.
- Previous values.
- Current values.

Provide Restore Previous Version.

Restoring a version must create a new revision rather than destroying existing history.

---

# 15. PRODUCT CATALOG

Create a central Product Catalog in the Admin Dashboard.

The catalog stores verified 7-Eleven Philippines products.

### Product fields

- Product name — required.
- Actual product photo — required.
- Purchase price — required.
- Barcode — optional, manual entry.
- Last updated date — automatic.

Do not add product categories.

### Product management

Admin can:
- Add products.
- Edit products.
- Update prices.
- Upload product photos.
- Replace existing photos.
- Archive products.
- Search products.

### Barcode

Support manual barcode entry only.

Requirements:
- Optional field.
- Validate barcode format where appropriate.
- Prevent duplicate barcode values.
- No camera scanning in the initial version.

### Product photos

Use Supabase Storage.

Allow upload from computer or phone.

Provide:
- Preview.
- Replace.
- Remove.
- Image validation.
- Image optimization.

### Product reuse

Recipes must reference Product Catalog records instead of duplicating product information.

When the same product is used in multiple recipes, reuse the same catalog record and verified product photo.

### Price snapshots

IMPORTANT:

A product price update must not silently rewrite historical recipe purchase costs.

Use a snapshot or versioned pricing system.

Each published recipe must retain the price information used when its total purchase cost was verified.

When the Product Catalog price changes:
- Mark affected recipes for price review.
- Do not silently alter previously verified totals.
- Let admin review and update the recipes.
- Record price revisions.

---

# 16. CONTACT PAGE

Create a Contact page where visitors can submit reports and feedback.

### Form fields

- Name — optional.
- Email — optional.
- Report category — required.
- Message — required.

### Report categories

- Incorrect Recipe Information
- Incorrect or Outdated Product Price
- Website Problem
- General Feedback
- Other

### Behavior

- Validate inputs.
- Save reports to Supabase.
- Show submission confirmation.
- Prevent spam and excessive submissions.
- Admin can view and manage reports.

Do not require visitor accounts.

---

# 17. ABOUT PAGE

Create an About 711acks page.

Include:

### Our Story
Explain why 711acks was created.

### Our Concept
A collection of creative drink combinations using 7-Eleven Philippines products.

### Our Purpose
Make drink discovery fun, accessible, and easy to explore.

### Independent Project Disclaimer

Clearly state that 711acks is an independent fan-made project and is not officially affiliated with, sponsored by, or endorsed by 7-Eleven.

Do not misrepresent trademarks, logos, or brand ownership.

---

# 18. DARK MODE AND LIGHT MODE

Implement both Dark Mode and Light Mode.

### Behavior

- Visitors can switch themes.
- Save theme preference in Local Storage.
- First-time visitors may follow system theme preference.
- Admin Dashboard supports both themes.
- Ensure readable text contrast.
- Smooth transitions.
- Respect reduced-motion preferences.

The cinematic dark hero remains the default homepage visual experience.

The rest of the website adapts to the selected theme.

Do not allow theme transitions to interfere with the hero's flashlight effect.

---

# 19. MAINTENANCE MODE

Create an administrator-controlled Maintenance Mode.

When enabled:
- Visitors see a branded maintenance page.
- Public website routes are temporarily unavailable.
- Admin can still access the dashboard.
- Existing database records remain intact.
- Admin can customize the maintenance message.
- Admin can disable maintenance mode.

Use server-side enforcement where appropriate.

Do not rely only on hiding public navigation.

---

# 20. BACKUP AND DATA EXPORT

Create a manual backup and export system.

Include:
- Published recipes.
- Draft recipes.
- Community submissions.
- Product Catalog records.
- Product prices.
- Price snapshots.
- Recipe revision history.
- Categories.
- Contact reports.
- Likes.
- Relevant application settings.

### Backup requirements

- Generate a structured backup.
- Include timestamps.
- Preserve relationships and IDs.
- Provide download functionality.
- Validate backup files before restoration.
- Confirm before destructive restoration.
- Protect backups from unauthorized access.

Images must also be backed up or included through a reliable storage backup process.

A CSV export alone is not sufficient for complete restoration.

Do not claim a backup is complete if uploaded images are excluded.

Provide clear backup and restore instructions.

---

# 21. PERFORMANCE AND ACCESSIBILITY

The website must be optimized for desktop and mobile.

Requirements:
- Responsive design.
- Optimized image delivery.
- Lazy-loaded images where appropriate.
- Avoid unnecessary dependencies.
- Avoid unnecessary network requests.
- Loading states.
- Error states.
- Empty states.
- Form validation.
- Accessible labels.
- Keyboard navigation.
- Appropriate color contrast.
- Reduced-motion support.

Do not sacrifice usability for visual effects.

The hero interaction must not significantly damage page performance.

---

# 22. DATABASE DESIGN

Design a normalized Supabase PostgreSQL schema.

At minimum, consider these entities:

- admin profile / authorization data
- recipes
- recipe ingredients
- products
- product price history
- recipe price snapshots
- community submissions
- submission ingredients
- product suggestions
- recipe revisions
- likes
- contact reports
- website settings
- maintenance settings
- security events
- backup records

Use appropriate:
- Primary keys.
- Foreign keys.
- Unique constraints.
- Indexes.
- Timestamps.
- Status fields.
- RLS policies.

Do not store everything in one large JSON column.

Use relational structures where relationships matter.

For recipe ingredients, preserve:
- Recipe ID.
- Product ID where available.
- Product name snapshot where necessary.
- Quantity information.
- Number of units to purchase.
- Price snapshot.
- Verification status.

Design database migrations in an organized and reproducible way.

Provide SQL migration files.

---

# 23. IMAGE AND FILE MANAGEMENT

Use Supabase Storage.

Separate storage paths or buckets logically for:
- Published drink images.
- Pending community uploads.
- Verified product photos.
- Private admin assets.
- Backup files.

Apply appropriate access policies.

Pending community uploads must not be publicly accessible before approval.

Published public images can use public delivery only when their publication status has been verified.

Validate uploaded files:
- MIME type.
- File size.
- Image dimensions where appropriate.

Use safe filenames and prevent arbitrary file uploads.

Optimize images while preserving quality.

Do not automatically generate or invent real 7-Eleven product packaging.

Finished-drink photos may be AI-generated and uploaded by the administrator, but must accurately represent the published drink.

Community members may also upload their own finished-drink and ingredient photos.

---

# 24. IMPLEMENTATION PROCESS

Build the application in controlled phases.

Do not attempt to create a visually impressive but nonfunctional prototype.

### Phase 1 — Project Foundation
- Initialize React and TypeScript.
- Configure Tailwind CSS.
- Set up routing.
- Establish design tokens.
- Build shared components.
- Configure Supabase.
- Configure environment variables.

### Phase 2 — Public Website UI
- Homepage.
- Hero interactions.
- Navigation.
- Featured sections.
- Explore page.
- Drink Details page.
- Favorites.
- About.
- Contact.

### Phase 3 — Database and Backend
- Create database schema.
- Add migrations.
- Configure RLS.
- Configure Supabase Storage.
- Implement server-side operations.
- Add validation.

### Phase 4 — Community Features
- Submission form.
- Image uploads.
- Product selection.
- Product suggestions.
- Duplicate detection.
- Pending approval flow.
- Likes and Favorites.

### Phase 5 — Admin Dashboard
- Authentication.
- Secure OTP flow.
- Analytics.
- Recipe Management.
- Submission approvals.
- Product Catalog.
- Price management.
- Contact reports.
- Revision history.

### Phase 6 — Advanced Features
- Sharing.
- QR codes.
- Maintenance Mode.
- Backup and restoration.
- Dark Mode and Light Mode.
- Session timeout.

### Phase 7 — Testing and Deployment
- Test all public pages.
- Test admin authorization.
- Test RLS.
- Test image access policies.
- Test recipe calculations.
- Test price snapshots.
- Test submission approvals.
- Test OTP and session expiration.
- Test mobile responsiveness.
- Test deployment environment variables.
- Deploy to Vercel.

---

# 25. IMPORTANT DEVELOPMENT RULES

Follow these instructions throughout development.

1. Do not build a static mockup and call it a completed application.
2. Do not use fake buttons or nonfunctional interactions.
3. Every visible button must perform its intended action.
4. Every form must validate and submit correctly.
5. All database-backed features must use Supabase.
6. Never hardcode sample recipes as production records.
7. Clearly distinguish demo data from verified data.
8. Never invent real 7-Eleven product prices.
9. Never claim product availability.
10. Never expose secrets in frontend code.
11. Enforce authorization through server-side checks and RLS.
12. Do not bypass admin OTP requirements.
13. Do not automatically publish community submissions.
14. Do not allow visitors to modify verified product prices.
15. Do not introduce unapproved product categories.
16. Do not add unnecessary features outside the approved scope.
17. Do not add preparation instructions, preparation time, or difficulty labels.
18. Keep the user experience simple and easy to understand.
19. Preserve the approved Midnight Green visual identity.
20. Test the application before declaring any feature complete.

### Handling incomplete integrations

If a required feature depends on an unavailable service, missing credentials, or unsupported Supabase capability:
- Identify the dependency.
- Explain the limitation.
- Provide the safest compatible solution.
- Do not silently replace it with a fake implementation.
- Do not claim completion until it has been tested.

### Deployment restrictions

Use only the approved stack:
- React
- TypeScript
- Tailwind CSS
- Supabase Free
- Vercel Hobby

Do not activate paid plans or introduce billing requirements.

Warn the project owner before any operation that could require a paid service or exceed the free-tier constraints.

---

# 26. FINAL ACCEPTANCE CRITERIA

The project is considered complete only when:

- Visitors can browse published drink hacks without an account.
- Search, filters, and sorting work.
- The three approved categories work correctly.
- Drink Details pages display accurate ingredients and purchase costs.
- Ingredient product photos can be enlarged.
- Favorites persist locally.
- Likes are stored and counted correctly.
- Recipe sharing works.
- QR codes open the correct recipes.
- Visitors can submit drink hacks without registering.
- Community submissions remain private until approval.
- Admin can verify and manage prices.
- Product Catalog records can be reused.
- Price snapshots preserve historical purchase costs.
- Recipe revision history works.
- Contact reports are saved and manageable.
- Admin authentication and OTP verification are genuinely enforced.
- RLS policies protect private data.
- Maintenance Mode works.
- Backup and restoration are tested.
- Dark Mode and Light Mode work.
- The website is responsive.
- All important buttons and forms work.
- The application deploys successfully to Vercel.

## FINAL INSTRUCTION

Build 711acks as a complete, production-minded personal portfolio application.

Prioritize:
1. Functional correctness.
2. Security.
3. Data accuracy.
4. Excellent visual design.
5. Responsive usability.
6. Maintainable architecture.

Do not sacrifice functionality for a beautiful screenshot.

The finished result should feel like a premium, carefully crafted website with a real working backend—not just an AI-generated frontend demonstration.

Start by establishing the project architecture and implementation plan, then build in phases. Clearly report what has been implemented, what has been tested, what still needs credentials or manual configuration, and what remains incomplete.

Do not claim that the project is finished unless the acceptance criteria have actually been verified.