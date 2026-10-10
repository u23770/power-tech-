import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import endpoint from '../api/admin-session.mjs';

const original = {
  secret: process.env.ADMIN_SESSION_SECRET,
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  fetch: globalThis.fetch,
};

function configure() {
  process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-that-is-long-enough';
  process.env.SUPABASE_URL = 'https://project-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
}

function cookie() {
  const expiry = String(Math.floor(Date.now() / 1000) + 600);
  const signature = createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(expiry).digest('hex');
  return `pt_admin_gate=${expiry}.${signature}`;
}

function request({ access = cookie(), token = 'test-jwt', method = 'POST' } = {}) {
  return new Request('https://power-tech-u23770.vercel.app/api/admin-session', {
    method,
    headers: {
      origin: 'https://power-tech-u23770.vercel.app',
      cookie: access,
      authorization: `Bearer ${token}`,
    },
    body: method === 'POST' ? '{}' : undefined,
  });
}

test('requires a valid access-code cookie before provisioning an admin session', async () => {
  configure();
  const response = await endpoint.fetch(request({ access: 'pt_admin_gate=invalid' }));
  assert.equal(response.status, 401);
});

test('requires server-side Supabase credentials', async () => {
  configure();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await endpoint.fetch(request());
  assert.equal(response.status, 503);
});

test('grants owner role only to a verified anonymous Supabase user', async () => {
  configure();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'anon-user-id', is_anonymous: true }), { status: 200 });
    }
    return new Response(null, { status: 204 });
  };

  const response = await endpoint.fetch(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, role: 'owner' });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /staff_roles\\?on_conflict=user_id$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-service-role-key');
  assert.deepEqual(JSON.parse(calls[1].options.body), { user_id: 'anon-user-id', role: 'owner' });
});

test('rejects a non-anonymous Supabase user', async () => {
  configure();
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'normal-user', is_anonymous: false }), { status: 200 });
  const response = await endpoint.fetch(request());
  assert.equal(response.status, 403);
});

test.after(() => {
  if (original.secret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = original.secret;
  if (original.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = original.url;
  if (original.anon === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = original.anon;
  if (original.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = original.service;
  globalThis.fetch = original.fetch;
});
