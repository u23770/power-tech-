// customer/js/layout.js — header, category bar, footer. Re-renders on language change.
import { el, brandMark } from '/shared/ui.js';
import { t, getLang, setLang, onLangChange, localized, applyI18n } from '/shared/i18n.js';
import { getItems, cartCount, lineKey } from '/shared/cart.js';
import { formatMoney } from '/shared/format.js';
import { isConfigured } from '/shared/supabase.js';
import { getPublicSettings, listCategories } from './api.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inline SVG icon (path data only; no external icon font or network request). */
function icon(pathD) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  cart: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  close: 'M6 6l12 12M18 6L6 18',
};

let categoriesCache = null;
let settingsCache = null;
let state = { renderPending: false };

/** Mount header and footer into #site-header and #site-footer. Safe to call again (e.g. after language change). */
export async function mountLayout({ active = '' } = {}) {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  if (!header) return;

  const preservedQuery = header.querySelector('input[name="q"]')?.value || new URLSearchParams(location.search).get('q') || '';

  let categories = [];
  let settings = {};
  if (isConfigured) {
    try {
      categories = categoriesCache ?? (categoriesCache = await listCategories());
      settings = settingsCache ?? (settingsCache = await getPublicSettings());
    } catch {
      categories = [];
      settings = {};
    }
  }

  header.replaceChildren(buildHeader({ active, categories, preservedQuery, settings }));
  if (footer) footer.replaceChildren(buildFooter(settings));
  applyI18n(document);
  updateCartBadge();
}

function navLink(href, key, active) {
  return el('a', {
    className: 'nav-link',
    attrs: { href, 'aria-current': active ? 'page' : null, 'data-i18n': key },
  }, t(key));
}

function buildHeader({ active, categories, preservedQuery, settings }) {
  const lang = getLang();
  const configuredName = settings?.store_name;
  const storeName = (configuredName && typeof configuredName === 'object'
    ? configuredName[lang] || configuredName.en
    : configuredName) || 'POWER TECH';
  const menuToggle = el('button', {
    className: 'icon-btn menu-toggle',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'main-nav', 'aria-label': t('nav.menu') },
    on: { click: toggleMenu },
  }, icon(ICONS.menu));

  const search = el('form', {
    className: 'search',
    attrs: { role: 'search', action: '/customer/catalog.html', method: 'get' },
  },
    el('label', { className: 'visually-hidden', attrs: { for: 'site-search' } }, t('search.label')),
    el('input', {
      className: 'input search-input',
      attrs: { id: 'site-search', name: 'q', type: 'search', maxlength: '80', autocomplete: 'off', value: preservedQuery,
        placeholder: t('search.placeholder') },
    }),
    el('button', { className: 'btn btn-dark search-submit', attrs: { type: 'submit', 'aria-label': t('search.submit') } },
      icon(ICONS.search)));

  const cartLink = el('a', {
    className: 'nav-link cart-link',
    attrs: { href: '/customer/cart.html', id: 'cart-link', 'aria-label': t('nav.cart') },
  },
    icon(ICONS.cart),
    el('span', { className: 'visually-hidden', attrs: { 'data-i18n': 'nav.cart' } }, t('nav.cart')),
    el('span', { className: 'cart-badge', attrs: { id: 'cart-badge', 'aria-hidden': 'true' } }, '0'));

  const langBtn = el('button', {
    className: 'btn btn-ghost btn-small lang-btn',
    attrs: { type: 'button', lang: lang === 'ar' ? 'en' : 'ar', 'aria-label': lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية' },
    on: { click: () => setLang(lang === 'ar' ? 'en' : 'ar') },
  }, t('lang.switch'));

  const nav = el('nav', { className: 'main-nav', attrs: { id: 'main-nav', 'aria-label': 'Main' } },
    navLink('/customer/index.html', 'nav.home', active === 'home'),
    navLink('/customer/catalog.html', 'nav.catalog', active === 'catalog'),
    navLink('/customer/track.html', 'nav.track', active === 'track'),
    navLink('/customer/account.html', 'nav.account', active === 'account'),
    cartLink,
    langBtn,
    el('button', { className: 'icon-btn menu-close', attrs: { type: 'button', 'aria-label': t('nav.close') }, on: { click: toggleMenu } }, icon(ICONS.close)));

  const top = el('div', { className: 'container header-inner' },
    brandMark({ href: '/customer/index.html', name: storeName }),
    search,
    menuToggle,
    nav);

  const catItems = categories.map((c) => el('li', {},
    el('a', { className: 'cat-link', attrs: { href: `/customer/catalog.html?category=${encodeURIComponent(c.slug)}` } },
      localized(c, 'name'))));

  const catBar = el('nav', { className: 'cat-bar', attrs: { 'aria-label': t('nav.categories') } },
    el('div', { className: 'container' },
      el('ul', { className: 'cat-list' }, catItems)));

  const header = el('div', { className: 'site-header-inner' }, top, catBar);
  // Keep the menu state valid after re-rendering.
  queueMicrotask(() => {
    const open = document.getElementById('main-nav')?.dataset.open === 'true';
    document.querySelector('.menu-toggle')?.setAttribute('aria-expanded', String(open));
  });
  return header;
}

function toggleMenu() {
  const nav = document.getElementById('main-nav');
  const toggle = document.querySelector('.menu-toggle');
  if (!nav || !toggle) return;
  const open = nav.dataset.open !== 'true';
  nav.dataset.open = String(open);
  toggle.setAttribute('aria-expanded', String(open));
  if (open) nav.querySelector('a, button')?.focus();
  else toggle.focus();
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const nav = document.getElementById('main-nav');
  if (nav?.dataset.open === 'true') toggleMenu();
});

function buildFooter(settings) {
  const contact = settings.contact || {};
  const lang = getLang();
  const configuredName = settings?.store_name;
  const storeName = (configuredName && typeof configuredName === 'object'
    ? configuredName[lang] || configuredName.en
    : configuredName) || 'POWER TECH';
  const txt = (v) => (v && typeof v === 'object' ? (v[lang] || v.en || '') : (v || ''));
  const rows = [];
  const addLink = (label, href) => rows.push(el('li', {}, el('a', { attrs: { href, rel: 'noopener' } }, label)));

  if (contact.phone) rows.push(el('li', {}, `${t('footer.phone')}: `, el('a', { attrs: { href: `tel:${String(contact.phone).replace(/[^+\d]/g, '')}` } }, String(contact.phone))));
  if (contact.email) rows.push(el('li', {}, `${t('footer.email')}: `, el('a', { attrs: { href: `mailto:${contact.email}` } }, String(contact.email))));
  if (contact.whatsapp_url) addLink(t('footer.whatsapp'), contact.whatsapp_url);
  if (txt(contact.address)) rows.push(el('li', {}, `${t('footer.address')}: ${txt(contact.address)}`));
  if (contact.map_url) addLink(t('footer.map'), contact.map_url);
  if (txt(contact.hours)) rows.push(el('li', {}, `${t('footer.hours')}: ${txt(contact.hours)}`));

  const social = [
    ['facebook_url', 'footer.facebook'], ['instagram_url', 'footer.instagram'],
    ['tiktok_url', 'footer.tiktok'], ['youtube_url', 'footer.youtube'],
  ].filter(([k]) => contact[k]);
  const socialList = social.map(([k, key]) => el('li', {}, el('a', { attrs: { href: contact[k], rel: 'noopener' } }, t(key))));

  const currency = settings.currency?.code || 'EGP';
  return el('div', { className: 'container footer-inner' },
    el('div', {},
      el('p', { className: 'footer-brand' }, storeName),
      el('p', { className: 'muted' }, t('app.tagline')),
      el('p', { className: 'hint' }, t('footer.note', { c: currency }))),
    rows.length ? el('div', {}, el('h2', { className: 'footer-h' }, t('footer.contact')), el('ul', { className: 'plain-list' }, rows)) : null,
    socialList.length ? el('div', {}, el('h2', { className: 'footer-h' }, t('footer.social')), el('ul', { className: 'plain-list' }, socialList)) : null);
}

/** Live cart count in the header. Keeps working across tabs via the storage event. */
export function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  const link = document.getElementById('cart-link');
  const count = cartCount();
  if (badge) badge.textContent = String(count);
  if (link) link.setAttribute('aria-label', t('cart.count_label', { n: count }));
}

window.addEventListener('cart:change', updateCartBadge);
window.addEventListener('storage', (e) => { if (e.key === 'pt_cart_v1') updateCartBadge(); });

/** Pages call this to re-render their own content in the new language. */
export function onLayoutLanguageChange(fn) {
  return onLangChange(() => {
    if (state.renderPending) return;
    state.renderPending = true;
    queueMicrotask(async () => {
      state.renderPending = false;
      await mountLayout({ active: document.body.dataset.page || '' });
      fn();
    });
  });
}
