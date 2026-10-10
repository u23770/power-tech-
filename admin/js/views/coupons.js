// admin/js/views/coupons.js — unified coupons and automatic discount management.
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, setBusy, confirmAction, errorMessage } from '/shared/ui.js';
import { formatMoney } from '/shared/format.js';
import * as api from '../api.js';

const money = (value, lang) => formatMoney(Number(value || 0), 'EGP', lang);
const localDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};
const toStart = (value) => value ? new Date(value + 'T00:00:00').toISOString() : null;
const toEnd = (value) => value ? new Date(value + 'T23:59:59.999').toISOString() : null;

function field(id, label, value = '', attrs = {}) {
  const input = el('input', { className: 'input', attrs: { id, name: id, value: value ?? '', ...attrs } });
  return { input, field: el('div', { className: 'field' }, el('label', { attrs: { for: id } }, label), input) };
}
function check(id, label, checked = false) {
  const input = el('input', { attrs: { id, name: id, type: 'checkbox', checked: checked ? 'checked' : null } });
  return { input, field: el('label', { className: 'checkbox-row', attrs: { for: id } }, input, label) };
}
function selectField(id, label, options) {
  const input = el('select', { className: 'select', attrs: { id, name: id } },
    ...options.map(([value, text]) => el('option', { attrs: { value } }, text)));
  return { input, field: el('div', { className: 'field' }, el('label', { attrs: { for: id } }, label), input) };
}

export async function render(main) {
  const msg = el('div', { className: 'status', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });
  const host = el('div', { className: 'stack' });
  const code = field('cp-code', t('admin.coupons.code'), '', {
    minlength: '3', maxlength: '32', pattern: '[A-Z0-9_-]{3,32}', autocomplete: 'off',
  });
  const name = field('cp-name', t('admin.coupons.name'), '', { maxlength: '120' });
  const type = selectField('cp-promotion-type', t('admin.coupons.promotion_type'), [
    ['coupon', t('admin.coupons.type.coupon')],
    ['automatic', t('admin.coupons.type.automatic')],
    ['signup', t('admin.coupons.type.signup')],
  ]);
  const scope = selectField('cp-scope', t('admin.coupons.scope'), [
    ['all', t('admin.coupons.scope.all')],
    ['product', t('admin.coupons.scope.product')],
    ['category', t('admin.coupons.scope.category')],
  ]);
  const target = el('select', { className: 'select', attrs: { id: 'cp-target', name: 'target' } });
  const targetLabel = el('label', { attrs: { for: 'cp-target' } }, t('admin.coupons.target_product'));
  const targetField = el('div', { className: 'field', hidden: true }, targetLabel, target);
  const kind = selectField('cp-kind', t('admin.coupons.value_type'), [
    ['percent', t('admin.coupons.percent')],
    ['fixed', t('admin.coupons.fixed')],
  ]);
  const value = field('cp-value', t('admin.coupons.value'), '', {
    type: 'number', min: '0.01', max: '100', step: '0.01', required: 'required',
  });
  const min = field('cp-min', t('admin.coupons.min_subtotal'), '0', {
    type: 'number', min: '0', step: '0.01', required: 'required',
  });
  const cap = field('cp-cap', t('admin.coupons.max_discount'), '', {
    type: 'number', min: '0.01', step: '0.01',
  });
  const starts = field('cp-starts', t('admin.coupons.starts'), '', { type: 'date' });
  const ends = field('cp-ends', t('admin.coupons.ends'), '', { type: 'date' });
  const max = field('cp-max', t('admin.coupons.max'), '', { type: 'number', min: '1', step: '1' });
  const perCustomer = field('cp-user-max', t('admin.coupons.max_per_customer'), '', { type: 'number', min: '1', step: '1' });
  const priority = field('cp-priority', t('admin.coupons.priority'), '0', { type: 'number', min: '-1000', max: '1000', step: '1' });
  const first = check('cp-first', t('admin.coupons.first_order_only'), false);
  const sale = check('cp-sale', t('admin.coupons.applies_sale'), false);
  const active = check('cp-active', t('admin.coupons.active'), true);
  const saveBtn = el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.coupons.create'));
  const cancelBtn = el('button', {
    className: 'btn btn-ghost', attrs: { type: 'button', hidden: 'hidden' }, on: { click: () => clearForm() },
  }, t('admin.cancel'));
  const formTitle = el('h2', { className: 'card-title' }, t('admin.coupons.form_title'));
  const form = el('form', { className: 'card form stack' },
    formTitle,
    el('p', { className: 'muted' }, t('admin.coupons.form_help')),
    el('div', { className: 'form-grid two' },
      type.field, name.field, code.field, scope.field, targetField,
      kind.field, value.field, min.field, cap.field, starts.field, ends.field,
      max.field, perCustomer.field, priority.field, first.field, sale.field, active.field),
    el('div', { className: 'form-actions' }, saveBtn, cancelBtn));

  const filters = el('div', { className: 'row' }, ...[
    ['all', t('admin.coupons.filter_all')],
    ['coupon', t('admin.coupons.type.coupon')],
    ['automatic', t('admin.coupons.type.automatic')],
    ['signup', t('admin.coupons.type.signup')],
  ].map(([key, label]) => el('button', {
    className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, dataset: { filter: key },
    on: { click: () => { currentFilter = key; paintList(); } },
  }, label)));

  main.append(
    el('div', { className: 'page-title' }, el('h1', { className: 'card-title' }, t('admin.nav.coupons'))),
    el('p', { className: 'muted' }, t('admin.coupons.intro')),
    msg,
    form,
    el('section', { className: 'card stack' },
      el('h2', { className: 'card-title' }, t('admin.coupons.saved')),
      filters,
      host),
  );

  let editingId = null;
  let rows = [];
  let targets = { products: [], categories: [] };
  let currentFilter = 'all';

  code.input.addEventListener('input', () => {
    code.input.value = code.input.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
  });
  type.input.addEventListener('change', refreshFormFields);
  scope.input.addEventListener('change', refreshFormFields);
  kind.input.addEventListener('change', refreshFormFields);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const promotionType = type.input.value;
    const selectedScope = promotionType === 'signup' ? 'all' : scope.input.value;
    const amount = Number(value.input.value);
    const minimum = Number(min.input.value);
    const maximumUses = max.input.value.trim() ? Number(max.input.value) : null;
    const customerUses = perCustomer.input.value.trim() ? Number(perCustomer.input.value) : null;
    const capValue = cap.input.value.trim() ? Number(cap.input.value) : null;
    const priorityValue = priority.input.value.trim() ? Number(priority.input.value) : 0;

    if (promotionType !== 'coupon' && name.input.value.trim().length < 2) {
      return setStatus(msg, t('admin.coupons.invalid_name'), 'error');
    }
    if (promotionType === 'coupon' && !/^[A-Z0-9_-]{3,32}$/.test(code.input.value.trim().toUpperCase())) {
      return setStatus(msg, t('admin.coupons.invalid_code'), 'error');
    }
    if (!Number.isFinite(amount) || amount <= 0 || (kind.input.value === 'percent' && amount > 100)) {
      return setStatus(msg, t('admin.coupons.invalid_value'), 'error');
    }
    if (!Number.isFinite(minimum) || minimum < 0) return setStatus(msg, t('admin.coupons.invalid_min'), 'error');
    if (capValue !== null && (!Number.isFinite(capValue) || capValue <= 0)) {
      return setStatus(msg, t('admin.coupons.invalid_cap'), 'error');
    }
    if (maximumUses !== null && (!Number.isInteger(maximumUses) || maximumUses < 1)) {
      return setStatus(msg, t('admin.coupons.invalid_max'), 'error');
    }
    if (customerUses !== null && (!Number.isInteger(customerUses) || customerUses < 1)) {
      return setStatus(msg, t('admin.coupons.invalid_user_max'), 'error');
    }
    if (!Number.isInteger(priorityValue) || priorityValue < -1000 || priorityValue > 1000) {
      return setStatus(msg, t('admin.coupons.invalid_priority'), 'error');
    }
    if (starts.input.value && ends.input.value && starts.input.value > ends.input.value) {
      return setStatus(msg, t('admin.coupons.invalid_window'), 'error');
    }
    if (selectedScope === 'product' && !targets.products.some((p) => p.id === target.input.value)) {
      return setStatus(msg, t('admin.coupons.invalid_target'), 'error');
    }
    if (selectedScope === 'category' && !targets.categories.some((c) => c.id === target.input.value)) {
      return setStatus(msg, t('admin.coupons.invalid_target'), 'error');
    }

    const cleanCode = code.input.value.trim().toUpperCase();
    const cleanName = name.input.value.trim();
    const payload = {
      name: cleanName || (promotionType === 'coupon' ? cleanCode : ''),
      promotion_type: promotionType,
      scope: selectedScope,
      target_product_id: selectedScope === 'product' ? target.input.value : null,
      target_category_id: selectedScope === 'category' ? target.input.value : null,
      code: promotionType === 'coupon' ? cleanCode : null,
      kind: kind.input.value,
      value: amount,
      min_subtotal: minimum,
      max_discount: capValue,
      starts_at: toStart(starts.input.value),
      ends_at: toEnd(ends.input.value),
      max_redemptions: maximumUses,
      max_uses_per_customer: customerUses,
      priority: priorityValue,
      first_order_only: promotionType === 'signup' ? true : first.input.checked,
      applies_to_sale_items: sale.input.checked,
      is_active: active.input.checked,
    };
    setBusy(saveBtn, true);
    try {
      const wasEditing = Boolean(editingId);
      if (wasEditing) await api.updateCouponAdmin(editingId, payload);
      else await api.insertCouponAdmin(payload);
      setStatus(msg, t(wasEditing ? 'admin.coupons.updated' : 'admin.coupons.created'), 'success');
      clearForm();
      await reload();
    } catch (err) {
      setStatus(msg, errorMessage(err), 'error');
    } finally {
      setBusy(saveBtn, false);
    }
  });

  function refreshFormFields() {
    const promotionType = type.input.value;
    const selectedScope = promotionType === 'signup' ? 'all' : scope.input.value;
    code.field.hidden = promotionType !== 'coupon';
    code.input.required = promotionType === 'coupon';
    name.input.required = promotionType !== 'coupon';
    scope.input.disabled = promotionType === 'signup';
    if (promotionType === 'signup') scope.input.value = 'all';
    first.input.disabled = promotionType === 'signup';
    if (promotionType === 'signup') first.input.checked = true;
    targetField.hidden = selectedScope === 'all';
    targetLabel.textContent = t(selectedScope === 'category' ? 'admin.coupons.target_category' : 'admin.coupons.target_product');
    clear(target);
    if (selectedScope === 'product') {
      target.append(el('option', { attrs: { value: '' } }, t('admin.coupons.select_product')));
      for (const product of targets.products) {
        const label = [product.title_en, product.title_ar, product.model_number ? '(' + product.model_number + ')' : ''].filter(Boolean).join(' · ');
        target.append(el('option', { attrs: { value: product.id } }, label));
      }
    } else if (selectedScope === 'category') {
      target.append(el('option', { attrs: { value: '' } }, t('admin.coupons.select_category')));
      for (const category of targets.categories) {
        const label = [category.name_en, category.name_ar].filter(Boolean).join(' · ');
        target.append(el('option', { attrs: { value: category.id } }, label));
      }
    }
    target.required = selectedScope !== 'all';
    value.input.max = kind.input.value === 'percent' ? '100' : '1000000000';
    cap.field.hidden = kind.input.value !== 'percent';
    applyI18n(form);
  }

  function clearForm() {
    editingId = null;
    form.reset();
    type.input.value = 'coupon';
    scope.input.value = 'all';
    kind.input.value = 'percent';
    min.input.value = '0';
    priority.input.value = '0';
    active.input.checked = true;
    saveBtn.textContent = t('admin.coupons.create');
    formTitle.textContent = t('admin.coupons.form_title');
    cancelBtn.hidden = true;
    refreshFormFields();
    applyI18n(form);
  }

  function editRow(promotion) {
    editingId = promotion.id;
    type.input.value = promotion.promotion_type;
    scope.input.value = promotion.scope;
    name.input.value = promotion.name || '';
    code.input.value = promotion.code || '';
    kind.input.value = promotion.kind;
    value.input.value = promotion.value;
    min.input.value = promotion.min_subtotal;
    cap.input.value = promotion.max_discount ?? '';
    starts.input.value = localDate(promotion.starts_at);
    ends.input.value = localDate(promotion.ends_at);
    max.input.value = promotion.max_redemptions ?? '';
    perCustomer.input.value = promotion.max_uses_per_customer ?? '';
    priority.input.value = promotion.priority ?? 0;
    first.input.checked = Boolean(promotion.first_order_only);
    sale.input.checked = Boolean(promotion.applies_to_sale_items);
    active.input.checked = Boolean(promotion.is_active);
    refreshFormFields();
    if (promotion.target_product_id) target.input.value = promotion.target_product_id;
    if (promotion.target_category_id) target.input.value = promotion.target_category_id;
    saveBtn.textContent = t('admin.coupons.update');
    formTitle.textContent = t('admin.coupons.edit_title');
    cancelBtn.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (promotion.promotion_type === 'coupon' ? code.input : name.input).focus();
  }

  function promotionStatus(promotion) {
    if (!promotion.is_active) return 'paused';
    const now = Date.now();
    if (promotion.starts_at && new Date(promotion.starts_at).getTime() > now) return 'scheduled';
    if (promotion.ends_at && new Date(promotion.ends_at).getTime() < now) return 'expired';
    if (promotion.max_redemptions && promotion.redemptions_count >= promotion.max_redemptions) return 'used_up';
    return 'active';
  }

  function scopeText(promotion) {
    if (promotion.scope === 'product') {
      const product = targets.products.find((p) => p.id === promotion.target_product_id);
      return product ? product.title_en : t('admin.coupons.deleted_target');
    }
    if (promotion.scope === 'category') {
      const category = targets.categories.find((c) => c.id === promotion.target_category_id);
      return category ? category.name_en : t('admin.coupons.deleted_target');
    }
    return t('admin.coupons.scope.all');
  }

  function paintList() {
    clear(host);
    const filtered = currentFilter === 'all' ? rows : rows.filter((row) => row.promotion_type === currentFilter);
    for (const btn of filters.querySelectorAll('[data-filter]')) {
      btn.classList.toggle('btn-dark', btn.dataset.filter === currentFilter);
    }
    if (!filtered.length) {
      host.append(el('p', { className: 'muted' }, rows.length ? t('admin.coupons.empty_filter') : t('admin.coupons.empty')));
      return;
    }
    const lang = getLang();
    for (const promotion of filtered) {
      const status = promotionStatus(promotion);
      const discountText = promotion.kind === 'percent'
        ? promotion.value + '%' + (promotion.max_discount ? ' · ' + t('admin.coupons.max_discount_short', { v: money(promotion.max_discount, lang) }) : '')
        : money(promotion.value, lang);
      const detailParts = [
        t('admin.coupons.type.' + promotion.promotion_type),
        scopeText(promotion),
        (promotion.kind === 'percent' ? t('admin.coupons.percent') : t('admin.coupons.fixed')) + ': ' + discountText,
        t('admin.coupons.min_subtotal') + ': ' + money(promotion.min_subtotal, lang),
        t('admin.coupons.redemptions') + ': ' + promotion.redemptions_count + (promotion.max_redemptions ? ' / ' + promotion.max_redemptions : ''),
      ];
      if (promotion.max_uses_per_customer) detailParts.push(t('admin.coupons.max_per_customer_short') + ': ' + promotion.max_uses_per_customer);
      const actions = el('div', { className: 'table-actions' },
        el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: () => editRow(promotion) } }, t('admin.edit')),
        el('button', {
          className: 'btn btn-ghost btn-small', attrs: { type: 'button' },
          on: { click: async () => {
            try {
              await api.setCouponActiveAdmin(promotion.id, !promotion.is_active);
              setStatus(msg, t(promotion.is_active ? 'admin.coupons.paused_msg' : 'admin.coupons.activated_msg'), 'success');
              await reload();
            } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
          } },
        }, t(promotion.is_active ? 'admin.coupons.pause' : 'admin.coupons.activate')),
        el('button', {
          className: 'btn btn-danger btn-small', attrs: {
            type: 'button',
            disabled: Number(promotion.redemptions_count) > 0,
            title: Number(promotion.redemptions_count) > 0 ? t('admin.coupons.delete_used_hint') : '',
          },
          on: { click: async () => {
            if (Number(promotion.redemptions_count) > 0) return;
            if (!(await confirmAction(t('admin.coupons.delete_confirm')))) return;
            try {
              await api.deleteCouponAdmin(promotion.id);
              setStatus(msg, t('admin.coupons.deleted'), 'success');
              await reload();
            } catch (err) { setStatus(msg, errorMessage(err), 'error'); }
          } },
        }, t('admin.delete')));
      host.append(el('article', { className: 'card stack' },
        el('div', { className: 'toolbar-admin' },
          el('div', {}, el('h3', { className: 'code' }, promotion.promotion_type === 'coupon' ? promotion.code : promotion.name),
            el('p', { className: 'muted' }, detailParts.join(' · '))),
          el('span', { className: 'badge', dataset: { kind: status === 'active' ? 'success' : 'muted' } }, t('admin.coupons.status.' + status))),
        el('div', { className: 'row' }, actions)));
    }
    applyI18n(host);
  }

  async function reload() {
    clear(host);
    host.append(el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
    try {
      const [promotions, catalogTargets] = await Promise.all([
        api.listCouponsAdmin(),
        api.listPromotionTargetsAdmin(),
      ]);
      rows = promotions;
      targets = catalogTargets;
      refreshFormFields();
      paintList();
    } catch (err) {
      clear(host);
      host.append(el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } }, errorMessage(err)));
    }
  }

  refreshFormFields();
  await reload();
  applyI18n(main);
}
