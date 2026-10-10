// admin/js/views/coupons.js — coupon creation, editing and lifecycle controls.
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, setBusy, confirmAction, errorMessage } from '/shared/ui.js';
import { formatMoney } from '/shared/format.js';
import * as api from '../api.js';

const money = (value, lang) => formatMoney(Number(value || 0), 'EGP', lang);
const localDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const toStart = (value) => value ? new Date(`${value}T00:00:00`).toISOString() : null;
const toEnd = (value) => value ? new Date(`${value}T23:59:59.999`).toISOString() : null;

function field(id, label, value, attrs = {}) {
  const input = el('input', { className: 'input', attrs: { id, name: id, value: value ?? '', ...attrs } });
  return { input, field: el('div', { className: 'field' }, el('label', { attrs: { for: id } }, label), input) };
}
function check(id, label, checked) {
  const input = el('input', { attrs: { id, name: id, type: 'checkbox', checked: checked ? 'checked' : null } });
  return { input, field: el('label', { className: 'checkbox-row', attrs: { for: id } }, input, label) };
}

export async function render(main, ctx) {
  const msg = el('div', { className: 'status', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });
  const host = el('div', { className: 'stack' });
  const productDiscountGuide = el('section', { className: 'card stack' },
    el('h2', { className: 'card-title' }, t('admin.coupons.product_discounts')),
    el('p', { className: 'muted' }, t('admin.coupons.product_discounts_help')),
    el('a', { className: 'btn btn-ghost', attrs: { href: '#/products' } }, t('admin.coupons.open_products')),
    el('p', { className: 'hint' }, t('admin.coupons.steps')));
  main.append(
    el('div', { className: 'page-title' }, el('h1', { className: 'card-title' }, t('admin.nav.coupons'))),
    el('p', { className: 'muted' }, t('admin.coupons.intro')),
    productDiscountGuide,
    msg, host
  );

  let editingId = null;
  let rows = [];
  const code = field('cp-code', t('admin.coupons.code'), '', { required: 'required', minlength: '3', maxlength: '32', pattern: '[A-Z0-9_-]{3,32}', autocomplete: 'off' });
  const kind = el('select', { className: 'select', attrs: { id: 'cp-kind', name: 'kind' } },
    el('option', { attrs: { value: 'percent' } }, t('admin.coupons.percent')),
    el('option', { attrs: { value: 'fixed' } }, t('admin.coupons.fixed')));
  const value = field('cp-value', t('admin.coupons.value'), '', { type: 'number', min: '0.01', max: '100', step: '0.01', required: 'required' });
  const min = field('cp-min', t('admin.coupons.min_subtotal'), '0', { type: 'number', min: '0', step: '0.01', required: 'required' });
  const starts = field('cp-starts', t('admin.coupons.starts'), '', { type: 'date' });
  const ends = field('cp-ends', t('admin.coupons.ends'), '', { type: 'date' });
  const max = field('cp-max', t('admin.coupons.max'), '', { type: 'number', min: '1', step: '1' });
  const first = check('cp-first', t('admin.coupons.first_order_only'), false);
  const sale = check('cp-sale', t('admin.coupons.applies_sale'), false);
  const saveBtn = el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.coupons.create'));
  const cancelBtn = el('button', { className: 'btn btn-ghost', attrs: { type: 'button', hidden: 'hidden' }, on: { click: () => clearForm() } }, t('admin.cancel'));
  const formTitle = el('h2', {}, t('admin.coupons.form_title'));
  const form = el('form', { className: 'card form' },
    formTitle,
    el('div', { className: 'form-grid two' }, code.field,
      el('div', { className: 'field' }, el('label', { attrs: { for: kind.id || 'cp-kind' } }, t('admin.coupons.type')), kind),
      value.field, min.field, starts.field, ends.field, max.field, first.field, sale.field),
    el('div', { className: 'form-actions' }, saveBtn, cancelBtn));

  code.input.addEventListener('input', () => { code.input.value = code.input.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32); });
  kind.addEventListener('change', () => { value.input.max = kind.value === 'percent' ? '100' : '1000000000'; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const amount = Number(value.input.value);
    const minimum = Number(min.input.value);
    const maximumUses = max.input.value.trim() ? Number(max.input.value) : null;
    if (!Number.isFinite(amount) || amount <= 0 || (kind.value === 'percent' && amount > 100)) {
      return setStatus(msg, t('admin.coupons.invalid_value'), 'error');
    }
    if (!Number.isFinite(minimum) || minimum < 0) return setStatus(msg, t('admin.coupons.invalid_min'), 'error');
    if (maximumUses !== null && (!Number.isInteger(maximumUses) || maximumUses < 1)) {
      return setStatus(msg, t('admin.coupons.invalid_max'), 'error');
    }
    if (starts.input.value && ends.input.value && starts.input.value > ends.input.value) {
      return setStatus(msg, t('admin.coupons.invalid_window'), 'error');
    }
    const payload = {
      code: code.input.value.trim().toUpperCase(),
      kind: kind.value,
      value: amount,
      min_subtotal: minimum,
      starts_at: toStart(starts.input.value),
      ends_at: toEnd(ends.input.value),
      max_redemptions: maximumUses,
      first_order_only: first.input.checked,
      applies_to_sale_items: sale.input.checked,
    };
    setBusy(saveBtn, true);
    try {
      if (editingId) await api.updateCouponAdmin(editingId, payload);
      else await api.insertCouponAdmin({ ...payload, is_active: true });
      setStatus(msg, t(editingId ? 'admin.coupons.updated' : 'admin.coupons.created'), 'success');
      clearForm();
      await reload();
    } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
    finally { setBusy(saveBtn, false); }
  });

  function clearForm() {
    editingId = null;
    form.reset();
    min.input.value = '0';
    kind.value = 'percent';
    value.input.max = '100';
    saveBtn.textContent = t('admin.coupons.create');
    formTitle.textContent = t('admin.coupons.form_title');
    cancelBtn.hidden = true;
    code.input.focus();
    applyI18n(form);
  }

  function editRow(coupon) {
    editingId = coupon.id;
    code.input.value = coupon.code;
    kind.value = coupon.kind;
    value.input.value = coupon.value;
    value.input.max = coupon.kind === 'percent' ? '100' : '1000000000';
    min.input.value = coupon.min_subtotal;
    starts.input.value = localDate(coupon.starts_at);
    ends.input.value = localDate(coupon.ends_at);
    max.input.value = coupon.max_redemptions ?? '';
    first.input.checked = coupon.first_order_only;
    sale.input.checked = coupon.applies_to_sale_items;
    saveBtn.textContent = t('admin.coupons.update');
    formTitle.textContent = t('admin.coupons.edit_title');
    cancelBtn.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    code.input.focus();
  }

  async function reload() {
    clear(host);
    host.append(el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
    try {
      rows = await api.listCouponsAdmin();
      clear(host);
      const list = el('section', { className: 'card stack' }, el('h2', {}, `${t('admin.coupons.saved')} (${rows.length})`));
      if (!rows.length) list.append(el('p', { className: 'muted' }, t('admin.coupons.empty')));
      const lang = getLang();
      for (const coupon of rows) {
        const status = couponStatus(coupon);
        const details = [
          `${coupon.kind === 'percent' ? t('admin.coupons.percent') : t('admin.coupons.fixed')}: ${coupon.kind === 'percent' ? `${coupon.value}%` : money(coupon.value, lang)}`,
          `${t('admin.coupons.min_subtotal')}: ${money(coupon.min_subtotal, lang)}`,
          `${t('admin.coupons.redemptions')}: ${coupon.redemptions_count}${coupon.max_redemptions ? ` / ${coupon.max_redemptions}` : ''}`,
        ].join(' · ');
        const actions = el('div', { className: 'table-actions' },
          el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: () => editRow(coupon) } }, t('admin.edit')),
          el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: async () => {
            try {
              await api.setCouponActiveAdmin(coupon.id, !coupon.is_active);
              setStatus(msg, t(coupon.is_active ? 'admin.coupons.paused_msg' : 'admin.coupons.activated_msg'), 'success');
              await reload();
            } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
          } } }, t(coupon.is_active ? 'admin.coupons.pause' : 'admin.coupons.activate')),
          el('button', { className: 'btn btn-danger btn-small', attrs: { type: 'button', disabled: Number(coupon.redemptions_count) > 0, title: Number(coupon.redemptions_count) > 0 ? t('admin.coupons.delete_used_hint') : '' }, on: { click: async () => {
            if (Number(coupon.redemptions_count) > 0) return;
            if (!(await confirmAction(t('admin.coupons.delete_confirm')))) return;
            try { await api.deleteCouponAdmin(coupon.id); setStatus(msg, t('admin.coupons.deleted'), 'success'); await reload(); }
            catch (err) { setStatus(msg, errorMessage(err), 'error'); }
          } } }, t('admin.delete')));
        list.append(el('article', { className: 'card' },
          el('div', { className: 'toolbar-admin' },
            el('div', {}, el('h3', { className: 'code' }, coupon.code), el('p', { className: 'muted' }, details)),
            el('span', { className: 'badge', dataset: { kind: status === 'active' ? 'success' : 'muted' } }, t(`admin.coupons.status.${status}`))),
          el('div', { className: 'row' }, actions)));
      }
      host.append(list);
      applyI18n(host);
    } catch (err) {
      clear(host);
      host.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, errorMessage(err)));
    }
  }

  function couponStatus(c) {
    if (!c.is_active) return 'paused';
    const now = Date.now();
    if (c.starts_at && new Date(c.starts_at).getTime() > now) return 'scheduled';
    if (c.ends_at && new Date(c.ends_at).getTime() < now) return 'expired';
    if (c.max_redemptions && c.redemptions_count >= c.max_redemptions) return 'used_up';
    return 'active';
  }

  await reload();
  applyI18n(main);
}
