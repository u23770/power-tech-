import test from 'node:test';
import assert from 'node:assert/strict';
import gate from '../api/admin-access.mjs';

const originalCode = process.env.ADMIN_ACCESS_CODE;
const originalSecret = process.env.ADMIN_SESSION_SECRET;
const secret = 'test-only-session-secret-that-is-long-enough';

function configure() {
  process.env.ADMIN_ACCESS_CODE = 'PTX-7QTM-JDLX';
  process.env.ADMIN_SESSION_SECRET = secret;
}

function request(method = 'GET', body, cookie, ip = '198.51.100.' + Math.floor(Math.random() * 200 + 1)) {
  const headers = new Headers({ host: 'power-tech-u23770.vercel.app', 'x-forwarded-for': ip });
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    headers.set('origin', 'https://power-tech-u23770.vercel.app');
  }
  if (cookie) headers.set('cookie', cookie);
  return new Request('https://power-tech-u23770.vercel.app/api/admin-access', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function restoreEnv() {
  if (originalCode === undefined) delete process.env.ADMIN_ACCESS_CODE;
  else process.env.ADMIN_ACCESS_CODE = originalCode;
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
}

test('rejects an incorrect access code without issuing a cookie', async () => {
  configure();
  const response = await gate.fetch(request('POST', { code: 'wrong' }, null, '198.51.100.11'));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  await restoreEnv();
});

test('issues an HttpOnly, Secure, SameSite=Strict cookie for the correct code', async () => {
  configure();
  const response = await gate.fetch(request('POST', { code: 'PTX-7QTM-JDLX' }, null, '198.51.100.12'));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /pt_admin_gate=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\//);
  await restoreEnv();
});

test('valid signed cookie authorizes the gate status endpoint', async () => {
  configure();
  const issued = await gate.fetch(request('POST', { code: 'PTX-7QTM-JDLX' }, null, '198.51.100.13'));
  const token = (issued.headers.get('set-cookie') || '').split(';')[0];
  const response = await gate.fetch(request('GET', undefined, token, '198.51.100.14'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await restoreEnv();
});

test('rejects a tampered signed cookie', async () => {
  configure();
  const issued = await gate.fetch(request('POST', { code: 'PTX-7QTM-JDLX' }, null, '198.51.100.15'));
  const token = (issued.headers.get('set-cookie') || '').split(';')[0];
  const bad = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
  const response = await gate.fetch(request('GET', undefined, bad, '198.51.100.16'));
  assert.equal(response.status, 401);
  await restoreEnv();
});

test('fails closed when the server-side code or session secret is missing', async () => {
  delete process.env.ADMIN_ACCESS_CODE;
  delete process.env.ADMIN_SESSION_SECRET;
  const response = await gate.fetch(request('POST', { code: 'PTX-7QTM-JDLX' }, null, '198.51.100.17'));
  assert.equal(response.status, 503);
  await restoreEnv();
});
