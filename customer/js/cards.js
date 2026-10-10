// customer/js/cards.js — product cards and shared state blocks (loading / error / empty).
import { el } from '/shared/ui.js';
import { t, getLang, localized } from '/shared/i18n.js';
import { formatMoney } from '/shared/format.js';
import { imageUrl } from './api.js';

const STOCK_BADGE = {
  in_stock: ['badge-ok', 'stock.in_stock'],
  low_stock: ['badge-warn', 'stock.low_stock'],
  out_of_stock: ['badge-danger', 'stock.out_of_stock'],
};
const CONDITION_KEY = { new: 'condition.new', used: 'condition.used', refurbished: 'condition.refurbished' };

export function stockBadge(state) {
  const [cls, key] = STOCK_BADGE[state] || STOCK_BADGE.out_of_stock;
  return el('span', { className: `badge ${cls}`, attrs: { 'data-i18n': key } }, t(key));
}

export function conditionBadge(condition) {
  const key = CONDITION_KEY[condition] || 'condition.new';
  return el('span', { className: 'badge badge-dark', attrs: { 'data-i18n': key } }, t(key));
}

/**
 * Price display rules (no fake discounts):
 *  - unit-tracked items show "From <lowest available unit price>";
 *  - a previous price is shown ONLY when the database has a sale_price for the product.
 */
export function priceBlock(p) {
  const lang = getLang();
  if (p.track_mode === 'unit') {
    return el('span', { className: 'price-row' },
      el('span', { className: 'muted', attrs: { 'data-i18n': 'product.from' } }, t('product.from')),
      el('span', { className: 'price' }, ' ', formatMoney(p.effective_price, p.currency, lang)));
  }
  if (p.sale_price !== null && p.sale_price !== undefined) {
    return el('span', { className: 'price-row' },
      el('span', { className: 'price' }, formatMoney(p.sale_price, p.currency, lang)),
      el('span', { className: 'price-was' },
        el('span', { className: 'visually-hidden' }, `${t('product.was')}: `),
        formatMoney(p.price, p.currency, lang)));
  }
  return el('span', { className: 'price' }, formatMoney(p.price, p.currency, lang));
}

export function productUrlFor(p) {
  return `/customer/product.html?slug=${encodeURIComponent(p.slug)}`;
}

/** Card for grids. imagesByProduct is a Map from getImagesByProduct(). */
export function productCard(p, imagesByProduct) {
  const lang = getLang();
  const title = localized(p, 'title', lang);
  const img = imagesByProduct?.get(p.id)?.[0];
  const media = img
    ? el('img', {
        attrs: {
          src: imageUrl(img.storage_path),
          alt: localized(img, 'alt', lang) || title,
          loading: 'lazy', decoding: 'async', width: 400, height: 300,
        },
      })
    : el('span', { className: 'muted', attrs: { 'data-i18n': 'product.no_image' } }, t('product.no_image'));

  return el('article', { className: 'product-card' },
    el('a', { className: 'product-thumb', attrs: { href: productUrlFor(p), 'aria-hidden': 'true', tabindex: '-1' } }, media),
    el('div', { className: 'product-body' },
      el('h3', { className: 'product-title' },
        el('a', { className: 'product-title', attrs: { href: productUrlFor(p) } }, title)),
      p.brand_name || p.model_number
        ? el('div', { className: 'product-meta' }, [p.brand_name, p.model_number].filter(Boolean).join(' · '))
        : null,
      el('div', { className: 'product-meta' }, conditionBadge(p.condition), stockBadge(p.stock_state)),
      el('div', { className: 'product-foot' }, priceBlock(p))));
}

export function grid(items, imagesByProduct) {
  return el('div', { className: 'product-grid' }, items.map((p) => productCard(p, imagesByProduct)));
}

export function loadingBlock(text) {
  return el('div', { className: 'row muted', attrs: { role: 'status', 'aria-live': 'polite' } },
    el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }),
    el('span', {}, text || t('state.loading')));
}

/** Error block with retry. Message comes from errorMessage() in shared/ui.js (caller passes text). */
export function errorBlock(text, onRetry) {
  return el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } },
    el('p', { className: 'error-text', attrs: { style: 'margin:0' } }, text),
    onRetry
      ? el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button', style: 'margin-top:.5rem' }, on: { click: onRetry } }, t('state.retry'))
      : null);
}

export function emptyBlock(text, actionHref, actionKey) {
  return el('div', { className: 'card', attrs: { role: 'status' } },
    el('p', { className: 'muted', style: 'margin:0' }, text),
    actionHref ? el('p', { style: 'margin:.75rem 0 0' }, el('a', { className: 'btn btn-dark btn-small', attrs: { href: actionHref, 'data-i18n': actionKey } }, t(actionKey))) : null);
}
