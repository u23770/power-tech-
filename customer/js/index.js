// customer/js/index.js — homepage: editable hero, categories, featured, new arrivals, offers, why-shop.
import { mountLayout, onLayoutLanguageChange } from './layout.js';
import { applyI18n, t, getLang, localized } from '/shared/i18n.js';
import { el, clear, errorMessage } from '/shared/ui.js';
import { isConfigured } from '/shared/supabase.js';
import { getPublicSettings, listCategories, listHighlights, listOnSale, getImagesByProduct } from './api.js';
import { grid, loadingBlock, errorBlock, emptyBlock } from './cards.js';

const main = document.getElementById('app');
let settings = {};

async function init() {
  document.title = 'POWER TECH · Laptops, computers and tech';
  setMeta('description', 'Browse laptops, desktop computers, monitors, components, accessories and more. Check availability and order online.');
  setMeta('og:title', 'POWER TECH');
  setMeta('og:description', 'Laptops, computers and technology — browse and order online.');
  await mountLayout({ active: 'home' });
  applyI18n(document);
  await render();
  onLayoutLanguageChange(render);
}

function setMeta(name, content) {
  const attr = name.startsWith('og:') ? 'property' : 'name';
  let node = document.querySelector(`meta[${attr}="${name}"]`);
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute(attr, name);
    document.head.append(node);
  }
  node.setAttribute('content', content);
}

async function render() {
  if (!isConfigured) {
    clear(main);
    main.append(errorBlock(t('state.not_configured')));
    return;
  }
  clear(main);
  main.append(hero(), section('home.categories', loadingBlock()), section('home.featured', loadingBlock()),
    section('home.new', loadingBlock()), section('home.offers', loadingBlock()), whyShop());
  applyI18n(main);
  try {
    settings = await getPublicSettings();
  } catch (err) {
    settings = {};
  }
  // Each block loads independently: one failing section must not hide the rest of the homepage.
  await Promise.allSettled([
    fillCategories(),
    fillProducts('home.featured', () => listHighlights({ featured: true, limit: 8 })),
    fillProducts('home.new', () => listHighlights({ limit: 8 })),
    fillProducts('home.offers', () => listOnSale(8)),
  ]);
  replaceWhyShop();
  applyI18n(main);
}

function hero() {
  const lang = getLang();
  const content = settings.content_hero?.[lang] || {};
  const title = content.title || t('home.hero.title');
  const subtitle = content.subtitle || t('home.hero.subtitle');
  const cta = content.cta || t('home.hero.cta');
  return el('section', { className: 'hero', attrs: { 'aria-labelledby': 'hero-title' } },
    el('div', { className: 'hero-accent', attrs: { 'aria-hidden': 'true' } }),
    el('h1', { attrs: { id: 'hero-title' } }, title),
    el('p', {}, subtitle),
    el('a', { className: 'btn btn-primary', attrs: { href: '/customer/catalog.html' } }, cta));
}

function section(titleKey, body) {
  return el('section', { className: 'section', attrs: { 'aria-labelledby': `h-${titleKey}` } },
    el('div', { className: 'section-head' },
      el('h2', { attrs: { id: `h-${titleKey}`, 'data-i18n': titleKey } }, t(titleKey)),
      titleKey === 'home.categories' ? null : el('a', { attrs: { href: '/customer/catalog.html' }, className: 'muted', dataset: {} }, t('home.view_all'))),
    el('div', { dataset: { slot: titleKey } }, body));
}

function slotOf(key) {
  return main.querySelector(`[data-slot="${key}"]`);
}

async function fillCategories() {
  const slot = slotOf('home.categories');
  try {
    const cats = await listCategories();
    const lang = getLang();
    clear(slot);
    if (!cats.length) {
      slot.append(emptyBlock(t('state.empty')));
      return;
    }
    slot.append(el('nav', { className: 'tile-grid', attrs: { 'aria-label': t('home.categories') } },
      cats.map((c) => el('a', { className: 'tile', attrs: { href: `/customer/catalog.html?category=${encodeURIComponent(c.slug)}` } },
        localized(c, 'name', lang)))));
  } catch (err) {
    clear(slot);
    slot.append(errorBlock(errorMessage(err), fillCategories));
  }
}

async function fillProducts(key, loader) {
  const slot = slotOf(key);
  try {
    const rows = await loader();
    clear(slot);
    if (!rows.length) {
      slot.append(emptyBlock(t('home.no_products')));
      return;
    }
    const images = await getImagesByProduct(rows.map((r) => r.id));
    clear(slot);
    slot.append(grid(rows, images));
  } catch (err) {
    clear(slot);
    slot.append(errorBlock(errorMessage(err), () => fillProducts(key, loader)));
  }
}

/** Shown only when the owner has written real content in settings (content_why). No default claims. */
function whyShop() {
  return el('section', { className: 'section', dataset: { slot: 'why' } });
}

function replaceWhyShop() {
  const slot = main.querySelector('[data-slot="why"]');
  const items = settings.content_why?.[getLang()] || [];
  clear(slot);
  if (!Array.isArray(items) || !items.length) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.append(
    el('h2', { attrs: { 'data-i18n': 'home.why' } }, t('home.why')),
    el('div', { className: 'tile-grid' }, items.slice(0, 6).map((it) => el('div', { className: 'card' },
      el('h3', {}, String(it.title || '')),
      el('p', { className: 'muted', style: 'margin:0' }, String(it.text || ''))))));
}

init();
