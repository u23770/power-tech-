// admin/js/views/overview.js — KPI summary for a chosen date range (admin_dashboard_summary RPC, staff only).
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, errorMessage } from '/shared/ui.js';
import { formatMoney, formatNumber } from '/shared/format.js';
import * as api from '../api.js';

// Date inputs are interpreted in the browser's local timezone (the store operates in Africa/Cairo).
function startOfDayIso(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}
function dayAfterIso(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}
function isoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function render(main, ctx) {
  const lang = getLang();
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(today.getDate() - 29);
  const from = ctx.query.get('from') || isoDate(monthAgo);
  const to = ctx.query.get('to') || isoDate(today);

  const rangeMsg = el('p', { className: 'status', attrs: { role: 'alert', 'aria-live': 'polite' }, dataset: { kind: 'error' } });
  const fromIn = el('input', { className: 'input', attrs: { type: 'date', id: 'ov-from', name: 'from', value: from, required: 'required' } });
  const toIn = el('input', { className: 'input', attrs: { type: 'date', id: 'ov-to', name: 'to', value: to, required: 'required' } });
  const form = el('form', { className: 'filter-bar', attrs: { role: 'search' } },
    el('div', { className: 'field' }, el('label', { attrs: { for: 'ov-from' } }, t('admin.overview.from')), fromIn),
    el('div', { className: 'field' }, el('label', { attrs: { for: 'ov-to' } }, t('admin.overview.to')), toIn),
    el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.overview.apply')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) {
      return setStatus(rangeMsg, t('admin.overview.bad_range'), 'error');
    }
    location.hash = `#/overview?from=${fromIn.value}&to=${toIn.value}`;
  });

  const host = el('div', {}, el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
  main.append(el('h1', { className: 'card-title' }, t('admin.nav.overview')), form, rangeMsg, host);

  try {
    const s = await api.dashboardSummary(startOfDayIso(from), dayAfterIso(to));
    clear(host);
    const kpi = (label, value, href) => el('div', { className: 'card' },
      el('div', { className: 'muted' }, label),
      el('div', { className: 'money', style: 'font-size:1.6rem;font-weight:700' }, value),
      href ? el('a', { attrs: { href } }, t('admin.view')) : null);
    host.append(
      el('div', { className: 'kpi-grid' },
        kpi(t('admin.kpi.orders'), formatNumber(s.orders_total, lang), '#/orders'),
        kpi(t('admin.kpi.pending'), formatNumber(s.orders_pending, lang), '#/orders?status=pending'),
        kpi(t('admin.kpi.cancelled'), formatNumber(s.orders_cancelled, lang), '#/orders?status=cancelled'),
        kpi(t('admin.kpi.sales'), formatMoney(s.sales_total, 'EGP', lang)),
        kpi(t('admin.kpi.low_stock'), formatNumber(s.low_stock, lang), '#/stock'),
        kpi(t('admin.kpi.out_of_stock'), formatNumber(s.out_of_stock, lang), '#/stock')),
      el('p', { className: 'muted' }, t('admin.overview.note')),
      );
  } catch (err) {
    clear(host);
    host.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, errorMessage(err)));
  }
  applyI18n(main);
}
