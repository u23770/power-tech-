// admin/js/router.js — deterministic parsing for hash-based admin routes and filters.

/**
 * Parse an admin hash like "#/orders/<id>?status=pending".
 * The path is decoded separately from the query so filters never become route names.
 */
export function parseAdminHash(hash = '') {
  const source = String(hash || '').replace(/^#/, '');
  const queryIndex = source.indexOf('?');
  const path = queryIndex >= 0 ? source.slice(0, queryIndex) : source;
  const queryString = queryIndex >= 0 ? source.slice(queryIndex + 1) : '';
  const parts = path.replace(/^\/+/, '').split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  return {
    name: parts[0] || 'overview',
    id: parts[1] || null,
    query: new URLSearchParams(queryString),
  };
}
