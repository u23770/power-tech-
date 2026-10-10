// customer/js/checkout.js — checkout form and order placement.
// Security notes:
//  - The browser never sends prices, discounts, totals or stock. Only product/unit ids, quantities,
//    customer details, the chosen delivery/payment options and an optional coupon code.
//  - One idempotency key per checkout attempt (sessionStorage). Repeated taps or retries reuse it, so
//    the database returns the same order instead of creating a second one.
//  - The tracking code is shown once. It is kept in sessionStorage for this tab only, never in the URL.
import { mountLayout, onLayoutLanguageChange, updateCartBadge } from './layout.js';
import { applyI18n, t, getLang } from '/shared/i18n.js';
import { el, clear, errorMessage, setStatus, setBusy } from '/shared/ui.js';
import { formatMoney } from '/shared/format.js';
import { validateCustomer } from '/shared/validators.js';
import { clearCart } from '/shared/cart.js';
import { isConfigured } from '/shared/supabase.js';
import { getPublicSettings, getSession, getProfile, placeOrder } from './api.js';
import { loadCartLines } from './cart-lines.js';
import { loadingBlock, errorBlock, emptyBlock } from './cards.js';

const main = document.getElementById('app');
const KEY_IDEM = 'pt_checkout_key';
const KEY_LAST = 'pt_last_order';

let settings = {};
let session = null;
let formValues = {};
let submitting = false;

async function init() {
  document.title = `${t('checkout.title')} · POWER TECH`;
  await mountLayout({ active: 'cart' });
  if (!isConfigured) {
    clear(main);
    main.append(errorBlock(t('state.not_configured')));
    return;
  }
  await render();
  onLayoutLanguageChange(render);
}

function lastOrder() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY_LAST) || 'null');
  } catch {
    return null;
  }
}

async function render() {
  clear(main);
  main.append(el('h1', { attrs: { 'data-i18n': 'checkout.title' } }, t('checkout.title')));
  const previous = lastOrder();
  try {
    const [{ lines, removedCount }, cfg, sess] = await Promise.all([
      loadCartLines(),
      getPublicSettings(),
      getSession().catch(() => null),
    ]);
    settings = cfg;
    session = sess;
    updateCartBadge();

    if (!lines.length && previous) {
      main.append(successPanel(previous));
      applyI18n(main);
      return;
    }
    if (!lines.length) {
      main.append(emptyBlock(t('checkout.empty'), '/customer/catalog.html', 'cart.continue'));
      return;
    }
    if (removedCount) main.append(el('p', { className: 'notice', attrs: { role: 'status' } }, t('cart.removed_items')));

    const opts = settings.checkout_options || {};
    const fulfillments = ['delivery', 'pickup'].filter((k) => opts[k] === true);
    const payments = ['cod', 'pay_at_store'].filter((k) => opts[k] === true);
    if (!fulfillments.length || !payments.length) {
      main.append(el('p', { className: 'notice', attrs: { role: 'status' } }, t('checkout.not_configured')));
      return;
    }
    const guestAllowed = settings.guest_checkout?.enabled === true;
    if (!session && !guestAllowed) {
      main.append(emptyBlock(t('checkout.login_required'), '/customer/account.html?next=checkout', 'checkout.sign_in_link'));
      return;
    }
    if (!lines.every((l) => l.available)) {
      main.append(el('p', { className: 'error-text', attrs: { role: 'status' } }, t('cart.removed_items')));
    }

    await prefill();
    const form = checkoutForm(lines, fulfillments, payments);
    main.append(el('div', { className: 'checkout-layout' }, form, summaryPanel(lines)));
    applyI18n(main);
  } catch (err) {
    main.append(errorBlock(errorMessage(err), render));
  }
}

/** Prefill from the signed-in profile. Email is taken from the auth session, not from user-editable profile data. */
async function prefill() {
  if (!session) return;
  try {
    const profile = await getProfile(session.user.id);
    formValues = {
      name: formValues.name || profile?.full_name || '',
      phone: formValues.phone || profile?.phone || '',
      email: formValues.email || session.user.email || '',
      ...formValues,
    };
  } catch {
    formValues = { email: session.user.email || '', ...formValues };
  }
}

function checkoutForm(lines, fulfillments, payments) {
  const status = el('div', { className: 'status', attrs: { id: 'checkout-status', role: 'status' }, hidden: true });
  const submit = el('button', { className: 'btn btn-primary', attrs: { type: 'submit', id: 'place-btn', 'data-i18n': 'checkout.place' } }, t('checkout.place'));
  const form = el('form', { className: 'card form', attrs: { novalidate: true, id: 'checkout-form', 'aria-label': t('checkout.title') } },
    el('fieldset', {},
      el('legend', { attrs: { 'data-i18n': 'checkout.contact' } }, t('checkout.contact')),
      el('div', { className: 'form-grid two' },
        textField('name', 'checkout.name', { autocomplete: 'name', required: true }),
        textField('phone', 'checkout.phone', { autocomplete: 'tel', inputmode: 'tel', required: true }),
        textField('email', 'checkout.email', { autocomplete: 'email', type: 'email', inputmode: 'email' })),
      el('p', { className: 'hint' }, session ? t('checkout.signed_in_as', { e: session.user.email || '' }) : t('checkout.guest_note'))),
    el('fieldset', {},
      el('legend', { attrs: { 'data-i18n': 'checkout.delivery_address' } }, t('checkout.delivery_address')),
      el('div', { className: 'form-grid two' },
        textField('governorate', 'checkout.governorate', { required: true, autocomplete: 'address-level1' }),
        textField('city', 'checkout.city', { required: true, autocomplete: 'address-level2' }),
        textField('area', 'checkout.area')),
      textField('address', 'checkout.address', { textarea: true, required: true, autocomplete: 'street-address' }),
      textField('location', 'checkout.location', { type: 'url', inputmode: 'url', placeholder: 'https://maps.google.com/…' })),
    el('fieldset', {},
      el('legend', {}, t('checkout.fulfillment')),
      el('div', { className: 'choice-grid' }, fulfillments.map((k) => choice('fulfillment', k, `checkout.${k}`, fulfillments.length === 1)))),
    el('fieldset', {},
      el('legend', {}, t('checkout.payment')),
      el('div', { className: 'choice-grid' }, payments.map((k) => choice('payment', k, `checkout.${k}`, payments.length === 1)))),
    el('div', { className: 'field' },
      el('label', { attrs: { for: 'f-coupon' } }, t('checkout.coupon')),
      el('input', { className: 'input', attrs: { id: 'f-coupon', name: 'coupon', autocomplete: 'off', maxlength: '32', value: formValues.coupon || '' } }),
      el('p', { className: 'hint' }, t('checkout.coupon_help'))),
    textField('notes', 'checkout.notes', { textarea: true }),
    status,
    el('div', { className: 'row' }, submit,
      el('a', { className: 'btn btn-ghost', attrs: { href: '/customer/cart.html', 'data-i18n': 'checkout.back_cart' } }, t('checkout.back_cart'))));

  // Keep typed values across re-renders (e.g. language switch) and remember them for this session.
  form.addEventListener('input', (e) => {
    if (e.target.name) formValues[e.target.name] = e.target.value;
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'fulfillment' || e.target.name === 'payment') formValues[e.target.name] = e.target.value;
    if (e.target.name === 'fulfillment') {
      const fee = document.getElementById('fee-row');
      if (fee) fee.hidden = e.target.value !== 'delivery';
    }
  });
  form.addEventListener('submit', (e) => onSubmit(e, lines, status, submit));
  return form;
}

function textField(name, labelKey, opts = {}) {
  const id = `f-${name}`;
  const errId = `e-${name}`;
  const common = {
    id,
    name,
    autocomplete: opts.autocomplete || 'off',
    'aria-describedby': errId,
    required: opts.required ? 'required' : null,
    inputmode: opts.inputmode || null,
    placeholder: opts.placeholder || null,
    maxlength: opts.textarea ? '500' : (name === 'address' ? '300' : '120'),
  };
  if (formValues[name] !== undefined) common.value = formValues[name];
  const input = opts.textarea
    ? el('textarea', { className: 'textarea', attrs: common }, formValues[name] || '')
    : el('input', { className: 'input', attrs: { ...common, type: opts.type || 'text' } });
  return el('div', { className: 'field' },
    el('label', { attrs: { for: id } }, t(labelKey)),
    input,
    el('p', { className: 'error-text', attrs: { id: errId, hidden: true } }));
}

function choice(group, value, labelKey, checked) {
  const selected = formValues[group] ? formValues[group] === value : checked;
  const id = `${group}-${value}`;
  return el('label', { className: 'choice', attrs: { for: id } },
    el('input', { attrs: { type: 'radio', id, name: group, value, checked: selected ? 'checked' : null, required: 'required' } }),
    el('span', { attrs: { 'data-i18n': labelKey } }, t(labelKey)));
}

function readForm(form) {
  const f = new FormData(form);
  const get = (k) => String(f.get(k) || '');
  return {
    name: get('name'), phone: get('phone'), email: get('email'), governorate: get('governorate'),
    city: get('city'), area: get('area'), address: get('address'), location: get('location'),
    notes: get('notes'), coupon: get('coupon'), fulfillment: get('fulfillment'), payment: get('payment'),
  };
}

function showFieldErrors(form, errors) {
  for (const input of form.querySelectorAll('input[name], textarea[name]')) {
    const msg = errors[input.name];
    const errNode = document.getElementById(`e-${input.name}`);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (errNode) {
      errNode.textContent = msg || '';
      errNode.hidden = !msg;
    }
  }
}

async function onSubmit(event, lines, status, submitBtn) {
  event.preventDefault();
  if (submitting) return; // double-tap guard
  const form = event.currentTarget;
  const values = readForm(form);
  const errors = validateCustomer(values);
  if (!values.fulfillment) errors.fulfillment = t('val.required');
  if (!values.payment) errors.payment = t('val.required');
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) {
    setStatus(status, t('val.generic'), 'error');
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  if (!lines.every((l) => l.available)) {
    setStatus(status, t('cart.removed_items'), 'error');
    return;
  }

  const items = lines.map((l) => (l.item.unitId
    ? { product_id: l.item.productId, quantity: 1, unit_id: l.item.unitId }
    : { product_id: l.item.productId, quantity: l.item.qty }));

  submitting = true;
  setBusy(submitBtn, true, t('checkout.placing'));
  setStatus(status, '', 'info');
  try {
    const result = await placeOrder({
      items,
      customer: {
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        governorate: values.governorate.trim(),
        city: values.city.trim(),
        area: values.area.trim(),
        address: values.address.trim(),
        location_url: values.location.trim(),
        notes: values.notes.trim(),
      },
      fulfillment: values.fulfillment,
      paymentMethod: values.payment,
      couponCode: values.coupon.trim().toUpperCase(),
      idempotencyKey: idempotencyKey(),
    });
    sessionStorage.removeItem(KEY_IDEM);
    clearCart();
    formValues = {};
    sessionStorage.setItem(KEY_LAST, JSON.stringify({
      reference: result.reference,
      status: result.status,
      total: result.total,
      currency: result.currency,
      token: result.tracking_token || null,
      duplicate: Boolean(result.duplicate),
    }));
    await render();
    document.getElementById('app')?.focus();
  } catch (err) {
    setStatus(status, errorMessage(err), 'error');
  } finally {
    submitting = false;
    setBusy(submitBtn, false);
  }
}

/** One key per checkout attempt. Cleared after success, so the next order gets a new key. */
function idempotencyKey() {
  let key = sessionStorage.getItem(KEY_IDEM);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(KEY_IDEM, key);
  }
  return key;
}

function summaryPanel(lines) {
  const lang = getLang();
  const usable = lines.filter((l) => l.available && l.unitPrice !== null);
  const currency = lines[0].product.currency || 'EGP';
  const subtotal = usable.reduce((s, l) => s + l.unitPrice * l.item.qty, 0);
  const fee = Number(settings.delivery_fee?.amount || 0);
  return el('aside', { className: 'card summary', attrs: { 'aria-label': t('checkout.summary') } },
    el('h2', { style: 'font-size:1.1rem', attrs: { 'data-i18n': 'checkout.summary' } }, t('checkout.summary')),
    el('ul', { style: 'list-style:none;padding:0;margin:0;display:grid;gap:.4rem' },
      lines.map((l) => el('li', { className: 'summary-row' },
        el('span', {}, `${l.product.title_en || ''} × ${l.item.qty}`),
        el('span', {}, l.unitPrice !== null ? formatMoney(l.unitPrice * l.item.qty, currency, lang) : '—')))),
    el('div', { className: 'summary-row' }, el('span', {}, t('cart.subtotal')), el('strong', {}, formatMoney(subtotal, currency, lang))),
    el('div', { className: 'summary-row', attrs: { id: 'fee-row' } }, el('span', {}, t('checkout.fee')), el('span', {}, fee > 0 ? formatMoney(fee, currency, lang) : t('checkout.free'))),
    el('p', { className: 'hint', style: 'margin:0' }, t('checkout.total_note')));
}

function successPanel(order) {
  const lang = getLang();
  const copy = el('button', {
    className: 'btn btn-ghost btn-small', attrs: { type: 'button' },
    on: { click: async (e) => {
      try {
        await navigator.clipboard.writeText(order.token);
        e.currentTarget.textContent = t('product.link_copied');
      } catch {
        e.currentTarget.textContent = t('product.copy_failed');
      }
    } },
  }, t('checkout.copy_token'));
  return el('section', { className: 'card receipt', attrs: { 'aria-labelledby': 'success-h', tabindex: '-1', id: 'receipt' } },
    el('h2', { attrs: { id: 'success-h' } }, t('checkout.success_title')),
    order.duplicate ? el('p', { className: 'notice' }, t('checkout.duplicate')) : null,
    el('p', {}, el('strong', {}, `${t('checkout.reference')}: `), el('span', { className: 'code-box' }, order.reference)),
    order.token
      ? el('div', {},
        el('p', {}, el('strong', {}, `${t('checkout.token')}: `), el('span', { className: 'code-box' }, order.token)),
        el('p', { className: 'hint' }, t('checkout.token_note')),
        copy)
      : null,
    el('p', {}, el('strong', {}, `${t('checkout.total')}: `), formatMoney(order.total, order.currency, lang)),
    el('p', { className: 'notice' }, t('checkout.pending_note')),
    el('div', { className: 'row' },
      el('a', { className: 'btn btn-dark', attrs: { href: `/customer/track.html?ref=${encodeURIComponent(order.reference)}` } }, t('checkout.track_link')),
      el('a', { className: 'btn btn-ghost', attrs: { href: '/customer/catalog.html' } }, t('cart.continue')),
      el('button', {
        className: 'btn btn-ghost', attrs: { type: 'button' },
        on: { click: () => { sessionStorage.removeItem(KEY_LAST); render(); } },
      }, t('checkout.new_order'))));
}

init();
