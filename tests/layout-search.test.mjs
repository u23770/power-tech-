import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../customer/customer.css', import.meta.url), 'utf8');

test('search input and submit button keep the same physical order in RTL', () => {
  assert.match(css, /\.search\s*\{[^}]*direction:\s*ltr\s*;/s);
  assert.match(css, /\[dir=["']rtl["']\]\s+\.search-input\s*\{[^}]*direction:\s*rtl\s*;/s);
});

test('RTL search text remains right-aligned without mirroring the search button', () => {
  assert.match(css, /\[dir=["']rtl["']\]\s+\.search-input\s*\{[^}]*text-align:\s*right\s*;/s);
});
