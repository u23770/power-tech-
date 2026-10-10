-- 0002_functions.sql — trusted database functions, triggers, validation.
-- All SECURITY DEFINER functions: fixed search_path, auth.uid()/role checks, explicit grants.

-- ---------- Authorization helper ----------
create or replace function public.assert_staff(p_min_role text default 'staff')
returns void language plpgsql stable set search_path = '' as $$
begin
  if not public.is_staff(p_min_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ---------- Audit trigger (generic, no secrets in audited tables) ----------
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (actor_id, action, entity, entity_id, before, after)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key', to_jsonb(old)->>'id', to_jsonb(old)->>'key'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_categories after insert or update or delete on public.categories
  for each row execute function public.audit_row_change();
create trigger audit_brands after insert or update or delete on public.brands
  for each row execute function public.audit_row_change();
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.audit_row_change();
create trigger audit_coupons after insert or update or delete on public.coupons
  for each row execute function public.audit_row_change();
create trigger audit_settings after insert or update or delete on public.store_settings
  for each row execute function public.audit_row_change();

-- Every product gets a stock row (quantity-tracked products use it; unit-tracked ignore it).
create or replace function public.create_inventory_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventory (product_id) values (new.id) on conflict (product_id) do nothing;
  return new;
end $$;

create trigger products_inventory_row after insert on public.products
  for each row execute function public.create_inventory_row();

-- ---------- Store settings validation ----------
create or replace function public.validate_store_setting()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_key text;
begin
  case new.key
    when 'checkout_options' then
      if jsonb_typeof(new.value) <> 'object' then raise exception 'invalid_setting'; end if;
      if exists (
        select 1 from jsonb_each(new.value) e
        where e.key not in ('delivery', 'pickup', 'cod', 'pay_at_store')
           or jsonb_typeof(e.value) <> 'boolean'
      ) then raise exception 'invalid_setting'; end if;
    when 'delivery_fee' then
      if coalesce(jsonb_typeof(new.value->'amount'), '') <> 'number'
         or (new.value->>'amount')::numeric not between 0 and 100000 then
        raise exception 'invalid_setting';
      end if;
    when 'max_qty_per_line' then
      if coalesce(jsonb_typeof(new.value), '') <> 'number'
         or (new.value #>> '{}')::numeric not between 1 and 50 then
        raise exception 'invalid_setting';
      end if;
    when 'currency' then
      if coalesce(new.value->>'code', '') !~ '^[A-Z]{3}$' then raise exception 'invalid_setting'; end if;
    when 'guest_checkout' then
      if coalesce(jsonb_typeof(new.value->'enabled'), '') <> 'boolean' then raise exception 'invalid_setting'; end if;
    when 'contact' then
      if jsonb_typeof(new.value) <> 'object' then raise exception 'invalid_setting'; end if;
      -- Any link-like field must be https (or mailto/tel for contact fields). Empty strings are allowed.
      for v_key in select e.key from jsonb_each_text(new.value) e
        where e.key like '%_url' and coalesce(e.value, '') <> '' and e.value !~ '^https://[^\s]+$'
      loop
        raise exception 'invalid_setting';
      end loop;
  else
    null;
  end case;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;

create trigger store_settings_validate before insert or update on public.store_settings
  for each row execute function public.validate_store_setting();

-- ---------- Order placement (the only path that creates orders) ----------
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

  -- 5. Coupon (at most one per order; never stacked with other coupons).
  if coalesce(btrim(p_coupon_code), '') <> '' then
    select * into v_coupon from public.coupons
      where code = upper(btrim(p_coupon_code)) and is_active
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

    v_sale_ok := v_coupon.applies_to_sale_items;
    select coalesce(sum((l->>'line_sub')::numeric), 0) into v_eligible_base
      from jsonb_array_elements(v_lines) l
      where (l->>'is_sale')::boolean = false or v_sale_ok;
    if v_eligible_base <= 0 then raise exception 'coupon_not_applicable'; end if;

    -- Allocate the discount per eligible line (proportional, rounded), then recompute the total from lines.
    v_n := jsonb_array_length(v_lines);
    for v_i in 0..v_n - 1 loop
      v_line := v_lines -> v_i;
      v_line_disc := 0;
      if (v_line->>'is_sale')::boolean = false or v_sale_ok then
        if v_coupon.kind = 'percent' then
          v_line_disc := round((v_line->>'line_sub')::numeric * v_coupon.value / 100, 2);
        else
          v_line_disc := round(least(v_coupon.value, v_eligible_base) * (v_line->>'line_sub')::numeric / v_eligible_base, 2);
        end if;
        v_line_disc := least(v_line_disc, (v_line->>'line_sub')::numeric);
      end if;
      v_new_lines := v_new_lines || jsonb_build_array(jsonb_set(v_line, '{discount}', to_jsonb(v_line_disc)));
      v_discount := v_discount + v_line_disc;
    end loop;
    v_lines := v_new_lines;
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
    case when v_coupon.id is not null and v_discount > 0 then v_coupon.code end,
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
create or replace function public.set_order_status(p_order_id uuid, p_to_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  o public.orders%rowtype;
  v_ok boolean;
  v_item public.order_items%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.assert_staff('staff');
  if p_to_status not in ('pending', 'confirmed', 'processing', 'ready', 'completed', 'cancelled') then
    raise exception 'invalid_status';
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'invalid_note'; end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  -- Double-processing guard: repeating the same target status is a no-op.
  if o.status = p_to_status then
    return jsonb_build_object('changed', false, 'status', o.status);
  end if;

  v_ok := case o.status
    when 'pending' then p_to_status in ('confirmed', 'cancelled')
    when 'confirmed' then p_to_status in ('processing', 'cancelled')
    when 'processing' then p_to_status in ('ready', 'cancelled')
    when 'ready' then p_to_status in ('completed', 'cancelled')
    else false
  end;
  if not v_ok then raise exception 'invalid_transition'; end if;

  if p_to_status = 'cancelled' then
    perform public.assert_staff('manager');
    if v_note is null then raise exception 'note_required'; end if;
    -- Restore stock exactly once (the status guard above prevents a second restore).
    for v_item in select * from public.order_items where order_id = o.id loop
      if v_item.unit_id is not null then
        update public.inventory_units set status = 'available', sold_order_item_id = null
          where id = v_item.unit_id and status = 'sold';
        insert into public.stock_movements (product_id, unit_id, delta, reason, order_id, actor_id)
          values (v_item.product_id, v_item.unit_id, 1, 'Order cancelled: restock', o.id, v_uid);
      else
        update public.inventory set quantity_on_hand = quantity_on_hand + v_item.quantity
          where product_id = v_item.product_id;
        insert into public.stock_movements (product_id, delta, reason, order_id, actor_id)
          values (v_item.product_id, v_item.quantity, 'Order cancelled: restock', o.id, v_uid);
      end if;
    end loop;
  end if;

  update public.orders set status = p_to_status where id = o.id;
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, note)
    values (o.id, o.status, p_to_status, v_uid, v_note);
  insert into public.audit_logs (actor_id, action, entity, entity_id, before, after)
    values (v_uid, 'order.status', 'orders', o.id::text,
            jsonb_build_object('status', o.status), jsonb_build_object('status', p_to_status, 'note', v_note));

  return jsonb_build_object('changed', true, 'status', p_to_status);
end $$;

-- ---------- Quantity stock adjustment (staff; audited; never negative) ----------
create or replace function public.adjust_stock(p_product_id uuid, p_delta integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_current integer;
  v_new integer;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.assert_staff('staff');
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'invalid_delta'; end if;
  if char_length(v_reason) not between 3 and 200 then raise exception 'reason_required'; end if;
  if not exists (select 1 from public.products where id = p_product_id and track_mode = 'quantity') then
    raise exception 'not_quantity_tracked';
  end if;

  insert into public.inventory (product_id) values (p_product_id) on conflict (product_id) do nothing;
  select quantity_on_hand into v_current from public.inventory where product_id = p_product_id for update;
  v_new := v_current + p_delta;
  if v_new < 0 then raise exception 'negative_stock'; end if;

  update public.inventory set quantity_on_hand = v_new where product_id = p_product_id;
  insert into public.stock_movements (product_id, delta, reason, actor_id)
    values (p_product_id, p_delta, v_reason, v_uid);
  insert into public.audit_logs (actor_id, action, entity, entity_id, before, after)
    values (v_uid, 'stock.adjust', 'inventory', p_product_id::text,
            jsonb_build_object('quantity_on_hand', v_current),
            jsonb_build_object('quantity_on_hand', v_new, 'reason', v_reason));

  return jsonb_build_object('quantity_on_hand', v_new);
end $$;

-- ---------- Guest/customer order tracking (reference + secret token) ----------
create or replace function public.track_order(p_reference text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where reference = upper(btrim(coalesce(p_reference, '')));
  if not found or encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') <> o.tracking_token_hash then
    raise exception 'order_not_found';
  end if;
  return jsonb_build_object(
    'reference', o.reference,
    'status', o.status,
    'fulfillment', o.fulfillment,
    'total', o.total,
    'currency', o.currency,
    'created_at', o.created_at,
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('to', h.to_status, 'at', h.created_at) order by h.created_at), '[]'::jsonb)
                 from public.order_status_history h where h.order_id = o.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('title', i.title_snapshot, 'quantity', i.quantity, 'line_total', i.line_total) order by i.created_at), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id)
  );
end $$;

-- ---------- Dashboard summary (aggregated in SQL; no row downloads) ----------
-- "Sales" = total of non-cancelled orders placed in the date range.
create or replace function public.admin_dashboard_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_staff('staff');
  return jsonb_build_object(
    'orders_total', (select count(*) from public.orders o where o.created_at >= p_from and o.created_at < p_to),
    'orders_pending', (select count(*) from public.orders o where o.status = 'pending'),
    'orders_cancelled', (select count(*) from public.orders o where o.status = 'cancelled' and o.created_at >= p_from and o.created_at < p_to),
    'sales_total', (select coalesce(sum(o.total), 0) from public.orders o
                    where o.status <> 'cancelled' and o.created_at >= p_from and o.created_at < p_to),
    'low_stock', (select count(*) from public.inventory i join public.products p on p.id = i.product_id
                  where p.track_mode = 'quantity' and p.status = 'published'
                    and i.quantity_on_hand > 0 and i.quantity_on_hand <= i.low_stock_threshold),
    'out_of_stock', (select count(*) from public.products p left join public.inventory i on i.product_id = p.id
                     where p.track_mode = 'quantity' and p.status = 'published' and coalesce(i.quantity_on_hand, 0) = 0)
  );
end $$;

-- ---------- Grants for functions: explicit, no PUBLIC execute ----------
revoke all on function public.place_order(jsonb, jsonb, text, text, text, uuid) from public;
revoke all on function public.set_order_status(uuid, text, text) from public;
revoke all on function public.adjust_stock(uuid, integer, text) from public;
revoke all on function public.track_order(text, text) from public;
revoke all on function public.admin_dashboard_summary(timestamptz, timestamptz) from public;
revoke all on function public.is_staff(text) from public;
revoke all on function public.assert_staff(text) from public;

grant execute on function public.place_order(jsonb, jsonb, text, text, text, uuid) to anon, authenticated;
grant execute on function public.track_order(text, text) to anon, authenticated;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;
grant execute on function public.adjust_stock(uuid, integer, text) to authenticated;
grant execute on function public.admin_dashboard_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.is_staff(text) to anon, authenticated;
