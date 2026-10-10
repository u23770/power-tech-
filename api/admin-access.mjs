import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'pt_admin_gate';
const SESSION_SECONDS = 6 * 60 * 60;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const attempts = new Map();

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

function signExpiry(expiry, secret) {
  return createHmac('sha256', secret).update(String(expiry)).digest('hex');
}

function validTicket(value, secret) {
  if (!value || !secret) return false;
  const split = value.split('.');
  if (split.length !== 2) return false;
  const [expiryText, signatureText] = split;
  if (!/^\d{10,12}$/.test(expiryText) || !/^[a-f0-9]{64}$/i.test(signatureText)) return false;
  if (Number(expiryText) <= Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signExpiry(expiryText, secret), 'hex');
  const supplied = Buffer.from(signatureText, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sameSecret(supplied, expected) {
  const actualHash = createHash('sha256').update(supplied).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function requestIp(request) {
  return (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 80);
}

function getFailures(ip, now) {
  const recent = (attempts.get(ip) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length) attempts.set(ip, recent);
  else attempts.delete(ip);
  return recent;
}

function cleanupAttempts(now) {
  if (attempts.size < 5000) return;
  for (const [ip, timestamps] of attempts) {
    if (!timestamps.some((timestamp) => now - timestamp < RATE_WINDOW_MS)) attempts.delete(ip);
  }
  while (attempts.size >= 5000) attempts.delete(attempts.keys().next().value);
}

async function handle(request) {
  const accessCode = process.env.ADMIN_ACCESS_CODE;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!accessCode || !sessionSecret) {
    return json(503, { ok: false, error: 'not_configured' });
  }

  if (request.method === 'GET') {
    const ticket = readCookie(request.headers.get('cookie'), COOKIE_NAME);
    return validTicket(ticket, sessionSecret)
      ? json(200, { ok: true })
      : json(401, { ok: false, error: 'access_required' });
  }

  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, POST' });
  }

  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return json(403, { ok: false, error: 'origin_rejected' });
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4096) return json(413, { ok: false, error: 'request_too_large' });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const code = typeof payload?.code === 'string' ? payload.code.trim() : '';
  if (!code || code.length > 128) {
    return json(401, { ok: false, error: 'invalid_code' });
  }

  const now = Date.now();
  const ip = requestIp(request);
  const recentFailures = getFailures(ip, now);
  if (recentFailures.length >= MAX_FAILURES) {
    return json(429, { ok: false, error: 'too_many_attempts', retryAfterSeconds: Math.ceil((recentFailures[0] + RATE_WINDOW_MS - now) / 1000) });
  }

  if (!sameSecret(code, accessCode)) {
    cleanupAttempts(now);
    attempts.set(ip, [...recentFailures, now]);
    return json(401, { ok: false, error: 'invalid_code' });
  }

  attempts.delete(ip);
  const expiry = Math.floor(now / 1000) + SESSION_SECONDS;
  const ticket = `${expiry}.${signExpiry(expiry, sessionSecret)}`;
  const cookie = `${COOKIE_NAME}=${ticket}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
  return json(200, { ok: true }, { 'Set-Cookie': cookie });
}

export default { fetch: handle };
