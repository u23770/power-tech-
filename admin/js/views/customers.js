// admin/js/views/customers.js — staff-only directory for accounts and guest checkout contacts.
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear } from '/shared/ui.js';
import { formatMoney, formatDateTime, formatNumber } from '/shared/format.js';
import * as api from '../api.js';

const PAGE = 25;
const KINDS = ['all', 'registered', 'guest'];

export async function render(main, ctx) {
  const lang = getLang();
  const q = String(ctx.query.get('q') || '').slice(0, 100);
  const kind = KINDS.includes(ctx.query.get('kind')) ? ctx.query.get('kind') : 'all';
  const page = Math.max(0, Math.floor(Number(ctx.query.get('page')) || 0));

  const qInput = el('input', {
    className: 'input',
    attrs: {
      id: 'c-q',
      type: 'search',
      name: 'q',
      value: q,
      maxlength: '100',
      placeholder: t('admin.customers.search'),
    },
  });
  const kindSelect = el('select', {
    className: 'select',
    attrs: { id: 'c-kind', name: 'kind' },
  }, ...KINDS.map((value) => el('option', {
    attrs: { value, selected: value === kind ? 'selected' : null },
  }, t(value === 'all' ? 'admin.customers.all' : `admin.customers.${value}`))));

  const form = el('form', { className: 'filter-bar', attrs: { role: 'search' } },
    el('div', { className: 'field' },
      el('label', { attrs: { for: 'c-q' } }, t('admin.customers.search')),
      qInput),
    el('div', { className: 'field' },
      el('label', { attrs: { for: 'c-kind' } }, t('admin.customers.kind')),
      kindSelect),
    el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.search')));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (qInput.value.trim()) params.set('q', qInput.value.trim().slice(0, 100));
    if (kindSelect.value && kindSelect.value !== 'all') params.set('kind', kindSelect.value);
    location.hash = `#/customers${params.toString() ? `?${params}` : ''}`;
  });

  const host = el('div', {},
    el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
  main.append(
    el('h1', { className: 'card-title' }, t('admin.customers.title')),
    el('p', { className: 'muted' }, t('admin.customers.intro')),
    form,
    host,
  );

  const { rows, count } = await api.listCustomersAdmin({ q, kind, page, pageSize: PAGE });
  clear(host);

  if (!rows.length) {
    host.append(el('p', { className: 'muted' }, t('admin.no_results')));
    host.append(el('p', { className: 'muted' }, t('admin.count', { n: formatNumber(count, lang) })));
    applyI18n(main);
    return;
  }

  const headings = [
    'admin.customers.name',
    'admin.customers.contact',
    'admin.customers.kind',
    'admin.customers.orders',
    'admin.customers.spend',
    'admin.customers.last_order',
    'admin.customers.created',
  ];
  const table = el('table', {},
    el('thead', {}, el('tr', {}, ...headings.map((key) => el('th', {}, t(key))))),
    el('tbody', {}, ...rows.map((customer) => {
      const name = customer.full_name || t('admin.customers.unnamed');
      const contact = el('td', {
        dataset: { label: t('admin.customers.contact') },
      },
      customer.phone || '—',
      customer.email ? el('div', { className: 'muted' }, customer.email) : null);

      const lastOrder = customer.last_order_id
        ? el('a', {
          attrs: { href: `#/orders/${encodeURIComponent(customer.last_order_id)}` },
        }, customer.last_order_at ? formatDateTime(customer.last_order_at, lang) : t('admin.customers.no_orders'))
        : t('admin.customers.no_orders');

      return el('tr', {},
        el('td', { dataset: { label: t('admin.customers.name') } }, name),
        contact,
        el('td', { dataset: { label: t('admin.customers.kind') } },
          t(customer.is_registered ? 'admin.customers.registered' : 'admin.customers.guest')),
        el('td', { className: 'num', dataset: { label: t('admin.customers.orders') } },
          formatNumber(customer.order_count, lang)),
        el('td', { className: 'num money', dataset: { label: t('admin.customers.spend') } },
          formatMoney(customer.lifetime_value, 'EGP', lang)),
        el('td', { dataset: { label: t('admin.customers.last_order') } }, lastOrder),
        el('td', { dataset: { label: t('admin.customers.created') } },
          formatDateTime(customer.created_at, lang)),
      );
    })));

  host.append(el('div', { className: 'table-wrap' }, table));

  const lastPage = Math.max(0, Math.ceil(count / PAGE) - 1);
  const pager = el('nav', {
    className: 'pager',
    attrs: { 'aria-label': t('admin.pagination') },
  },
  el('button', {
    className: 'btn btn-ghost btn-small',
    attrs: { type: 'button', disabled: page <= 0 ? 'disabled' : null },
    on: { click: () => navigatePage(page - 1) },
  }, t('admin.prev')),
  el('span', { className: 'muted' }, t('admin.page_of', { p: page + 1, n: lastPage + 1 })),
  el('button', {
    className: 'btn btn-ghost btn-small',
    attrs: { type: 'button', disabled: page >= lastPage ? 'disabled' : null },
    on: { click: () => navigatePage(page + 1) },
  }, t('admin.next')));
  host.append(pager, el('p', { className: 'muted' }, t('admin.count', { n: formatNumber(count, lang) })));
  applyI18n(main);
}

function navigatePage(page) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (page <= 0) params.delete('page');
  else params.set('page', String(page));
  location.hash = `#/customers${params.toString() ? `?${params}` : ''}`;
}
