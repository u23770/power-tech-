import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvText, serializeCsvRows, prepareProductImport, spreadsheetRowsToCsv, normalizeProductImportRows } from '../admin/js/csv.js';

test('CSV parser preserves commas, escaped quotes and embedded newlines', () => {
  const rows = parseCsvText('title_en,description_en\r\n"Workstation, Pro","line one\nline ""two"""\r\n');
  assert.deepEqual(rows, [
    ['title_en', 'description_en'],
    ['Workstation, Pro', 'line one\nline "two"'],
  ]);
});

test('CSV serializer quotes delimiters, quotes and line breaks and round-trips', () => {
  const rows = [['title_en', 'description_en'], ['Workstation, Pro', 'line one\nline "two"']];
  assert.deepEqual(parseCsvText(serializeCsvRows(rows)), rows);
});

test('Excel sheet rows are converted to CSV without losing header names or escaped values', () => {
  const rows = [
    ['title_en', 'description_en', 'price'],
    ['Workstation, Pro', 'Line 1\nLine "two"', 12500],
  ];
  assert.deepEqual(parseCsvText(spreadsheetRowsToCsv(rows)), [
    ['title_en', 'description_en', 'price'],
    ['Workstation, Pro', 'Line 1\nLine "two"', '12500'],
  ]);
});

test('Arabic Excel headings map to product fields and duplicate a generic product name safely', () => {
  const rows = normalizeProductImportRows([
    ['اسم المنتج', 'السعر', 'الكمية', 'التصنيف', 'الماركة', 'سعر الخصم'],
    ['لابتوب تجريبي', 12000, 4, 'لابتوبات', 'Lenovo', 11000],
  ]);
  assert.deepEqual(rows[0], ['title_en', 'price', 'quantity', 'category_slug', 'brand', 'sale_price', 'title_ar']);
  assert.equal(rows[1][0], 'لابتوب تجريبي');
  assert.equal(rows[1][6], 'لابتوب تجريبي');
});

test('product import resolves human-readable category names and creates a safe slug for Arabic-only names', () => {
  const result = prepareProductImport([
    'اسم المنتج,السعر,التصنيف',
    'لابتوب تجريبي,12000,لابتوبات',
  ].join('\\n'), {
    categories: [{ id: 'cat-1', slug: 'laptops', name_en: 'Laptops', name_ar: 'لابتوبات' }],
    brands: [],
    existingProducts: [],
  });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product.category_id, 'cat-1');
  assert.equal(result.items[0].product.title_ar, 'لابتوب تجريبي');
  assert.match(result.items[0].product.slug, /^product-2$/);
});

test('product import skips template examples and resolves known brand/category values', () => {
  const csv = [
    'is_example,sku,slug,title_en,brand,category_slug,condition,track_mode,price,quantity',
    'yes,EXAMPLE-1,example-one,EXAMPLE: Do not import,ExampleBrand,laptops,new,quantity,0.00,0',
    'no,PT-100,laptop-pro,Business laptop,Lenovo,laptops,new,quantity,12000,5',
  ].join('\n');
  const result = prepareProductImport(csv, {
    categories: [{ id: 'cat-1', slug: 'laptops' }],
    brands: [{ id: 'brand-1', name: 'Lenovo' }],
    existingProducts: [],
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product.category_id, 'cat-1');
  assert.equal(result.items[0].product.brand_id, 'brand-1');
  assert.equal(result.items[0].quantity, 5);
});

test('product import rejects duplicate SKUs and unknown categories before writes', () => {
  const csv = [
    'sku,slug,title_en,category_slug,condition,track_mode,price',
    'DUP-1,dup-one,First product,laptops,new,quantity,100',
    'DUP-1,dup-two,Second product,unknown,new,quantity,100',
  ].join('\n');
  const result = prepareProductImport(csv, {
    categories: [{ id: 'cat-1', slug: 'laptops' }],
    brands: [],
    existingProducts: [{ sku: 'USED-1', slug: 'already-used' }],
  });
  assert.ok(result.errors.some((e) => e.code === 'duplicate_sku'));
  assert.ok(result.errors.some((e) => e.code === 'unknown_category'));
});

import { readFile as readSource } from 'node:fs/promises';

test('product import control accepts Excel formats and tells users the import steps', async () => {
  const [view, parser] = await Promise.all([
    readSource(new URL('../admin/js/views/products.js', import.meta.url), 'utf8'),
    readSource(new URL('../admin/js/csv.js', import.meta.url), 'utf8'),
  ]);
  assert.match(view, /\.xlsx/);
  assert.match(view, /\.xls/);
  assert.match(view, /parseSpreadsheetFile/);
  assert.match(parser, /xlsx@0\.18\.5/);
  assert.match(view, /admin\.csv\.steps/);
});

test('CSV export view is manager-gated and does not export private cost data', async () => {
  const [view, apiSource] = await Promise.all([
    readSource(new URL('../admin/js/views/products.js', import.meta.url), 'utf8'),
    readSource(new URL('../admin/js/api.js', import.meta.url), 'utf8'),
  ]);
  assert.match(view, /ctx\.can\('manager'\) \? createCsvTools\(ctx\) : null/);
  assert.match(view, /confirmAction\(t\('admin\.csv\.confirm_import'/);
  const csvApi = apiSource.slice(apiSource.indexOf('export async function listProductsForCsvAdmin'));
  assert.match(csvApi, /inventory\(quantity_on_hand,low_stock_threshold\)/);
  assert.doesNotMatch(csvApi.split('\n\n// ----------')[0], /cost_price/);
});
