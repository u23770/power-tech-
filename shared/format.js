// shared/format.js — display formatting only. Totals are computed by the database, never here.

const TZ = 'Africa/Cairo';

/** Format a numeric amount (Supabase returns numeric as strings; Number() is for display only). */
export function formatMoney(amount, currency = 'EGP', lang = 'en') {
  const n = Number(amount);
  if (amount === null || amount === undefined || !Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Invalid currency code from settings: show the number with the code rather than failing the page.
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function formatDateTime(iso, lang = 'en') {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TZ,
  }).format(new Date(iso));
}

export function formatNumber(n, lang = 'en') {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(Number(n) || 0);
}

/** Build a shareable product URL on the current origin. */
export function productUrl(slug) {
  return new URL(`/customer/product.html?slug=${encodeURIComponent(slug)}`, window.location.origin).href;
}
