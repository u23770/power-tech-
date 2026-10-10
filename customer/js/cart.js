// customer/js/cart.js — cart review page. Quantities and removals are local; stock is checked at checkout.
import { mountLayout, onLayoutLanguageChange, updateCartBadge } from './layout.js';
import { applyI18n, t, getLang, localized } from '/shared/i18n.js';
import { el, clear, errorMessage } from '/shared/ui.js';
import { formatMoney } from '/shared/format.js';
import { setQty, removeItem } from '/shared/cart.js';
import { isConfigured } from '/shared/supabase.js';
import { getPublicSettings, imageUrl } from './api.js';
import { loadCartLines } from './cart-lines.js';
import { loadingBlock, errorBlock, emptyBlock, stockBadge } from './cards.js';

const main = document.getElementById('app');
let maxQty = 10;

async function init() {
  document.title = `${t('cart.title')} · POWER TECH`;
  await mountLayout({ active: 'cart' });
  if (!isConfigured) {
    clear(main);
    main.append(errorBlock(t('state.not_configured')));
    return;
  }
  await render();
  onLayoutLanguageChange(render);
  // Another tab changed the cart: refresh the view.
  window.addEventListener('storage', (e) => { if (e.key === 'pt_cart_v1') render(); });
}

async function render() {
  clear(main);
  main.append(el('h1', { attrs: { 'data-i18n': 'cart.title' } }, t('cart.title')));
  main.append(loadingBlock(t('cart.refreshing')));
  try {
    const settings = await getPublicSettings().catch(() => ({}));
    maxQty = Number(settings.max_qty_per_line) || 10;
    const { lines, removedCount } = await loadCartLines();
    clear(main);
    main.append(el('h1', { attrs: { 'data-i18n': 'cart.title' } }, t('cart.title')));
    updateCartBadge();

    if (!lines.length) {
      main.append(emptyBlock(t('cart.empty'), '/customer/catalog.html', 'cart.continue'));
      return;
    }
    if (removedCount > 0) main.append(el('p', { className: 'notice', attrs: { role: 'status' } }, t('cart.removed_items')));

    main.append(el('div', { className: 'cart-layout' }, linesList(lines), summary(lines)));
    applyI18n(main);
  } catch (err) {
    clear(main);
    main.append(el('h1', { attrs: { 'data-i18n': 'cart.title' } }, t('cart.title')));
    main.append(errorBlock(errorMessage(err), render));
  }
}

function linesList(lines) {
  const lang = getLang();
  return el('section', { className: 'card', attrs: { 'aria-label': t('cart.title') } },
    lines.map((line) => lineRow(line, lang)));
}

function lineRow(line, lang) {
  const { product, unit, item, available } = line;
  const title = localized(product, 'title', lang);
  const price = line.unitPrice;
  const lineTotal = available && price !== null ? price * item.qty : null;
  const thumb = line.image
    ? el('img', { attrs: { src: imageUrl(line.image.storage_path), alt: '', width: 72, height: 72, loading: 'lazy' } })
    : el('span', { className: 'thumb-ph muted', attrs: { 'aria-hidden': 'true' } }, '');

  const qtySelect = item.unitId
    ? el('span', { className: 'muted' }, `${t('cart.qty')}: 1`)
    : el('span', { className: 'qty' },
      el('label', { attrs: { for: `qty-${line.key}` }, className: 'label' }, t('cart.qty')),
      el('select', {
        className: 'select', attrs: { id: `qty-${line.key}`, disabled: available ? null : true },
        on: { change: (e) => { setQty(line.key, Number(e.target.value), maxQty); render(); } },
      }, Array.from({ length: maxQty }, (_, i) => el('option', {
        attrs: { value: i + 1, selected: i + 1 === item.qty ? 'selected' : null },
      }, String(i + 1)))));

  return el('article', { className: 'cart-line' },
    thumb,
    el('div', { className: 'cart-line-body' },
      el('h2', { className: 'product-title', style: 'font-size:1rem;margin:0' },
        product ? el('a', { attrs: { href: `/customer/product.html?slug=${encodeURIComponent(product.slug)}` } }, title) : title),
      el('div', { className: 'row' },
        product ? stockBadge(product.stock_state) : null,
        unit?.condition_grade ? el('span', { className: 'badge badge-dark' }, `${t('product.grade')}: ${unit.condition_grade}`) : null,
        !available ? el('span', { className: 'badge badge-danger' }, t('cart.unavailable')) : null),
      el('div', { className: 'row' },
        el('span', { className: 'price' }, price !== null ? formatMoney(price, product.currency, lang) : '—'),
        el('span', { className: 'muted' }, lineTotal !== null ? `= ${formatMoney(lineTotal, product.currency, lang)}` : '')),
      el('div', { className: 'cart-line-actions' },
        qtySelect,
        el('button', {
          className: 'btn btn-ghost btn-small',
          attrs: { type: 'button', 'aria-label': `${t('cart.remove')}: ${title}` },
          on: { click: () => { removeItem(line.key); render(); } },
        }, t('cart.remove')))));
}

function summary(lines) {
  const lang = getLang();
  const usable = lines.filter((l) => l.available && l.unitPrice !== null);
  const currency = lines[0]?.product?.currency || 'EGP';
  const subtotal = usable.reduce((sum, l) => sum + l.unitPrice * l.item.qty, 0);
  const hasBlocked = lines.some((l) => !l.available);
  const count = usable.reduce((sum, l) => sum + l.item.qty, 0);

  return el('aside', { className: 'card summary', attrs: { 'aria-label': t('checkout.summary') } },
    el('h2', { style: 'font-size:1.1rem', attrs: { 'data-i18n': 'checkout.summary' } }, t('checkout.summary')),
    el('div', { className: 'summary-row' }, el('span', {}, `${t('cart.subtotal')} (${count})`), el('strong', {}, formatMoney(subtotal, currency, lang))),
    el('p', { className: 'hint', style: 'margin:0' }, t('cart.price_note')),
    hasBlocked ? el('p', { className: 'error-text', attrs: { role: 'status' } }, t('cart.removed_items')) : null,
    el('a', {
      className: 'btn btn-primary',
      attrs: { href: usable.length && !hasBlocked ? '/customer/checkout.html' : null, 'aria-disabled': usable.length && !hasBlocked ? null : 'true',
        'data-i18n': 'cart.checkout', role: usable.length && !hasBlocked ? null : 'link' },
      on: { click: (e) => { if (!usable.length || hasBlocked) e.preventDefault(); } },
    }, t('cart.checkout')),
    el('a', { className: 'btn btn-ghost', attrs: { href: '/customer/catalog.html', 'data-i18n': 'cart.continue' } }, t('cart.continue')),
    el('p', { className: 'hint', style: 'margin:0' }, t('cart.saved_locally')));
}

init();
