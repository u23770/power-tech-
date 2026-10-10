-- 0001_schema.sql — POWER TECH core schema (Supabase / PostgreSQL)
-- Apply to an EMPTY project. Money uses numeric(12,2). Never float.

-- ---------- Helper: updated_at ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Customer profiles (1:1 with auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 2 and 120),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.set_updated_at();

-- Creates a profile row for every new auth user. Role is NEVER taken from metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(left(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), 120), ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Staff roles (managed only from SQL editor / owner runbook) ----------
create table public.staff_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now()
);

-- Role check used by RLS and trusted functions. Only reads staff_roles.
create or replace function public.is_staff(p_min_role text default 'staff')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_roles r
    where r.user_id = (select auth.uid())
      and case p_min_role
            when 'owner' then r.role = 'owner'
            when 'manager' then r.role in ('owner', 'manager')
            else r.role in ('owner', 'manager', 'staff')
          end
  );
$$;

-- ---------- Store settings (key/value, validated by trigger in 0002) ----------
create table public.store_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------- Catalog ----------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name_en text not null check (char_length(name_en) between 1 and 120),
  name_ar text check (name_ar is null or char_length(name_ar) <= 120),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,120}$'),
  sku text unique check (sku is null or char_length(sku) between 2 and 64),
  model_number text check (model_number is null or char_length(model_number) <= 80),
  brand_id uuid references public.brands (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  title_en text not null check (char_length(title_en) between 2 and 200),
  title_ar text check (title_ar is null or char_length(title_ar) <= 200),
  description_en text check (description_en is null or char_length(description_en) <= 5000),
  description_ar text check (description_ar is null or char_length(description_ar) <= 5000),
  condition text not null default 'new' check (condition in ('new', 'used', 'refurbished')),
  price numeric(12,2) not null check (price >= 0),
  sale_price numeric(12,2) check (sale_price is null or (sale_price >= 0 and sale_price < price)),
  currency char(3) not null default 'EGP' check (currency ~ '^[A-Z]{3}$'),
  warranty_text_en text check (warranty_text_en is null or char_length(warranty_text_en) <= 500),
  warranty_text_ar text check (warranty_text_ar is null or char_length(warranty_text_ar) <= 500),
  track_mode text not null default 'quantity' check (track_mode in ('quantity', 'unit')),
  status text not null default 'draft' check (status in ('draft', 'published', 'unavailable', 'archived')),
  is_featured boolean not null default false,
  specs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_status_idx on public.products (status);
create index products_category_idx on public.products (category_id);
create index products_brand_idx on public.products (brand_id);
create index products_created_idx on public.products (created_at desc);
create index products_specs_gin on public.products using gin (specs jsonb_path_ops);
create trigger products_touch before update on public.products
  for each row execute function public.set_updated_at();

-- Flexible but bounded specs: flat object, snake_case keys, scalar values.
create or replace function public.specs_valid(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and pg_column_size(p) < 20000
    and not exists (
      select 1 from jsonb_each(p) e
      where e.key !~ '^[a-z][a-z0-9_]{1,40}$'
         or jsonb_typeof(e.value) not in ('string', 'number', 'boolean')
         or (jsonb_typeof(e.value) = 'string' and char_length(e.value #>> '{}') > 300)
    );
$$;
alter table public.products add constraint products_specs_check check (public.specs_valid(specs));

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null check (char_length(storage_path) between 3 and 300),
  alt_en text check (alt_en is null or char_length(alt_en) <= 200),
  alt_ar text check (alt_ar is null or char_length(alt_ar) <= 200),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, sort_order);

-- Private commercial data (cost). Readable by owner/manager only (RLS in 0003).
create table public.product_private (
  product_id uuid primary key references public.products (id) on delete cascade,
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  updated_at timestamptz not null default now()
);

-- ---------- Inventory ----------
-- Quantity-tracked stock (one row per quantity-mode product).
create table public.inventory (
  product_id uuid primary key references public.products (id) on delete cascade,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  updated_at timestamptz not null default now()
);
create trigger inventory_touch before update on public.inventory
  for each row execute function public.set_updated_at();

-- Individually tracked physical units (used/refurbished). Serial/cost are private.
create table public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  internal_ref text not null unique check (char_length(internal_ref) between 3 and 60),
  serial_number text unique check (serial_number is null or char_length(serial_number) between 3 and 80),
  condition_grade text check (condition_grade is null or condition_grade in ('A', 'B', 'C', 'D')),
  cosmetic_notes_en text check (cosmetic_notes_en is null or char_length(cosmetic_notes_en) <= 1000),
  cosmetic_notes_ar text check (cosmetic_notes_ar is null or char_length(cosmetic_notes_ar) <= 1000),
  battery_health_pct integer check (battery_health_pct is null or battery_health_pct between 0 and 100),
  included_accessories text check (included_accessories is null or char_length(included_accessories) <= 500),
  warranty_text text check (warranty_text is null or char_length(warranty_text) <= 500),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  selling_price numeric(12,2) not null check (selling_price >= 0),
  status text not null default 'available' check (status in ('available', 'sold', 'withdrawn')),
  sold_order_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inventory_units_product_status_idx on public.inventory_units (product_id, status);
create trigger inventory_units_touch before update on public.inventory_units
  for each row execute function public.set_updated_at();

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  unit_id uuid references public.inventory_units (id) on delete restrict,
  delta integer not null check (delta <> 0),
  reason text not null check (char_length(reason) between 3 and 200),
  order_id uuid,  -- FK to orders added below, after orders exists
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

-- ---------- Orders ----------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^PT-[0-9]{6}-[A-Z0-9]{6}$'),
  user_id uuid references auth.users (id) on delete set null,
  idempotency_key uuid not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'processing', 'ready', 'completed', 'cancelled')),
  fulfillment text not null check (fulfillment in ('delivery', 'pickup')),
  payment_method text not null check (payment_method in ('cod', 'pay_at_store')),
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  customer_phone text not null check (customer_phone ~ '^\+?[0-9 ()-]{6,20}$'),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),
  governorate text not null check (char_length(governorate) between 2 and 80),
  city text not null check (char_length(city) between 2 and 80),
  area text check (area is null or char_length(area) <= 80),
  address text not null check (char_length(address) between 5 and 300),
  location_url text check (location_url is null or (char_length(location_url) <= 500 and location_url ~* '^https://')),
  notes text check (notes is null or char_length(notes) <= 500),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0 and discount_total <= subtotal),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  total numeric(12,2) not null check (total >= 0),
  coupon_code text,
  tracking_token_hash text not null check (char_length(tracking_token_hash) = 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches check (total = subtotal - discount_total + delivery_fee)
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status, created_at desc);
create trigger orders_touch before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.stock_movements
  add constraint stock_movements_order_fk foreign key (order_id) references public.orders (id) on delete set null;

-- Immutable purchase snapshot. product_id is RESTRICT so history blocks hard deletes.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete restrict,
  unit_id uuid references public.inventory_units (id) on delete restrict,
  title_snapshot text not null check (char_length(title_snapshot) between 1 and 200),
  title_ar_snapshot text check (title_ar_snapshot is null or char_length(title_ar_snapshot) <= 200),
  sku_snapshot text,
  model_snapshot text,
  condition_snapshot text not null check (condition_snapshot in ('new', 'used', 'refurbished')),
  quantity integer not null check (quantity between 1 and 100),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_line_matches check (line_total = unit_price * quantity - discount_amount)
);
create index order_items_order_idx on public.order_items (order_id);

alter table public.inventory_units
  add constraint inventory_units_sold_item_fk foreign key (sold_order_item_id)
  references public.order_items (id) on delete restrict;

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('pending', 'confirmed', 'processing', 'ready', 'completed', 'cancelled')),
  actor_id uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

-- ---------- Coupons ----------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  kind text not null check (kind in ('percent', 'fixed')),
  value numeric(12,2) not null check (value > 0),
  min_subtotal numeric(12,2) not null default 0 check (min_subtotal >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemptions_count integer not null default 0 check (redemptions_count >= 0),
  first_order_only boolean not null default false,
  applies_to_sale_items boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_percent_range check (kind <> 'percent' or value <= 100),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create trigger coupons_touch before update on public.coupons
  for each row execute function public.set_updated_at();

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete restrict,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Audit ----------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  entity text not null check (char_length(entity) between 1 and 80),
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------- Optional: genuine reviews are NOT created in this core build ----------
-- (Intentionally omitted until real review collection and moderation are designed.)
