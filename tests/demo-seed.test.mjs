import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/0005_seed_demo_products.sql', import.meta.url), 'utf8');

test('demo seed contains 13 clearly labelled bilingual products', () => {
  assert.equal((sql.match(/'DEMO-[A-Z]+-\\d+'/g) || []).filter((value, index, values) => values.indexOf(value) === index).length, 13);
  assert.match(sql, /\\[DEMO\\]/);
  assert.match(sql, /تجريبي/);
});

test('demo seed creates inventory coverage for quantity and individually tracked stock', () => {
  assert.match(sql, /insert into public\\.inventory \\(/i);
  assert.match(sql, /insert into public\\.inventory_units/i);
  assert.match(sql, /'DEMO-SSD-001', 0, 2/);
  assert.match(sql, /'DEMO-GAM-002', 1, 2/);
});

test('demo seed is repeatable and fills auto-created zero defaults without resetting test edits', () => {
  assert.match(sql, /on conflict \\(slug\\) do nothing/i);
  assert.match(sql, /on conflict \\(product_id\\) do update/i);
  assert.match(sql, /existing_inventory\\.quantity_on_hand = 0 and existing_inventory\\.low_stock_threshold = 0/i);
  assert.match(sql, /on conflict \\(internal_ref\\) do nothing/i);
});
