-- 0003_rls_views_storage.sql — Row Level Security, column grants, public views, storage policies.
-- Principle: deny by default. Every table has RLS enabled. Writes to orders, stock and audit
-- happen ONLY through the SECURITY DEFINER functions in 0002.

alter table public.profiles enable row level security;
alter table public.staff_roles enable row level security;
alter table public.store_settings enable row level security;
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_private enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_units enable row level security;
alter table public.stock_movements enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.audit_logs enable row level security;

-- ---------- profiles: own row only; role is never here ----------
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff('staff')));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------- staff_roles: each user can see own role; no API writes ----------
create policy staff_roles_select_own on public.staff_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff('owner')));

-- ---------- store_settings: public keys readable by anyone; writes by manager+ ----------
create policy settings_public_read on public.store_settings for select to anon, authenticated
  using (is_public or (select public.is_staff('staff')));
create policy settings_manager_insert on public.store_settings for insert to authenticated
  with check ((select public.is_staff('manager')));
create policy settings_manager_update on public.store_settings for update to authenticated
  using ((select public.is_staff('manager'))) with check ((select public.is_staff('manager')));
create policy settings_manager_delete on public.store_settings for delete to authenticated
  using ((select public.is_staff('owner')));

-- ---------- categories / brands ----------
create policy categories_public_read on public.categories for select to anon, authenticated
  using (is_active or (select public.is_staff('staff')));
create policy categories_manager_write on public.categories for all to authenticated
  using ((select public.is_staff('manager'))) with check ((select public.is_staff('manager')));

create policy brands_public_read on public.brands for select to anon, authenticated using (true);
create policy brands_manager_write on public.brands for all to authenticated
  using ((select public.is_staff('manager'))) with check ((select public.is_staff('manager')));

-- ---------- products: public sees only published/unavailable rows in active categories ----------
create policy products_public_read on public.products for select to anon, authenticated
  using (
    (status in ('published', 'unavailable') and (category_id is null or exists (
      select 1 from public.categories c where c.id = products.category_id and c.is_active)))
    or (select public.is_staff('staff'))
  );
create policy products_staff_insert on public.products for insert to authenticated
  with check ((select public.is_staff('staff')));
create policy products_staff_update on public.products for update to authenticated
  using ((select public.is_staff('staff'))) with check ((select public.is_staff('staff')));
create policy products_manager_delete on public.products for delete to authenticated
  using ((select public.is_staff('manager')));  -- fails on FK RESTRICT when order history exists

create policy product_images_public_read on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_images.product_id
                 and p.status in ('published', 'unavailable')) or (select public.is_staff('staff')));
create policy product_images_staff_write on public.product_images for all to authenticated
  using ((select public.is_staff('staff'))) with check ((select public.is_staff('staff')));

create policy product_private_manager on public.product_private for all to authenticated
  using ((select public.is_staff('manager'))) with check ((select public.is_staff('manager')));

-- ---------- inventory: staff read; quantity changes ONLY via adjust_stock (column grants below) ----------
create policy inventory_staff_read on public.inventory for select to authenticated
  using ((select public.is_staff('staff')));
create policy inventory_staff_threshold on public.inventory for update to authenticated
  using ((select public.is_staff('staff'))) with check ((select public.is_staff('staff')));

-- ---------- unit inventory: manager+ only (cost and serial are sensitive) ----------
create policy units_manager_read on public.inventory_units for select to authenticated
  using ((select public.is_staff('manager')));
create policy units_manager_insert on public.inventory_units for insert to authenticated
  with check ((select public.is_staff('manager')) and status = 'available');
create policy units_manager_update on public.inventory_units for update to authenticated
  using ((select public.is_staff('manager')) and status <> 'sold')
  with check ((select public.is_staff('manager')) and status <> 'sold');

create policy stock_movements_staff_read on public.stock_movements for select to authenticated
  using ((select public.is_staff('staff')));

-- ---------- orders: customers read their own; staff read all; NO direct writes ----------
create policy orders_customer_read on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff('staff')));

create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id
                 and (o.user_id = (select auth.uid()) or (select public.is_staff('staff')))));

create policy order_history_read on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_status_history.order_id
                 and (o.user_id = (select auth.uid()) or (select public.is_staff('staff')))));

-- ---------- coupons: manager+ only. Customers validate via place_order. ----------
create policy coupons_manager_all on public.coupons for all to authenticated
  using ((select public.is_staff('manager'))) with check ((select public.is_staff('manager')));
create policy coupon_redemptions_manager_read on public.coupon_redemptions for select to authenticated
  using ((select public.is_staff('manager')));

-- ---------- audit: owner/manager read; writes only by triggers ----------
create policy audit_manager_read on public.audit_logs for select to authenticated
  using ((select public.is_staff('manager')));

-- ==========================================================================
-- Column-level and table-level grants (defence in depth beyond RLS)
-- ==========================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.store_settings, public.categories, public.brands, public.products,
  public.product_images to anon, authenticated;
grant insert, update, delete on public.store_settings, public.categories, public.brands,
  public.products, public.product_images to authenticated;
grant select, update (full_name, phone) on public.profiles to authenticated;
grant select on public.staff_roles to authenticated;
grant select, insert, update, delete on public.product_private to authenticated;
grant select on public.inventory to authenticated;
grant update (low_stock_threshold) on public.inventory to authenticated;
grant select, insert, update on public.inventory_units to authenticated;
grant select on public.stock_movements to authenticated;
grant select on public.orders, public.order_items, public.order_status_history to authenticated;
grant select, insert, update, delete on public.coupons to authenticated;
grant select on public.coupon_redemptions, public.audit_logs to authenticated;

-- ==========================================================================
-- Public storefront views: explicit column allow-lists.
-- They run with the owner's rights, so they are the ONLY public read path for
-- derived data (effective price, stock state). They omit cost, serials, exact
-- quantities, and internal references. Do not add sensitive columns here.
-- ==========================================================================
create or replace view public.storefront_products as
select
  p.id, p.slug, p.sku, p.model_number, p.brand_id, b.name as brand_name,
  p.category_id, c.slug as category_slug, c.name_en as category_name_en, c.name_ar as category_name_ar,
  p.title_en, p.title_ar, p.description_en, p.description_ar,
  p.condition, p.price, p.sale_price, p.currency,
  p.warranty_text_en, p.warranty_text_ar, p.track_mode, p.status, p.is_featured, p.specs, p.created_at,
  case when p.track_mode = 'unit'
    then coalesce((select min(u.selling_price) from public.inventory_units u
                   where u.product_id = p.id and u.status = 'available'), p.price)
    else coalesce(p.sale_price, p.price)
  end as effective_price,
  case
    when p.status <> 'published' then 'out_of_stock'
    when p.track_mode = 'unit' then
      case when exists (select 1 from public.inventory_units u where u.product_id = p.id and u.status = 'available')
           then 'in_stock' else 'out_of_stock' end
    when coalesce(i.quantity_on_hand, 0) = 0 then 'out_of_stock'
    when coalesce(i.quantity_on_hand, 0) <= coalesce(i.low_stock_threshold, 0) then 'low_stock'
    else 'in_stock'
  end as stock_state
from public.products p
left join public.brands b on b.id = p.brand_id
left join public.categories c on c.id = p.category_id
left join public.inventory i on i.product_id = p.id
where p.status in ('published', 'unavailable')
  and (p.category_id is null or c.is_active);

create or replace view public.storefront_units as
select u.id, u.product_id, u.condition_grade, u.cosmetic_notes_en, u.cosmetic_notes_ar,
       u.battery_health_pct, u.included_accessories, u.warranty_text, u.selling_price
from public.inventory_units u
join public.products p on p.id = u.product_id
where u.status = 'available' and p.status = 'published';

grant select on public.storefront_products, public.storefront_units to anon, authenticated;

-- ==========================================================================
-- Storage: public read for product images; staff-only writes; size/MIME limits.
-- ==========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "product images: public read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');
create policy "product images: staff insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_staff('staff')));
create policy "product images: staff update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_staff('staff')))
  with check (bucket_id = 'product-images' and (select public.is_staff('staff')));
create policy "product images: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_staff('manager')));
