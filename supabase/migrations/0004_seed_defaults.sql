-- 0004_seed_defaults.sql — SAFE defaults only. No products, prices, contacts, hours, or policies.
-- Checkout is intentionally DISABLED until the owner enables payment and fulfilment options.

insert into public.store_settings (key, value, is_public) values
  ('store_name',        '{"en": "POWER TECH", "ar": "POWER TECH"}', true),
  ('currency',          '{"code": "EGP"}', true),
  ('guest_checkout',    '{"enabled": true}', true),
  ('checkout_options',  '{"delivery": false, "pickup": false, "cod": false, "pay_at_store": false}', true),
  ('delivery_fee',      '{"amount": 0}', true),
  ('max_qty_per_line',  '10', true),
  ('contact',           '{}', true),
  ('content_hero',      '{"en": {"title": "", "subtitle": "", "cta": ""}, "ar": {"title": "", "subtitle": "", "cta": ""}}', true),
  ('content_why',       '{"en": [], "ar": []}', true)
on conflict (key) do nothing;

-- Suggested categories (owner may rename, reorder, or disable). No products are created.
insert into public.categories (slug, name_en, name_ar, sort_order) values
  ('laptops',              'Laptops',                  'لابتوبات', 1),
  ('desktops',             'Desktop computers',        'أجهزة كمبيوتر مكتبي', 2),
  ('monitors',             'Monitors',                 'شاشات', 3),
  ('components',           'Computer components',      'مكونات الكمبيوتر', 4),
  ('storage-memory',       'Storage and memory',       'التخزين والذاكرة', 5),
  ('accessories',          'Accessories',              'إكسسوارات', 6),
  ('networking',           'Networking',               'الشبكات', 7),
  ('gaming',               'Gaming',                   'ألعاب', 8),
  ('software-other',       'Software and other',       'برمجيات ومنتجات أخرى', 9)
on conflict (slug) do nothing;
