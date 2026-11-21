-- =============================================================================
-- 711ACKS — SUPABASE POSTGRESQL SCHEMA, RLS POLICIES & STORAGE ARCHITECTURE
-- Independent Fan-Made 7-Eleven Philippines Drink Combination Archive
-- =============================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- 1. ENUMS & DOMAINS
do $$ begin
  create type drink_category as enum ('Coffee Mixes', 'Chocolate-Based', 'Fruity & Soda');
exception when duplicate_object then null; end $$;

do $$ begin
  create type recipe_status as enum ('Draft', 'Pending', 'Published', 'Rejected', 'Archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_category as enum (
    'Incorrect Recipe Information',
    'Incorrect or Outdated Product Price',
    'Website Problem',
    'General Feedback',
    'Other'
  );
exception when duplicate_object then null; end $$;

-- 2. ADMIN PROFILE & AUTHORIZATION DATA
create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  role text not null default 'owner' check (role = 'owner'),
  otp_verified_until timestamptz,
  last_active_at timestamptz default now(),
  failed_login_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

-- Server-side only OTP challenges (no plaintext OTP storage; SHA-256 hash)
create table if not exists public.admin_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_profiles(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  attempt_count int not null default 0,
  max_attempts int not null default 5,
  resend_available_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- 3. CENTRAL PRODUCT CATALOG (7-ELEVEN PHILIPPINES PRODUCTS)
-- Note: Do NOT add product categories per specification Section 15.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  photo_url text not null,
  purchase_price numeric(10, 2) not null check (purchase_price >= 0),
  barcode text unique,
  is_archived boolean not null default false,
  last_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_products_name on public.products using btree (name);

-- 4. PRODUCT PRICE HISTORY
create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  previous_price numeric(10, 2) not null,
  new_price numeric(10, 2) not null,
  changed_by uuid references public.admin_profiles(id),
  changed_at timestamptz not null default now()
);

-- 5. RECIPES
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  category drink_category not null,
  status recipe_status not null default 'Draft',
  photo_url text not null,
  submitter_name text not null default 'Anonymous Creator',
  taste_notes text,
  total_purchase_cost numeric(10, 2) check (total_purchase_cost >= 0),
  price_verified boolean not null default false,
  needs_price_review boolean not null default false,
  last_price_verified_at timestamptz,
  is_editors_pick boolean not null default false,
  is_trending boolean not null default false,
  likes_count int not null default 0 check (likes_count >= 0),
  pending_draft_json jsonb, -- Allows editing published recipe without removing public version
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recipes_status_category on public.recipes(status, category);
create index if not exists idx_recipes_slug on public.recipes(slug);

-- 6. RECIPE INGREDIENTS (WITH FULL PRODUCT PURCHASE COST SNAPSHOTS)
-- Total Purchase Cost = Sum of (price_snapshot * units_to_purchase)
create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null,
  product_photo_snapshot text not null,
  quantity_used text not null, -- e.g. '1 bottle (240ml)' or 'Half pack (pour over ice)'
  units_to_purchase int not null default 1 check (units_to_purchase >= 1),
  price_snapshot numeric(10, 2) check (price_snapshot >= 0),
  price_verified boolean not null default false,
  sort_order int not null default 0
);

create index if not exists idx_recipe_ingredients_recipe on public.recipe_ingredients(recipe_id);
create index if not exists idx_recipe_ingredients_product on public.recipe_ingredients(product_id);

-- 7. RECIPE PRICE SNAPSHOTS (HISTORICAL VERIFIED TOTALS)
create table if not exists public.recipe_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  total_purchase_cost numeric(10, 2) not null,
  ingredient_breakdown jsonb not null,
  verified_by uuid references public.admin_profiles(id),
  verified_at timestamptz not null default now()
);

-- 8. COMMUNITY SUBMISSIONS & PRODUCT SUGGESTIONS
create table if not exists public.community_submissions (
  id uuid primary key default gen_random_uuid(),
  drink_name text not null,
  category drink_category not null,
  submitter_name text not null default 'Anonymous Creator',
  taste_notes text,
  finished_photo_storage_path text, -- Private storage bucket path until approved
  status recipe_status not null default 'Pending' check (status in ('Pending', 'Published', 'Rejected')),
  duplicate_warning_notes text,
  admin_review_notes text,
  approved_recipe_id uuid references public.recipes(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.submission_ingredients (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.community_submissions(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  suggested_product_name text,
  suggested_product_price numeric(10, 2),
  suggested_product_photo_path text,
  quantity_used text not null,
  units_to_purchase int not null default 1 check (units_to_purchase >= 1)
);

create table if not exists public.product_suggestions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.community_submissions(id) on delete cascade,
  suggested_name text not null,
  suggested_price numeric(10, 2),
  photo_storage_path text,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  approved_product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 9. RECIPE REVISIONS (VERSION CONTROL & NON-DESTRUCTIVE RESTORATION)
create table if not exists public.recipe_revisions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  version_number int not null,
  changed_fields text[] not null,
  previous_values jsonb not null,
  new_values jsonb not null,
  change_summary text not null,
  restored_from_revision_id uuid references public.recipe_revisions(id),
  created_by text not null default 'Admin',
  created_at timestamptz not null default now()
);

-- 10. ANONYMOUS LIKES (WITH UNIQUE BROWSER FINGERPRINT CONSTRAINT)
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  anonymous_browser_id text not null,
  created_at timestamptz not null default now(),
  unique (recipe_id, anonymous_browser_id)
);

-- 11. CONTACT REPORTS
create table if not exists public.contact_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_name text,
  reporter_email text,
  category report_category not null,
  message text not null check (char_length(message) >= 10),
  related_recipe_slug text,
  status text not null default 'Open' check (status in ('Open', 'In Review', 'Resolved', 'Archived')),
  admin_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- 12. WEBSITE & MAINTENANCE SETTINGS
create table if not exists public.website_settings (
  id int primary key default 1 check (id = 1),
  maintenance_mode boolean not null default false,
  maintenance_title text not null default 'Scheduled Inventory & Price Verification',
  maintenance_message text not null default '711acks is currently updating verified 7-Eleven Philippines product prices and drink combinations. Please check back shortly.',
  session_timeout_minutes int not null default 30,
  require_admin_otp boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 13. SECURITY EVENTS & BACKUP RECORDS
create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor text not null,
  details text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.backup_records (
  id uuid primary key default gen_random_uuid(),
  backup_filename text not null,
  record_counts jsonb not null,
  includes_storage_manifest boolean not null default true,
  checksum text not null,
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now()
);

-- =============================================================================
-- TRIGGER: WHEN PRODUCT CATALOG PRICE CHANGES, FLAG AFFECTED RECIPES FOR REVIEW
-- Important: Never silently alter previously verified recipe purchase totals!
-- =============================================================================
create or replace function public.handle_product_price_change()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.purchase_price is distinct from old.purchase_price then
    insert into public.product_price_history (product_id, previous_price, new_price)
    values (new.id, old.purchase_price, new.purchase_price);

    update public.recipes
    set needs_price_review = true,
        updated_at = now()
    where id in (
      select distinct recipe_id
      from public.recipe_ingredients
      where product_id = new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_product_price_change on public.products;
create trigger trg_product_price_change
after update of purchase_price on public.products
for each row execute function public.handle_product_price_change();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================
alter table public.admin_profiles enable row level security;
alter table public.admin_otp_challenges enable row level security;
alter table public.products enable row level security;
alter table public.product_price_history enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_price_snapshots enable row level security;
alter table public.community_submissions enable row level security;
alter table public.submission_ingredients enable row level security;
alter table public.product_suggestions enable row level security;
alter table public.recipe_revisions enable row level security;
alter table public.likes enable row level security;
alter table public.contact_reports enable row level security;
alter table public.website_settings enable row level security;
alter table public.security_events enable row level security;
alter table public.backup_records enable row level security;

-- Helper function: verify authenticated admin with active OTP second factor
create or replace function public.is_verified_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.admin_profiles
    where id = auth.uid()
      and role = 'owner'
      and otp_verified_until is not null
      and otp_verified_until > now()
      and (last_active_at is null or last_active_at > now() - interval '30 minutes')
  );
$$;

-- Visitors may read published recipes and their ingredients
create policy "Public can read published recipes"
  on public.recipes for select
  using (status = 'Published' or public.is_verified_admin());

create policy "Admin full control on recipes"
  on public.recipes for all
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

create policy "Public can read published recipe ingredients"
  on public.recipe_ingredients for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id
        and (r.status = 'Published' or public.is_verified_admin())
    )
  );

create policy "Admin full control on recipe ingredients"
  on public.recipe_ingredients for all
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

-- Visitors may read non-archived product catalog items
create policy "Public can read active products"
  on public.products for select
  using (is_archived = false or public.is_verified_admin());

create policy "Admin full control on products"
  on public.products for all
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

-- Visitors may submit community entries (Pending only) but NEVER read pending submissions
create policy "Public can insert pending community submissions"
  on public.community_submissions for insert
  with check (status = 'Pending');

create policy "Only verified admin can read or manage community submissions"
  on public.community_submissions for all
  using (public.is_verified_admin())
  with check (public.is_verified_admin());

create policy "Public can insert submission ingredients"
  on public.submission_ingredients for insert
  with check (true);

create policy "Only verified admin can read submission ingredients"
  on public.submission_ingredients for select
  using (public.is_verified_admin());

create policy "Public can insert product suggestions"
  on public.product_suggestions for insert
  with check (status = 'Pending');

create policy "Only verified admin can manage product suggestions"
  on public.product_suggestions for all
  using (public.is_verified_admin());

-- Visitors may submit contact reports
create policy "Public can submit contact reports"
  on public.contact_reports for insert
  with check (status = 'Open');

create policy "Only verified admin can read and manage contact reports"
  on public.contact_reports for all
  using (public.is_verified_admin());

-- Visitors can read likes and register anonymous likes
create policy "Public can read likes"
  on public.likes for select
  using (true);

create policy "Public can insert anonymous likes"
  on public.likes for insert
  with check (char_length(anonymous_browser_id) >= 12);

-- Website settings: Public can read maintenance status; only admin can modify
create policy "Public can read website settings"
  on public.website_settings for select
  using (true);

create policy "Only verified admin can update website settings"
  on public.website_settings for update
  using (public.is_verified_admin());

-- Admin-only tables (revisions, price history, security events, backups)
create policy "Admin only recipe revisions"
  on public.recipe_revisions for all
  using (public.is_verified_admin());

create policy "Admin only price history"
  on public.product_price_history for all
  using (public.is_verified_admin());

create policy "Admin only price snapshots"
  on public.recipe_price_snapshots for all
  using (public.is_verified_admin());

create policy "Admin only security events"
  on public.security_events for all
  using (public.is_verified_admin());

create policy "Admin only backup records"
  on public.backup_records for all
  using (public.is_verified_admin());

-- =============================================================================
-- SUPABASE STORAGE BUCKET SEPARATION & ACCESS POLICIES
-- =============================================================================
-- Logical storage buckets:
-- 1. published-drinks (public read, admin write)
-- 2. verified-products (public read, admin write)
-- 3. pending-submissions (PRIVATE: public insert with validation, admin read/delete)
-- 4. private-admin-backups (PRIVATE: admin read/write only)
