// admin/js/views/stock.js — quantity-tracked stock levels and audited adjustments (adjust_stock RPC).
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, setBusy, errorMessage } from '/shared/ui.js';
import { formatNumber } from '/shared/format.js';
import * as api from '../api.js';

export async function render(main, ctx) {
  const lang = getLang();
  const host = el('div', {}, el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
  main.append(
    el('div', { className: 'page-title' }, el('h1', { className: 'card-title' }, t('admin.nav.stock'))),
    el('p', { className: 'muted' }, t('admin.stock.intro')),
    host);

  const rows = await api.listQuantityStock();
  clear(host);
  if (!rows.length) return host.append(el('p', { className: 'muted' }, t('admin.no_results')));

  const msg = el('div', { className: 'status', attrs: { role: 'status', hidden: true } });
  host.append(msg);
  const lowOrOut = (qty, th) => (qty === 0 ? 'out' : (qty <= th ? 'low' : 'ok'));
  host.append(el('div', { className: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, ...['admin.col.product', 'admin.col.sku', 'admin.col.stock', 'admin.col.threshold', 'admin.col.status', 'admin.col.adjust'].map((k) => el('th', {}, t(k))))),
    el('tbody', {}, ...rows.map((p) => {
      const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      const qty = inv?.quantity_on_hand ?? 0;
      const th = inv?.low_stock_threshold ?? 0;
      const state = lowOrOut(qty, th);
      const delta = el('input', { className: 'input', attrs: { type: 'number', step: '1', inputmode: 'numeric', 'aria-label': t('admin.stock.delta'), placeholder: '+/-', required: 'required', min: '-100000', max: '100000', style: 'width:6rem' } });
      const reason = el('input', { className: 'input', attrs: { type: 'text', 'aria-label': t('admin.stock.reason'), placeholder: t('admin.stock.reason'), minlength: '3', maxlength: '200', style: 'min-width:10rem' } });
      const btn = el('button', { className: 'btn btn-dark btn-small', attrs: { type: 'button' }, on: { click: async () => {
        const d = Number(delta.value);
        if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 100000) return setStatus(msg, t('admin.stock.err_delta'), 'error');
        if (reason.value.trim().length < 3) return setStatus(msg, t('admin.stock.err_reason'), 'error');
        setBusy(btn, true);
        try {
          await api.adjustStock(p.id, d, reason.value.trim());
          setStatus(msg, t('admin.saved'), 'success');
          ctx.refresh();
        } catch (err) {
          setStatus(msg, errorMessage(err), 'error');
        } finally {
          setBusy(btn, false);
        }
      } } }, t('admin.stock.apply'));
      return el('tr', { dataset: { stock: state } },
        el('td', { dataset: { label: t('admin.col.product') } }, el('a', { attrs: { href: `#/products/${p.id}` } }, p.title_en)),
        el('td', { className: 'code', dataset: { label: t('admin.col.sku') } }, p.sku || '—'),
        el('td', { className: 'num', dataset: { label: t('admin.col.stock') } }, formatNumber(qty, lang)),
        el('td', { className: 'num', dataset: { label: t('admin.col.threshold') } }, formatNumber(th, lang)),
        el('td', { dataset: { label: t('admin.col.status') } }, t(`stock.${state === 'out' ? 'out_of_stock' : state === 'low' ? 'low_stock' : 'in_stock'}`)),
        el('td', { dataset: { label: t('admin.col.adjust') } }, el('div', { className: 'table-actions' }, delta, reason, ctx.can('staff') ? btn : null)));
    })))));
  applyI18n(host);
}
