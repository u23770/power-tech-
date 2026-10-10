import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminHash } from '../admin/js/router.js';

test('overview date-range query keeps overview as route and parses both dates', () => {
  const parsed = parseAdminHash('#/overview?from=2026-10-01&to=2026-10-10');
  assert.equal(parsed.name, 'overview');
  assert.equal(parsed.id, null);
  assert.equal(parsed.query.get('from'), '2026-10-01');
  assert.equal(parsed.query.get('to'), '2026-10-10');
});

test('query filters do not become part of route names', () => {
  const parsed = parseAdminHash('#/orders?status=pending&page=2');
  assert.equal(parsed.name, 'orders');
  assert.equal(parsed.query.get('status'), 'pending');
  assert.equal(parsed.query.get('page'), '2');
});

test('nested route IDs are parsed independently of query strings', () => {
  const parsed = parseAdminHash('#/orders/order-123?tab=history');
  assert.equal(parsed.name, 'orders');
  assert.equal(parsed.id, 'order-123');
  assert.equal(parsed.query.get('tab'), 'history');
});
