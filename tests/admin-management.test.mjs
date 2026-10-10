import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const app = await read('../admin/js/app.js');
const api = await read('../admin/js/api.js');
const i18n = await read('../shared/i18n.js');
const catalog = await read('../admin/js/views/catalog.js');
const coupons = await read('../admin/js/views/coupons.js');
const settings = await read('../admin/js/views/settings.js');

test('catalogue, coupons and settings are manager-only routes', () => {
  assert.match(app, /catalog:\s*\{\s*min:\s*'manager',\s*view:\s*\(\)\s*=>\s*import\('\.\/views\/catalog\.js'\)\s*\}/);
  assert.match(app, /coupons:\s*\{\s*min:\s*'manager',\s*view:\s*\(\)\s*=>\s*import\('\.\/views\/coupons\.js'\)\s*\}/);
  assert.match(app, /settings:\s*\{\s*min:\s*'manager',\s*view:\s*\(\)\s*=>\s*import\('\.\/views\/settings\.js'\)\s*\}/);
});

test('category and brand deletion refuses to orphan product assignments', () => {
  assert.match(api, /export async function deleteCategoryAdmin\(id\)[\s\S]*?from\('products'\)[\s\S]*?eq\('category_id', id\)[\s\S]*?category_in_use/);
  assert.match(api, /export async function deleteBrandAdmin\(id\)[\s\S]*?from\('products'\)[\s\S]*?eq\('brand_id', id\)[\s\S]*?brand_in_use/);
  assert.match(catalog, /api\.setCategoryActiveAdmin/);
  assert.match(catalog, /api\.updateCategoryAdmin/);
});

test('coupon delete protects historical redemptions and supports full lifecycle controls', () => {
  assert.match(api, /export async function deleteCouponAdmin\(id\)[\s\S]*?from\('coupon_redemptions'\)[\s\S]*?eq\('coupon_id', id\)[\s\S]*?coupon_in_use/);
  assert.match(coupons, /api\.insertCouponAdmin/);
  assert.match(coupons, /api\.updateCouponAdmin/);
  assert.match(coupons, /api\.setCouponActiveAdmin/);
  assert.match(coupons, /max_redemptions/);
  assert.match(coupons, /admin\.coupons\.product_discounts/);
  assert.match(coupons, /href: '#\/products'/);
  assert.match(coupons, /formTitle\.textContent = t\('admin\.coupons\.edit_title'\)/);
});

test('store settings use simple forms instead of requiring non-technical users to edit JSON', () => {
  assert.match(settings, /buildSettingFields/);
  assert.match(settings, /checkout_options/);
  assert.match(settings, /guest_checkout/);
  assert.match(settings, /content_hero/);
  assert.match(settings, /content_why/);
  assert.match(settings, /contact/);
  assert.match(settings, /api\\.saveStoreSettingAdmin/);
  assert.doesNotMatch(settings, /JSON\\.parse\\(textarea\\.value\\)/);
});
test('new admin labels have Arabic and English translations', () => {
  for (const key of [
    'admin.nav.catalog', 'admin.nav.coupons', 'admin.nav.settings',
    'admin.catalog.categories', 'admin.coupons.created',
    'admin.settings.invalid_json', 'admin.settings.all_added',
  ]) {
    const occurrences = i18n.split(`'${key}':`).length - 1;
    assert.ok(occurrences >= 2, `expected both Arabic and English translations for: ${key}`);
  }
});
