// admin/js/views/orders.js — order list, detail, and status changes (via set_order_status RPC).
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, setBusy, errorMessage, confirmAction } from '/shared/ui.js';
import { formatMoney, formatDateTime } from '/shared/format.js';
import * as api from '../api.js';

const STATUSES = ['pending', 'confirmed', 'processing', 'ready', 'completed', 'cancelled'];
const PAGE = 25;

export async function render(main, ctx) {
  if (ctx.id) return renderDetail(main, ctx, ctx.id);
  return renderList(main, ctx);
}

async function renderList(main, ctx) {
  const lang = getLang();
  const status = ctx.query.get('status') || '';
  const q = ctx.query.get('q') || '';
  const page = Number(ctx.query.get('page') || 0);

  const qInput = el('input', { className: 'input', attrs: { id: 'o-q', type: 'search', name: 'q', value: q, maxlength: '30', placeholder: t('admin.orders.search_hint') } });
  const sSel = el('select', { className: 'select', attrs: { id: 'o-status', name: 'status' } },
    el('option', { attrs: { value: '' } }, t('admin.all')),
    ...STATUSES.map((s) => el('option', { attrs: { value: s, selected: s === status ? 'selected' : null } }, t(`status.${s}`))));
  const form = el('form', { className: 'filter-bar', attrs: { role: 'search' } },
    el('div', { className: 'field' }, el('label', { attrs: { for: 'o-q' } }, t('admin.orders.search')), qInput),
    el('div', { className: 'field' }, el('label', { attrs: { for: 'o-status' } }, t('admin.status')), sSel),
    el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.search')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (qInput.value.trim()) params.set('q', qInput.value.trim());
    if (sSel.value) params.set('status', sSel.value);
    location.hash = `#/orders${params.toString() ? `?${params}` : ''}`;
  });

  const host = el('div', {}, el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
  main.append(el('h1', { className: 'card-title' }, t('admin.nav.orders')), form, host);

  const { rows, count } = await api.listOrdersAdmin({ status, q, page, pageSize: PAGE });
  clear(host);
  if (!rows.length) return host.append(el('p', { className: 'muted' }, t('admin.no_results')));

  host.append(el('div', { className: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, ...['admin.col.reference', 'admin.col.date', 'admin.col.customer', 'admin.col.total', 'admin.col.status'].map((k) => el('th', {}, t(k))))),
    el('tbody', {}, ...rows.map((o) => el('tr', {},
      el('td', { className: 'code', dataset: { label: t('admin.col.reference') } }, el('a', { attrs: { href: `#/orders/${o.id}` } }, o.reference)),
      el('td', { dataset: { label: t('admin.col.date') } }, formatDateTime(o.created_at, lang)),
      el('td', { dataset: { label: t('admin.col.customer') } }, `${o.customer_name} · `, el('span', { className: 'code' }, o.customer_phone)),
      el('td', { className: 'num money', dataset: { label: t('admin.col.total') } }, formatMoney(o.total, o.currency, lang)),
      el('td', { dataset: { label: t('admin.col.status') } }, t(`status.${o.status}`)))))),
  ));
  const last = Math.max(0, Math.ceil(count / PAGE) - 1);
  if (last > 0) {
    const go = (p) => {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      params.set('page', String(p));
      location.hash = `#/orders?${params}`;
    };
    host.append(el('nav', { className: 'pager', attrs: { 'aria-label': t('admin.pagination') } },
      el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button', disabled: page <= 0 ? 'disabled' : null }, on: { click: () => go(page - 1) } }, t('admin.prev')),
      el('span', { className: 'muted' }, t('admin.page_of', { p: page + 1, n: last + 1 })),
      el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button', disabled: page >= last ? 'disabled' : null }, on: { click: () => go(page + 1) } }, t('admin.next'))));
  } else {
    host.append(el('p', { className: 'muted' }, t('admin.count', { n: count })));
  }
  applyI18n(host);
}

async function renderDetail(main, ctx, id) {
  const lang = getLang();
  const { order: o, items, history } = await api.getOrderAdmin(id);
  if (!o) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  const dt = (iso) => formatDateTime(iso, lang);
  const money = (v) => formatMoney(v, o.currency, lang);
  const addr = [o.governorate, o.city, o.area, o.address].filter(Boolean).join(' · ');

  const info = el('section', { className: 'card', attrs: { 'aria-labelledby': 'o-info' } },
    el('h2', { className: 'card-title', attrs: { id: 'o-info' } }, t('admin.order.customer')),
    el('dl', { className: 'kv' },
      el('dt', {}, t('admin.col.customer')), el('dd', {}, o.customer_name),
      el('dt', {}, t('checkout.phone')), el('dd', { className: 'code' }, o.customer_phone),
      el('dt', {}, t('checkout.email')), el('dd', {}, o.customer_email || '—'),
      el('dt', {}, t('checkout.fulfillment')), el('dd', {}, t(`fulfillment.${o.fulfillment}`)),
      el('dt', {}, t('checkout.payment')), el('dd', {}, t(`payment.${o.payment_method}`)),
      el('dt', {}, t('checkout.address')), el('dd', {}, o.fulfillment === 'delivery' ? addr : '—'),
      el('dt', {}, t('checkout.notes')), el('dd', {}, o.notes || '—'),
      o.location_url && /^https:\/\//.test(o.location_url)
        ? [el('dt', {}, t('checkout.location')), el('dd', {}, el('a', { attrs: { href: o.location_url, target: '_blank', rel: 'noopener noreferrer' } }, t('checkout.location')))]
        : null));

  const itemsTable = el('section', { className: 'card', attrs: { 'aria-labelledby': 'o-items' } },
    el('h2', { className: 'card-title', attrs: { id: 'o-items' } }, t('admin.order.items')),
    el('div', { className: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ...['admin.col.product', 'admin.col.qty', 'admin.col.price', 'admin.col.total'].map((k) => el('th', {}, t(k))))),
      el('tbody', {}, ...items.map((it) => el('tr', {},
        el('td', { dataset: { label: t('admin.col.product') } }, (lang === 'ar' && it.title_ar_snapshot) ? it.title_ar_snapshot : it.title_snapshot,
          it.unit_id ? el('small', { className: 'muted code' }, ` · unit ${String(it.unit_id).slice(0, 8)}`) : null),
        el('td', { className: 'num', dataset: { label: t('admin.col.qty') } }, it.quantity),
        el('td', { className: 'num money', dataset: { label: t('admin.col.price') } }, money(it.unit_price)),
        el('td', { className: 'num money', dataset: { label: t('admin.col.total') } }, money(it.line_total))))))),
    el('dl', { className: 'kv' },
      el('dt', {}, t('checkout.subtotal')), el('dd', { className: 'num money' }, money(o.subtotal)),
      el('dt', {}, t('checkout.discount')), el('dd', { className: 'num money' }, money(o.discount_total)),
      el('dt', {}, t('checkout.fee')), el('dd', { className: 'num money' }, money(o.delivery_fee)),
      el('dt', {}, t('checkout.total')), el('dd', { className: 'num money' }, el('strong', {}, money(o.total)))));

  const historyList = el('section', { className: 'card', attrs: { 'aria-labelledby': 'o-hist' } },
    el('h2', { className: 'card-title', attrs: { id: 'o-hist' } }, t('admin.order.history')),
    el('ol', { className: 'item-list' }, ...history.map((h) => el('li', {},
      `${dt(h.created_at)} — ${h.from_status ? t(`status.${h.from_status}`) + ' → ' : ''}${t(`status.${h.to_status}`)}`,
      h.note ? el('span', { className: 'muted' }, ` (${h.note})`) : null))));

  const statusBox = el('section', { className: 'card', attrs: { 'aria-labelledby': 'o-status' } },
    el('h2', { className: 'card-title', attrs: { id: 'o-status' } }, t('admin.order.change_status')),
    el('p', {}, t('admin.order.current'), ': ', el('strong', {}, t(`status.${o.status}`))));
  const msg = el('div', { className: 'status', attrs: { role: 'status', hidden: true } });

  const terminal = o.status === 'completed' || o.status === 'cancelled';
  if (ctx.can('staff') && !terminal) {
    const next = el('select', { className: 'select', attrs: { id: 'o-next', name: 'to', 'aria-label': t('admin.order.change_status') } },
      ...STATUSES.filter((s) => s !== o.status).map((s) => el('option', { attrs: { value: s } }, t(`status.${s}`))));
    const note = el('input', { className: 'input', attrs: { id: 'o-note', name: 'note', maxlength: '500', placeholder: t('admin.order.note') } });
    const submit = el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.order.apply'));
    const f = el('form', { className: 'form' },
      el('div', { className: 'field' }, el('label', { attrs: { for: 'o-next' } }, t('admin.order.new_status')), next),
      el('div', { className: 'field' }, el('label', { attrs: { for: 'o-note' } }, t('admin.order.note')), note),
      submit);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const to = next.value;
      if (to === 'cancelled' && !(await confirmAction(t('admin.order.cancel_confirm')))) return;
      setBusy(submit, true);
      try {
        await api.setOrderStatus(id, to, note.value.trim() || null);
        setStatus(msg, t('admin.saved'), 'success');
        ctx.refresh();
      } catch (err) {
        setStatus(msg, errorMessage(err), 'error');
      } finally {
        setBusy(submit, false);
      }
    });
    statusBox.append(f);
  } else if (terminal) {
    statusBox.append(el('p', { className: 'muted' }, t('admin.order.terminal')));
  }
  statusBox.append(msg);

  main.append(
    el('div', { className: 'page-title' },
      el('h1', { className: 'card-title code' }, o.reference),
      el('a', { className: 'btn btn-ghost btn-small', attrs: { href: '#/orders' } }, t('admin.back'))),
    el('p', { className: 'muted' }, `${t('admin.col.date')}: ${dt(o.created_at)}`),
    el('div', { className: 'two-col' },
      el('div', {}, info, itemsTable, historyList),
      el('div', {}, statusBox)));
  applyI18n(main);
}
