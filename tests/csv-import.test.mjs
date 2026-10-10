import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvText, serializeCsvRows, prepareProductImport } from '../admin/js/csv.js';

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
