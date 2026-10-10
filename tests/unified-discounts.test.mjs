import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const migration = await read('../supabase/migrations/0007_unified_promotions.sql');
const admin = await read('../admin/js/views/coupons.js');
const api = await read('../admin/js/api.js');
const translations = await read('../shared/i18n.js');

test('promotion schema supports coupons, automatic offers and first-order offers', () => {
  assert.match(migration, /promotion_type text not null default 'coupon'/);
  assert.match(migration, /promotion_type in \('coupon', 'automatic', 'signup'\)/);
  assert.match(migration, /alter table public\.coupons alter column code drop not null/);
  assert.match(migration, /coupons_code_by_type_check/);
  assert.match(migration, /max_uses_per_customer integer/);
  assert.match(migration, /max_discount numeric/);
  assert.match(migration, /priority integer/);
});

test('promotions can target one product, a full category, or the whole catalogue', () => {
  assert.match(migration, /scope text not null default 'all'/);
  assert.match(migration, /target_product_id uuid references public\.products/);
  assert.match(migration, /target_category_id uuid references public\.categories/);
  assert.match(migration, /coupons_scope_target_check/);
  assert.match(migration, /'category_id', v_product\.category_id/);
  assert.match(migration, /v_candidate\.scope = 'all'/);
  assert.match(migration, /v_candidate\.scope = 'product'/);
  assert.match(migration, /v_candidate\.scope = 'category'/);
});

test('automatic promotions use the greatest eligible server-calculated saving and honour limits', () => {
  assert.match(migration, /best applicable automatic promotion/);
  assert.match(migration, /order by c\.priority desc, c\.created_at desc/);
  assert.match(migration, /v_candidate\.max_discount/);
  assert.match(migration, /v_candidate\.max_uses_per_customer/);
  assert.match(migration, /v_coupon\.max_redemptions/);
  assert.match(migration, /insert into public\.coupon_redemptions/);
  assert.match(migration, /set redemptions_count = redemptions_count \+ 1/);
});

test('admin exposes create/edit/pause controls and selectors for scoped promotions', () => {
  for (const value of ['coupon', 'automatic', 'signup', 'all', 'product', 'category']) {
    assert.ok(admin.includes(value), 'missing promotion option: ' + value);
  }
  assert.match(admin, /api\.listPromotionTargetsAdmin\(\)/);
  assert.match(admin, /api\.insertCouponAdmin/);
  assert.match(admin, /api\.updateCouponAdmin/);
  assert.match(admin, /api\.setCouponActiveAdmin/);
  assert.match(admin, /target_product_id/);
  assert.match(admin, /target_category_id/);
  assert.match(admin, /max_uses_per_customer/);
  assert.match(admin, /max_discount/);
});

test('admin API returns promotion scope and loads product/category targets', () => {
  assert.match(api, /export async function listPromotionTargetsAdmin\(\)/);
  assert.match(api, /select\('id,title_en,title_ar,model_number,sku,status'\)/);
  assert.match(api, /select\('id,name_en,name_ar,is_active'\)/);
  assert.match(api, /promotion_type,scope,target_product_id,target_category_id/);
});

test('all new offer controls have Arabic and English translations', () => {
  const keys = [
    'admin.coupons.type.automatic',
    'admin.coupons.type.signup',
    'admin.coupons.scope.product',
    'admin.coupons.scope.category',
    'admin.coupons.max_discount',
    'admin.coupons.max_per_customer',
    'admin.coupons.form_help',
  ];
  for (const key of keys) {
    assert.ok(translations.split("'" + key + "':").length - 1 >= 2, 'missing Arabic/English translation for ' + key);
  }
});
