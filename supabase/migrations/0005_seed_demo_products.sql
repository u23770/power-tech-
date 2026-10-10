-- 0005_seed_demo_products.sql — intentionally fictional data for storefront and admin testing.
-- Every demo product is visibly labelled; this migration never creates real customer orders.
-- Re-running it does not overwrite edits or inventory changes made during testing.

insert into public.brands (name)
values
  ('HP'), ('Lenovo'), ('Dell'), ('ASUS'), ('Samsung'), ('Logitech'),
  ('Redragon'), ('Kingston'), ('TP-Link'), ('UGREEN'), ('Cooler Master'), ('NVIDIA')
on conflict (name) do nothing;

insert into public.products
  (slug, sku, model_number, brand_id, category_id, title_en, title_ar, description_en, description_ar,
   condition, price, sale_price, currency, warranty_text_en, warranty_text_ar, track_mode, status, is_featured, specs)
select
  v.slug, v.sku, v.model_number,
  (select b.id from public.brands b where b.name = v.brand),
  (select c.id from public.categories c where c.slug = v.category_slug),
  v.title_en, v.title_ar, v.description_en, v.description_ar,
  v.condition, v.price, v.sale_price, 'EGP', v.warranty_en, v.warranty_ar,
  v.track_mode, 'published', v.is_featured, v.specs::jsonb
from (values
  ('demo-hp-probook-450-g8', 'DEMO-LAP-001', 'ProBook 450 G8', 'HP', 'laptops',
   '[DEMO] HP ProBook 450 G8', '［تجريبي］ HP ProBook 450 G8',
   'Demo listing only. Specifications and stock are fictional and are provided for testing the store.', 'منتج تجريبي فقط. المواصفات والمخزون افتراضيان لاختبار المتجر.',
   'new', 24500.00, 22900.00, 'quantity', true, '12-month demo warranty', 'ضمان تجريبي ١٢ شهرًا',
   '{"cpu":"Intel Core i5","ram_gb":16,"storage_gb":512,"storage_type":"SSD","screen_in":15.6}'),
  ('demo-lenovo-thinkpad-t14-gen2', 'DEMO-LAP-002', 'ThinkPad T14 Gen 2', 'Lenovo', 'laptops',
   '[DEMO] Lenovo ThinkPad T14 Gen 2', '［تجريبي］ Lenovo ThinkPad T14 Gen 2',
   'Demo used laptop with individually tracked sample units. Not a real listing.', 'لابتوب مستعمل تجريبي بوحدات مخزون منفصلة. ليس عرض بيع حقيقيًا.',
   'used', 19800.00, null, 'unit', true, 'Demo warranty — not for sale', 'ضمان تجريبي — غير مخصص للبيع',
   '{"cpu":"Intel Core i5","ram_gb":16,"storage_gb":256,"storage_type":"SSD","screen_in":14}'),
  ('demo-dell-latitude-5420', 'DEMO-LAP-003', 'Latitude 5420', 'Dell', 'laptops',
   '[DEMO] Dell Latitude 5420 Refurbished', '［تجريبي］ Dell Latitude 5420 مجدد',
   'Demo refurbished laptop. Two fictional serial-tracked units are included to test the individual-unit inventory workflow.', 'لابتوب مجدد تجريبي. تمت إضافة وحدتين افتراضيتين لاختبار إدارة مخزون الوحدات.',
   'refurbished', 18500.00, null, 'unit', true, 'Demo warranty — not for sale', 'ضمان تجريبي — غير مخصص للبيع',
   '{"cpu":"Intel Core i5","ram_gb":16,"storage_gb":512,"storage_type":"SSD","screen_in":14}'),
  ('demo-asus-tuf-gaming-f15', 'DEMO-GAM-001', 'TUF Gaming F15', 'ASUS', 'gaming',
   '[DEMO] ASUS TUF Gaming F15', '［تجريبي］ ASUS TUF Gaming F15',
   'Fictional demo gaming laptop listing. The sale price is included to test discounts and sorting.', 'لابتوب ألعاب تجريبي ببيانات وسعر افتراضيين لاختبار الخصومات والترتيب.',
   'new', 38900.00, 36500.00, 'quantity', true, 'Demo warranty only', 'ضمان تجريبي فقط',
   '{"cpu":"Intel Core i7","ram_gb":16,"storage_gb":512,"gpu":"GeForce RTX 4050","screen_in":15.6}'),
  ('demo-samsung-monitor-24', 'DEMO-MON-001', 'S24R350', 'Samsung', 'monitors',
   '[DEMO] Samsung 24-inch Monitor', '［تجريبي］ شاشة Samsung مقاس 24 بوصة',
   'A fictional 24-inch monitor product for testing catalog cards and category filters.', 'شاشة افتراضية مقاس ٢٤ بوصة لاختبار بطاقات المنتجات وفلاتر التصنيف.',
   'new', 4250.00, null, 'quantity', true, 'Demo warranty only', 'ضمان تجريبي فقط',
   '{"screen_in":24,"resolution":"1920x1080","refresh_rate_hz":75,"panel":"IPS"}'),
  ('demo-logitech-g502-hero', 'DEMO-ACC-001', 'G502 HERO', 'Logitech', 'accessories',
   '[DEMO] Logitech G502 HERO Mouse', '［تجريبي］ ماوس Logitech G502 HERO',
   'Fictional gaming mouse product for testing the cart and search.', 'ماوس ألعاب افتراضي لاختبار البحث والسلة.',
   'new', 1650.00, null, 'quantity', false, 'Demo item — not for sale', 'منتج تجريبي — غير مخصص للبيع',
   '{"connection":"USB","buttons":11,"dpi_max":25600}'),
  ('demo-redragon-k552-keyboard', 'DEMO-GAM-002', 'K552 Kumara', 'Redragon', 'gaming',
   '[DEMO] Redragon K552 Mechanical Keyboard', '［تجريبي］ لوحة مفاتيح Redragon K552 ميكانيكية',
   'Fictional keyboard with low demo stock for testing low-stock displays.', 'لوحة مفاتيح افتراضية بمخزون تجريبي منخفض لاختبار تنبيهات المخزون.',
   'new', 1950.00, null, 'quantity', false, 'Demo item — not for sale', 'منتج تجريبي — غير مخصص للبيع',
   '{"connection":"USB","layout":"TKL","switch_type":"Mechanical","backlight":"RGB"}'),
  ('demo-kingston-nv2-1tb', 'DEMO-SSD-001', 'NV2 1TB', 'Kingston', 'storage-memory',
   '[DEMO] Kingston NV2 1TB SSD', '［تجريبي］ وحدة Kingston NV2 SSD سعة 1 تيرابايت',
   'Fictional SSD with zero demo stock to test unavailable/out-of-stock filters.', 'وحدة تخزين افتراضية بمخزون صفري لاختبار حالات عدم التوفر وفلاتر المخزون.',
   'new', 2950.00, null, 'quantity', false, 'Demo item — not for sale', 'منتج تجريبي — غير مخصص للبيع',
   '{"storage_gb":1000,"storage_type":"NVMe SSD","interface":"PCIe 4.0"}'),
  ('demo-kingston-fury-16gb', 'DEMO-RAM-001', 'Fury Beast 16GB DDR4', 'Kingston', 'storage-memory',
   '[DEMO] Kingston Fury Beast 16GB RAM', '［تجريبي］ ذاكرة Kingston Fury Beast سعة 16 جيجابايت',
   'Fictional RAM listing for testing technical specifications and price filters.', 'ذاكرة افتراضية لاختبار المواصفات الفنية وفلاتر السعر.',
   'new', 1500.00, null, 'quantity', false, 'Demo item — not for sale', 'منتج تجريبي — غير مخصص للبيع',
   '{"capacity_gb":16,"memory_type":"DDR4","speed_mhz":3200}'),
  ('demo-tplink-archer-c6', 'DEMO-NET-001', 'Archer C6', 'TP-Link', 'networking',
   '[DEMO] TP-Link Archer C6 Router', '［تجريبي］ راوتر TP-Link Archer C6',
   'Fictional router listing for testing the networking category and stock management.', 'راوتر افتراضي لاختبار تصنيف الشبكات وإدارة المخزون.',
   'new', 2100.00, null, 'quantity', false, 'Demo item — not for sale', 'منتج تجريبي — غير مخصص للبيع',
   '{"wifi":"Wi-Fi 5","ethernet_ports":4,"bands":"Dual band"}'),
  ('demo-ugreen-usbc-hub', 'DEMO-ACC-002', 'CM512 Hub 6-in-1', 'UGREEN', 'accessories',
   '[DEMO] UGREEN USB-C Hub 6-in-1', '［تجريبي］ موزع UGREEN USB-C ستة في واحد',
   'Fictional USB-C hub to test catalog and cart controls.', 'موزع USB-C افتراضي لاختبار الكتالوج وأزرار السلة.',
   'new', 2100.00, null, 'quantity', false, 'Demo item — not for sale', 'منتج تجريبي — غير مخصص للبيع',
   '{"ports":"HDMI, USB-A, USB-C, SD","connection":"USB-C"}'),
  ('demo-coolermaster-650w', 'DEMO-CMP-001', 'MWE 650 Bronze V2', 'Cooler Master', 'components',
   '[DEMO] Cooler Master MWE 650 Bronze PSU', '［تجريبي］ مزود طاقة Cooler Master MWE 650W',
   'Fictional 650 W power supply for testing component filters.', 'مزود طاقة افتراضي بقدرة ٦٥٠ واط لاختبار فلاتر المكونات.',
   'new', 3150.00, null, 'quantity', false, 'Demo item — not for sale', 'منتج تجريبي — غير مخصص للبيع',
   '{"power_w":650,"efficiency":"80 PLUS Bronze","modular":false}'),
  ('demo-nvidia-rtx4060', 'DEMO-GPU-001', 'GeForce RTX 4060', 'NVIDIA', 'components',
   '[DEMO] NVIDIA GeForce RTX 4060', '［تجريبي］ بطاقة NVIDIA GeForce RTX 4060',
   'Fictional graphics card listing, marked as demo to test a higher-priced component.', 'بطاقة رسوميات افتراضية ومعلّمة كتجريبية لاختبار منتج مرتفع السعر.',
   'new', 16900.00, null, 'quantity', true, 'Demo warranty only', 'ضمان تجريبي فقط',
   '{"memory_gb":8,"memory_type":"GDDR6","architecture":"Ada Lovelace"}')
) as v(slug, sku, model_number, brand, category_slug, title_en, title_ar, description_en, description_ar,
       condition, price, sale_price, track_mode, is_featured, warranty_en, warranty_ar, specs)
on conflict (slug) do nothing;

-- Quantity-based stock is intentionally varied to exercise in-stock, low-stock and out-of-stock states.
insert into public.inventory (product_id, quantity_on_hand, low_stock_threshold)
select p.id, v.quantity_on_hand, v.low_stock_threshold
from (values
  ('DEMO-LAP-001', 6, 2),
  ('DEMO-GAM-001', 2, 1),
  ('DEMO-MON-001', 8, 2),
  ('DEMO-ACC-001', 14, 3),
  ('DEMO-GAM-002', 1, 2),
  ('DEMO-SSD-001', 0, 2),
  ('DEMO-RAM-001', 10, 2),
  ('DEMO-NET-001', 5, 1),
  ('DEMO-ACC-002', 3, 1),
  ('DEMO-CMP-001', 4, 1),
  ('DEMO-GPU-001', 2, 1)
) as v(sku, quantity_on_hand, low_stock_threshold)
join public.products p on p.sku = v.sku
on conflict (product_id) do nothing;

-- Individually tracked sample units exercise used/refurbished inventory without inventing real serials.
insert into public.inventory_units
  (product_id, internal_ref, condition_grade, cosmetic_notes_en, cosmetic_notes_ar,
   battery_health_pct, included_accessories, warranty_text, cost_price, selling_price, status)
select p.id, v.internal_ref, v.condition_grade, v.notes_en, v.notes_ar,
       v.battery_health_pct, v.accessories, 'Demo unit — not for sale', v.cost_price, v.selling_price, 'available'
from (values
  ('DEMO-LAP-002', 'DEMO-T14-UNIT-01', 'A', 'Demo unit with light cosmetic wear', 'وحدة تجريبية بها آثار استخدام بسيطة', 88, 'Charger (demo)', 15000.00, 18750.00),
  ('DEMO-LAP-002', 'DEMO-T14-UNIT-02', 'B', 'Demo unit with visible cosmetic wear', 'وحدة تجريبية بها آثار استخدام واضحة', 81, 'Charger (demo)', 14500.00, 18200.00),
  ('DEMO-LAP-003', 'DEMO-LAT-UNIT-01', 'A', 'Demo refurbished unit in good condition', 'وحدة مجددة تجريبية بحالة جيدة', 91, 'Charger (demo)', 14000.00, 17900.00),
  ('DEMO-LAP-003', 'DEMO-LAT-UNIT-02', 'A', 'Demo refurbished unit with light wear', 'وحدة مجددة تجريبية بآثار استخدام بسيطة', 86, 'Charger (demo)', 13800.00, 18100.00)
) as v(sku, internal_ref, condition_grade, notes_en, notes_ar, battery_health_pct, accessories, cost_price, selling_price)
join public.products p on p.sku = v.sku
on conflict (internal_ref) do nothing;
