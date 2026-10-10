import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const app = await read('../admin/js/app.js');
const api = await read('../admin/js/api.js');
const i18n = await read('../shared/i18n.js');
const customers = await read('../admin/js/views/customers.js');
const migration = await read('../supabase/migrations/0006_admin_customer_directory.sql');

test('customer directory is routed for authorized staff, not public users', () => {
  assert.match(app, /customers:\s*\{\s*min:\s*'staff',\s*view:\s*\(\)\s*=>\s*import\('\.\/views\/customers\.js'\)\s*\}/);
});

test('customer API calls a bounded staff-only database directory RPC', () => {
  assert.match(api, /export async function listCustomersAdmin\([\s\S]*?rpc\('admin_customer_directory'/);
  assert.match(api, /const safePageSize = Math\.min\(Math\.max\(Number\(pageSize\) \|\| 25, 1\), 100\)/);
  assert.match(api, /p_page_size:\\s*safePageSize/);
});

test('directory query excludes anonymous auth sessions and store staff', () => {
  assert.match(migration, /perform public\.assert_staff\('staff'\)/);
  assert.match(migration, /u\.is_anonymous\s*=\s*false/);
  assert.match(migration, /left join public\.staff_roles/);
  assert.match(migration, /revoke all on function public\.admin_customer_directory\([\s\S]*?from anon/);
  assert.match(migration, /grant execute on function public\.admin_customer_directory\([\s\S]*?to authenticated/);
  assert.match(migration, /user_id is null/);
});

test('customer list supports search, customer type filtering, paging, and order links', () => {
  assert.match(customers, /admin\.customers\.search/);
  assert.match(customers, /admin\.customers\.kind/);
  assert.match(customers, /admin\.prev/);
  assert.match(customers, /admin\.next/);
  assert.match(customers, /#\/orders\//);
  assert.match(customers, /listCustomersAdmin/);
});

test('customer directory labels are localized in Arabic and English', () => {
  for (const key of [
    'admin.nav.customers',
    'admin.customers.title',
    'admin.customers.name',
    'admin.customers.search',
    'admin.customers.kind',
    'admin.customers.all',
    'admin.customers.registered',
    'admin.customers.guest',
    'admin.customers.orders',
    'admin.customers.spend',
    'admin.customers.last_order',
    'admin.customers.created',
    'admin.customers.no_orders',
  ]) {
    assert.ok(i18n.split(`'${key}':`).length - 1 >= 2, `expected Arabic and English translations for: ${key}`);
  }
});
