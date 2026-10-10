import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'pt_admin_gate';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private, max-age=0',
      'X-Content-Type-Options': 'nosniff',
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

function validTicket(value, secret) {
  if (!value || !secret) return false;
  const split = value.split('.');
  if (split.length !== 2) return false;
  const [expiryText, signatureText] = split;
  if (!/^\\d{10,12}$/.test(expiryText) || !/^[a-f0-9]{64}$/i.test(signatureText)) return false;
  if (Number(expiryText) <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', secret).update(String(expiryText)).digest();
  const supplied = Buffer.from(signatureText, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function handle(request) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return json(403, { ok: false, error: 'origin_rejected' });
  }

  if (!validTicket(readCookie(request.headers.get('cookie'), COOKIE_NAME), process.env.ADMIN_SESSION_SECRET)) {
    return json(401, { ok: false, error: 'access_required' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl.startsWith('https://') || !anonKey || !serviceRoleKey) {
    return json(503, { ok: false, error: 'not_configured' });
  }

  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\\s+(.+)$/i);
  if (!match) return json(401, { ok: false, error: 'session_required' });

  let userResponse;
  try {
    userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${match[1]}` },
      cache: 'no-store',
    });
  } catch {
    return json(502, { ok: false, error: 'auth_unavailable' });
  }
  if (!userResponse.ok) return json(401, { ok: false, error: 'session_invalid' });

  let user;
  try {
    user = await userResponse.json();
  } catch {
    return json(401, { ok: false, error: 'session_invalid' });
  }
  if (typeof user?.id !== 'string' || user.is_anonymous !== true) {
    return json(403, { ok: false, error: 'anonymous_session_required' });
  }

  let roleResponse;
  try {
    roleResponse = await fetch(`${supabaseUrl}/rest/v1/staff_roles?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ user_id: user.id, role: 'owner' }),
      cache: 'no-store',
    });
  } catch {
    return json(502, { ok: false, error: 'role_unavailable' });
  }
  if (!roleResponse.ok) return json(502, { ok: false, error: 'role_unavailable' });

  return json(200, { ok: true, role: 'owner' });
}

export default { fetch: handle };
