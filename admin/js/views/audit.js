// admin/js/views/audit.js — recent audit trail (manager and owner only; enforced by RLS audit_manager_read).
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear } from '/shared/ui.js';
import { formatDateTime } from '/shared/format.js';
import * as api from '../api.js';

export async function render(main) {
  const lang = getLang();
  const host = el('div', {}, el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
  main.append(
    el('h1', { className: 'card-title' }, t('admin.nav.audit')),
    el('p', { className: 'muted' }, t('admin.audit.intro')),
    host);
  const rows = await api.listAudit({ limit: 100 });
  clear(host);
  if (!rows.length) return host.append(el('p', { className: 'muted' }, t('admin.no_results')));
  host.append(el('div', { className: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, ...['admin.col.date', 'admin.audit.action', 'admin.audit.entity', 'admin.audit.entity_id', 'admin.audit.actor'].map((k) => el('th', {}, t(k))))),
    el('tbody', {}, ...rows.map((r) => el('tr', {},
      el('td', { dataset: { label: t('admin.col.date') } }, formatDateTime(r.created_at, lang)),
      el('td', { className: 'code', dataset: { label: t('admin.audit.action') } }, r.action),
      el('td', { dataset: { label: t('admin.audit.entity') } }, r.entity),
      el('td', { className: 'code', dataset: { label: t('admin.audit.entity_id') } }, r.entity_id || '—'),
      el('td', { className: 'code', dataset: { label: t('admin.audit.actor') } }, r.actor_id ? String(r.actor_id).slice(0, 8) : '—')))))));
  applyI18n(main);
}
