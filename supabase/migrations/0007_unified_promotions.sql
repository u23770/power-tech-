-- POWER TECH unified promotions: coupon codes and automatic discounts share one manager.
-- Existing coupon codes retain their behavior; old sale_price fields continue to work.

alter table public.coupons alter column code drop not null;
alter table public.coupons add column if not exists name text;
alter table public.coupons add column if not exists promotion_type text not null default 'coupon';
alter table public.coupons add column if not exists scope text not null default 'all';
alter table public.coupons add column if not exists target_product_id uuid references public.products(id) on delete restrict;
alter table public.coupons add column if not exists target_category_id uuid references public.categories(id) on delete restrict;
alter table public.coupons add column if not exists max_discount numeric(12,2);
alter table public.coupons add column if not exists max_uses_per_customer integer;
alter table public.coupons add column if not exists priority integer not null default 0;

update public.coupons set name = code where name is null or btrim(name) = '';
alter table public.coupons alter column name set not null;
alter table public.coupons alter column name set default 'Discount';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_promotion_type_check' and conrelid = 'public.coupons'::regclass) then
    alter table public.coupons add constraint coupons_promotion_type_check
      check (promotion_type in ('coupon', 'automatic', 'signup'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_code_by_type_check' and conrelid = 'public.coupons'::regclass) then
    alter table public.coupons add constraint coupons_code_by_type_check
      check ((promotion_type = 'coupon' and code is not null) or (promotion_type in ('automatic', 'signup') and code is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_scope_target_check' and conrelid = 'public.coupons'::regclass) then
    alter table public.coupons add constraint coupons_scope_target_check
      check (
        (scope = 'all' and target_product_id is null and target_category_id is null)
        or (scope = 'product' and target_product_id is not null and target_category_id is null)
        or (scope = 'category' and target_category_id is not null and target_product_id is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_signup_scope_check' and conrelid = 'public.coupons'::regclass) then
    alter table public.coupons add constraint coupons_signup_scope_check
      check (promotion_type <> 'signup' or scope = 'all');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_max_discount_check' and conrelid = 'public.coupons'::regclass) then
    alter table public.coupons add constraint coupons_max_discount_check
      check (max_discount is null or max_discount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_max_uses_per_customer_check' and conrelid = 'public.coupons'::regclass) then
    alter table public.coupons add constraint coupons_max_uses_per_customer_check
      check (max_uses_per_customer is null or max_uses_per_customer > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_priority_check' and conrelid = 'public.coupons'::regclass) then
    alter table public.coupons add constraint coupons_priority_check
      check (priority between -1000 and 1000);
  end if;
end $$;

create index if not exists coupons_promotion_active_idx
  on public.coupons (promotion_type, is_active, priority desc, starts_at, ends_at);
create index if not exists coupons_target_product_idx on public.coupons (target_product_id) where target_product_id is not null;
create index if not exists coupons_target_category_idx on public.coupons (target_category_id) where target_category_id is not null;

create or replace function public.place_order(
  p_items jsonb,
  p_customer jsonb,
  p_fulfillment text,
  p_payment_method text,
  p_coupon_code text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.orders%rowtype;
  v_setting jsonb;
  v_currency text := 'EGP';
  v_max_qty integer := 10;
  v_item jsonb;
  v_line jsonb;
  v_new_lines jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_product public.products%rowtype;
  v_unit_id uuid;
  v_unit_price numeric(12,2);
  v_is_sale boolean;
  v_qty integer;
  v_line_sub numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_coupon public.coupons%rowtype;
  v_sale_ok boolean := false;
  v_eligible_base numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_line_disc numeric(12,2);
  v_fee numeric(12,2) := 0;
  v_total numeric(12,2);
  v_order_id uuid;
  v_item_id uuid;
  v_reference text;
  v_token text;
  v_n integer;
  v_i integer;
  v_email text;
  v_candidate public.coupons%rowtype;
  v_candidate_base numeric(12,2) := 0;
  v_candidate_discount numeric(12,2) := 0;
  v_best_discount numeric(12,2) := 0;
  v_discount_target numeric(12,2) := 0;
  v_customer_uses integer := 0;
begin
  -- 1. Idempotency: repeated submissions return the same order, never a second one.
  if p_idempotency_key is null then raise exception 'idempotency_key_required'; end if;
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id is distinct from v_uid then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('duplicate', true, 'order_id', v_existing.id, 'reference', v_existing.reference,
      'status', v_existing.status, 'total', v_existing.total, 'currency', v_existing.currency);
  end if;

  -- 2. Store configuration.
  select value into v_setting from public.store_settings where key = 'guest_checkout';
  if v_uid is null and coalesce((v_setting->>'enabled')::boolean, false) is false then
    raise exception 'login_required';
  end if;

  select value into v_setting from public.store_settings where key = 'checkout_options';
  if p_fulfillment not in ('delivery', 'pickup') or coalesce((v_setting->>p_fulfillment)::boolean, false) is false then
    raise exception 'fulfillment_not_available';
  end if;
  if p_payment_method not in ('cod', 'pay_at_store') or coalesce((v_setting->>p_payment_method)::boolean, false) is false then
    raise exception 'payment_not_available';
  end if;

  select coalesce(value->>'code', 'EGP') into v_currency from public.store_settings where key = 'currency';
  select coalesce((value #>> '{}')::integer, 10) into v_max_qty from public.store_settings where key = 'max_qty_per_line';

  -- 3. Customer input validation (server side; the browser check is only UX).
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then raise exception 'invalid_customer'; end if;
  if char_length(btrim(coalesce(p_customer->>'name', ''))) not between 2 and 120 then raise exception 'invalid_name'; end if;
  if btrim(coalesce(p_customer->>'phone', '')) !~ '^\+?[0-9 ()-]{6,20}$' then raise exception 'invalid_phone'; end if;
  v_email := btrim(coalesce(p_customer->>'email', ''));
  if v_email <> '' and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'invalid_email';
  end if;
  if char_length(btrim(coalesce(p_customer->>'governorate', ''))) not between 2 and 80 then raise exception 'invalid_governorate'; end if;
  if char_length(btrim(coalesce(p_customer->>'city', ''))) not between 2 and 80 then raise exception 'invalid_city'; end if;
  if char_length(btrim(coalesce(p_customer->>'area', ''))) > 80 then raise exception 'invalid_area'; end if;
  if char_length(btrim(coalesce(p_customer->>'address', ''))) not between 5 and 300 then raise exception 'invalid_address'; end if;
  if char_length(coalesce(p_customer->>'notes', '')) > 500 then raise exception 'invalid_notes'; end if;
  if btrim(coalesce(p_customer->>'location_url', '')) <> ''
     and (char_length(p_customer->>'location_url') > 500 or p_customer->>'location_url' !~* '^https://') then
    raise exception 'invalid_location_url';
  end if;

  -- 4. Items: lock and allocate stock atomically, snapshot prices from the database.
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'invalid_items';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_items';
    end if;
    if coalesce(v_item->>'quantity', '') !~ '^[0-9]{1,3}$' then raise exception 'quantity_limit'; end if;
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 or v_qty > v_max_qty then raise exception 'quantity_limit'; end if;

    v_unit_id := null;
    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and status = 'published';
    if not found then raise exception 'product_unavailable'; end if;
    if v_product.category_id is not null and not exists (
      select 1 from public.categories c where c.id = v_product.category_id and c.is_active
    ) then
      raise exception 'product_unavailable';
    end if;

    if v_product.track_mode = 'unit' then
      if v_qty <> 1 then raise exception 'quantity_limit'; end if;
      if coalesce(v_item->>'unit_id', '') <> '' then
        select id, selling_price into v_unit_id, v_unit_price from public.inventory_units
          where id = (v_item->>'unit_id')::uuid and product_id = v_product.id and status = 'available'
          for update skip locked;
      else
        select id, selling_price into v_unit_id, v_unit_price from public.inventory_units
          where product_id = v_product.id and status = 'available'
          order by created_at limit 1 for update skip locked;
      end if;
      if v_unit_id is null then raise exception 'out_of_stock'; end if;
      -- Each physical unit can be sold once: status flips inside this transaction.
      update public.inventory_units set status = 'sold' where id = v_unit_id;
      v_is_sale := false;
    else
      update public.inventory
        set quantity_on_hand = quantity_on_hand - v_qty
        where product_id = v_product.id and quantity_on_hand >= v_qty;
      if not found then raise exception 'out_of_stock'; end if;
      v_is_sale := v_product.sale_price is not null;
      v_unit_price := coalesce(v_product.sale_price, v_product.price);
    end if;

    v_line_sub := v_unit_price * v_qty;
    v_subtotal := v_subtotal + v_line_sub;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'category_id', v_product.category_id,
      'unit_id', v_unit_id,
      'title', v_product.title_en,
      'title_ar', v_product.title_ar,
      'sku', v_product.sku,
      'model', v_product.model_number,
      'condition', v_product.condition,
      'quantity', v_qty,
      'unit_price', v_unit_price,
      'line_sub', v_line_sub,
      'is_sale', v_is_sale,
      'discount', 0
    ));
  end loop;

  -- 5. Resolve either a coupon code or the best applicable automatic promotion.
  -- Promotions are selected and priced on the server. The browser never supplies a price or discount.
  if coalesce(btrim(p_coupon_code), '') <> '' then
    select * into v_coupon from public.coupons
      where promotion_type = 'coupon'
        and code = upper(btrim(p_coupon_code)) and is_active
        and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at > now())
      for update;
    if not found then raise exception 'coupon_invalid'; end if;
    if v_subtotal < v_coupon.min_subtotal then raise exception 'coupon_min_subtotal'; end if;
    if v_coupon.max_redemptions is not null and v_coupon.redemptions_count >= v_coupon.max_redemptions then
      raise exception 'coupon_exhausted';
    end if;
    if v_coupon.first_order_only and (v_uid is null or exists (
      select 1 from public.orders o where o.user_id = v_uid and o.status <> 'cancelled'
    )) then
      raise exception 'coupon_first_order_only';
    end if;
    if v_coupon.max_uses_per_customer is not null then
      if v_uid is null then raise exception 'coupon_login_required'; end if;
      select count(*) into v_customer_uses from public.coupon_redemptions r
        where r.coupon_id = v_coupon.id and r.user_id = v_uid;
      if v_customer_uses >= v_coupon.max_uses_per_customer then
        raise exception 'coupon_user_limit';
      end if;
    end if;
  else
    -- One automatic offer is applied per order (best saving wins; priority breaks ties).
    for v_candidate in
      select c.* from public.coupons c
      where c.promotion_type in ('automatic', 'signup')
        and c.is_active
        and (c.starts_at is null or c.starts_at <= now())
        and (c.ends_at is null or c.ends_at > now())
        and (c.max_redemptions is null or c.redemptions_count < c.max_redemptions)
      order by c.priority desc, c.created_at desc
      for update
    loop
      if v_subtotal < v_candidate.min_subtotal then continue; end if;

      if (v_candidate.first_order_only or v_candidate.promotion_type = 'signup')
         and (v_uid is null or exists (
           select 1 from public.orders o where o.user_id = v_uid and o.status <> 'cancelled'
         )) then
        continue;
      end if;

      if v_candidate.max_uses_per_customer is not null then
        if v_uid is null then continue; end if;
        select count(*) into v_customer_uses from public.coupon_redemptions r
          where r.coupon_id = v_candidate.id and r.user_id = v_uid;
        if v_customer_uses >= v_candidate.max_uses_per_customer then continue; end if;
      end if;

      select coalesce(sum((l->>'line_sub')::numeric), 0) into v_candidate_base
      from jsonb_array_elements(v_lines) l
      where (
        v_candidate.scope = 'all'
        or (v_candidate.scope = 'product' and l->>'product_id' = v_candidate.target_product_id::text)
        or (v_candidate.scope = 'category' and l->>'category_id' = v_candidate.target_category_id::text)
      )
      and ((l->>'is_sale')::boolean = false or v_candidate.applies_to_sale_items);

      if v_candidate_base <= 0 then continue; end if;

      if v_candidate.kind = 'percent' then
        v_candidate_discount := round(v_candidate_base * v_candidate.value / 100, 2);
      else
        v_candidate_discount := least(v_candidate.value, v_candidate_base);
      end if;
      if v_candidate.max_discount is not null then
        v_candidate_discount := least(v_candidate_discount, v_candidate.max_discount);
      end if;
      v_candidate_discount := least(v_candidate_discount, v_candidate_base);

      if v_candidate_discount > v_best_discount then
        v_coupon := v_candidate;
        v_eligible_base := v_candidate_base;
        v_best_discount := v_candidate_discount;
      end if;
    end loop;
  end if;

  -- Apply the chosen rule only to matching items, allocating fixed and capped discounts
  -- proportionally so the line snapshots always add up to the final order total.
  if v_coupon.id is not null then
    v_sale_ok := v_coupon.applies_to_sale_items;
    select coalesce(sum((l->>'line_sub')::numeric), 0) into v_eligible_base
    from jsonb_array_elements(v_lines) l
    where (
      v_coupon.scope = 'all'
      or (v_coupon.scope = 'product' and l->>'product_id' = v_coupon.target_product_id::text)
      or (v_coupon.scope = 'category' and l->>'category_id' = v_coupon.target_category_id::text)
    )
    and ((l->>'is_sale')::boolean = false or v_sale_ok);

    if v_eligible_base <= 0 then
      if coalesce(btrim(p_coupon_code), '') <> '' then raise exception 'coupon_not_applicable'; end if;
      v_coupon := null;
    else
      if v_coupon.kind = 'percent' then
        v_discount_target := round(v_eligible_base * v_coupon.value / 100, 2);
      else
        v_discount_target := least(v_coupon.value, v_eligible_base);
      end if;
      if v_coupon.max_discount is not null then
        v_discount_target := least(v_discount_target, v_coupon.max_discount);
      end if;
      v_discount_target := least(v_discount_target, v_eligible_base);

      v_n := jsonb_array_length(v_lines);
      for v_i in 0..v_n - 1 loop
        v_line := v_lines -> v_i;
        v_line_disc := 0;
        if (
          v_coupon.scope = 'all'
          or (v_coupon.scope = 'product' and v_line->>'product_id' = v_coupon.target_product_id::text)
          or (v_coupon.scope = 'category' and v_line->>'category_id' = v_coupon.target_category_id::text)
        ) and (((v_line->>'is_sale')::boolean = false) or v_sale_ok) then
          v_line_disc := round(v_discount_target * (v_line->>'line_sub')::numeric / v_eligible_base, 2);
          v_line_disc := least(v_line_disc, (v_line->>'line_sub')::numeric);
        end if;
        v_new_lines := v_new_lines || jsonb_build_array(jsonb_set(v_line, '{discount}', to_jsonb(v_line_disc)));
        v_discount := v_discount + v_line_disc;
      end loop;
      v_lines := v_new_lines;
    end if;
  end if;

  -- 6. Delivery fee (configured by owner; pickup is free).
  if p_fulfillment = 'delivery' then
    select coalesce((value->>'amount')::numeric, 0) into v_fee from public.store_settings where key = 'delivery_fee';
    v_fee := coalesce(v_fee, 0);
  end if;

  v_total := v_subtotal - v_discount + v_fee;
  if v_total < 0 then raise exception 'invalid_total'; end if;

  -- 7. Reference and tracking token. The raw token is returned ONCE; only its SHA-256 is stored.
  v_reference := 'PT-' || to_char(now() at time zone 'Africa/Cairo', 'YYMMDD') || '-'
                 || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.orders (
    reference, user_id, idempotency_key, status, fulfillment, payment_method,
    customer_name, customer_phone, customer_email, governorate, city, area, address,
    location_url, notes, currency, subtotal, discount_total, delivery_fee, total,
    coupon_code, tracking_token_hash
  ) values (
    v_reference, v_uid, p_idempotency_key, 'pending', p_fulfillment, p_payment_method,
    btrim(p_customer->>'name'), btrim(p_customer->>'phone'), nullif(v_email, ''),
    btrim(p_customer->>'governorate'), btrim(p_customer->>'city'), nullif(btrim(coalesce(p_customer->>'area', '')), ''),
    btrim(p_customer->>'address'), nullif(btrim(coalesce(p_customer->>'location_url', '')), ''),
    nullif(btrim(coalesce(p_customer->>'notes', '')), ''),
    v_currency, v_subtotal, v_discount, v_fee, v_total,
    case when v_coupon.id is not null and v_discount > 0 and v_coupon.promotion_type = 'coupon' then v_coupon.code end,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
  ) returning id into v_order_id;

  -- 8. Immutable item snapshots, stock movements, unit linkage.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    insert into public.order_items (
      order_id, product_id, unit_id, title_snapshot, title_ar_snapshot, sku_snapshot, model_snapshot,
      condition_snapshot, quantity, unit_price, discount_amount, line_total
    ) values (
      v_order_id,
      (v_line->>'product_id')::uuid,
      nullif(v_line->>'unit_id', '')::uuid,
      v_line->>'title',
      nullif(v_line->>'title_ar', ''),
      nullif(v_line->>'sku', ''),
      nullif(v_line->>'model', ''),
      v_line->>'condition',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::numeric,
      (v_line->>'discount')::numeric,
      (v_line->>'line_sub')::numeric - (v_line->>'discount')::numeric
    ) returning id into v_item_id;

    if nullif(v_line->>'unit_id', '') is not null then
      update public.inventory_units set sold_order_item_id = v_item_id where id = (v_line->>'unit_id')::uuid;
      insert into public.stock_movements (product_id, unit_id, delta, reason, order_id, actor_id)
        values ((v_line->>'product_id')::uuid, (v_line->>'unit_id')::uuid, -1, 'Order placed', v_order_id, v_uid);
    else
      insert into public.stock_movements (product_id, delta, reason, order_id, actor_id)
        values ((v_line->>'product_id')::uuid, -((v_line->>'quantity')::integer), 'Order placed', v_order_id, v_uid);
    end if;
  end loop;

  if v_coupon.id is not null and v_discount > 0 then
    insert into public.coupon_redemptions (coupon_id, order_id, user_id) values (v_coupon.id, v_order_id, v_uid);
    update public.coupons set redemptions_count = redemptions_count + 1 where id = v_coupon.id;
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, note)
    values (v_order_id, null, 'pending', v_uid, 'Order placed');

  return jsonb_build_object(
    'duplicate', false,
    'order_id', v_order_id,
    'reference', v_reference,
    'status', 'pending',
    'subtotal', v_subtotal,
    'discount_total', v_discount,
    'delivery_fee', v_fee,
    'total', v_total,
    'currency', v_currency,
    'tracking_token', v_token
  );
end $$;

-- ---------- Order status transitions (staff only, locked, idempotent) ----------

