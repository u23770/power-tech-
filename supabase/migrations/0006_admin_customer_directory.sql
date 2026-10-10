-- 0006_admin_customer_directory.sql
-- Staff-only customer directory for registered customers and guest checkouts.
-- Anonymous Auth sessions and staff accounts are deliberately excluded.
create or replace function public.admin_customer_directory(
  p_q text default '',
  p_kind text default 'all',
  p_page integer default 0,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(left(btrim(coalesce(p_q, '')), 100));
  v_kind text := case when p_kind in ('registered', 'guest') then p_kind else 'all' end;
  v_page integer := least(greatest(coalesce(p_page, 0), 0), 100000);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_result jsonb;
begin
  perform public.assert_staff('staff');

  with registered as (
    select
      'user:' || p.id::text as customer_key,
      p.id as account_id,
      coalesce(nullif(btrim(p.full_name), ''), latest.customer_name) as full_name,
      coalesce(nullif(btrim(p.phone), ''), latest.customer_phone) as phone,
      coalesce(nullif(latest.customer_email, ''), u.email) as email,
      true as is_registered,
      p.created_at,
      max(o.created_at) as last_order_at,
      (array_agg(o.id order by o.created_at desc, o.id desc) filter (where o.id is not null))[1] as last_order_id,
      count(o.id)::integer as order_count,
      coalesce(sum(case when o.status <> 'cancelled' then o.total else 0 end), 0)::numeric(12,2) as lifetime_value
    from public.profiles p
    join auth.users u on u.id = p.id and u.is_anonymous = false
    left join public.staff_roles sr on sr.user_id = p.id
    left join public.orders o on o.user_id = p.id
    left join lateral (
      select ox.customer_name, ox.customer_phone, ox.customer_email
      from public.orders ox
      where ox.user_id = p.id
      order by ox.created_at desc, ox.id desc
      limit 1
    ) latest on true
    where sr.user_id is null
    group by p.id, p.full_name, p.phone, u.email, p.created_at,
      latest.customer_name, latest.customer_phone, latest.customer_email
  ),
  guests as (
    select
      case
        when pg_catalog.regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = ''
          then 'order:' || o.id::text
        else 'guest:' || pg_catalog.regexp_replace(o.customer_phone, '[^0-9]', '', 'g')
      end as customer_key,
      null::uuid as account_id,
      (array_agg(o.customer_name order by o.created_at desc, o.id desc))[1] as full_name,
      (array_agg(o.customer_phone order by o.created_at desc, o.id desc))[1] as phone,
      (array_agg(o.customer_email order by o.created_at desc, o.id desc))[1] as email,
      false as is_registered,
      min(o.created_at) as created_at,
      max(o.created_at) as last_order_at,
      (array_agg(o.id order by o.created_at desc, o.id desc))[1] as last_order_id,
      count(*)::integer as order_count,
      coalesce(sum(case when o.status <> 'cancelled' then o.total else 0 end), 0)::numeric(12,2) as lifetime_value
    from public.orders o
    where o.user_id is null
    group by case
      when pg_catalog.regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = ''
        then 'order:' || o.id::text
      else 'guest:' || pg_catalog.regexp_replace(o.customer_phone, '[^0-9]', '', 'g')
    end
  ),
  all_customers as (
    select * from registered
    union all
    select * from guests
  ),
  filtered as (
    select c.*
    from all_customers c
    where (v_kind = 'all'
      or (v_kind = 'registered' and c.is_registered)
      or (v_kind = 'guest' and not c.is_registered))
      and (
        v_q = ''
        or lower(coalesce(c.full_name, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.email, '')) like '%' || v_q || '%'
      )
  )
  select jsonb_build_object(
    'count', (select count(*)::integer from filtered),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page_row) order by page_row.last_order_at desc nulls last, page_row.full_name asc nulls last, page_row.customer_key)
      from (
        select *
        from filtered
        order by last_order_at desc nulls last, full_name asc nulls last, customer_key
        limit v_page_size offset (v_page * v_page_size)
      ) page_row
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_customer_directory(text, text, integer, integer) from public;
revoke all on function public.admin_customer_directory(text, text, integer, integer) from anon;
grant execute on function public.admin_customer_directory(text, text, integer, integer) to authenticated;
