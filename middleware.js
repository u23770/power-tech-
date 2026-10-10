import { createHmac, timingSafeEqual } from 'node:crypto';
import { next } from '@vercel/functions';

const COOKIE_NAME = 'pt_admin_gate';
const PUBLIC_GATE_PATHS = new Set([
  '/admin/access.html',
  '/admin/access.js',
  '/admin/access.css',
]);

export const config = {
  runtime: 'nodejs',
  matcher: ['/admin', '/admin/:path*'],
};

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
  if (!/^\d{10,12}$/.test(expiryText) || !/^[a-f0-9]{64}$/i.test(signatureText)) return false;
  if (Number(expiryText) <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', secret).update(expiryText).digest();
  const supplied = Buffer.from(signatureText, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function redirectToGate(request, clearCookie = false) {
  const current = new URL(request.url);
  const gate = new URL('/admin/access.html', current.origin);
  gate.searchParams.set('next', current.pathname + current.search);
  const headers = new Headers({
    Location: gate.toString(),
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  });
  if (clearCookie) {
    headers.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  }
  return new Response(null, { status: 303, headers });
}

export default function middleware(request) {
  const url = new URL(request.url);
  if (PUBLIC_GATE_PATHS.has(url.pathname)) {
    return next({ headers: { 'Cache-Control': 'private, no-store' } });
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!process.env.ADMIN_ACCESS_CODE || !secret) {
    return new Response('Admin access is not configured.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const ticket = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (validTicket(ticket, secret)) {
    return next({ headers: { 'Cache-Control': 'private, no-store' } });
  }

  return redirectToGate(request, Boolean(ticket));
}
