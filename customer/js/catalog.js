// customer/js/catalog.js — catalog with search, filters, sort, progressive loading and URL state.
import { mountLayout, onLayoutLanguageChange } from './layout.js';
import { applyI18n, t, getLang, localized } from '/shared/i18n.js';
import { el, clear, errorMessage } from '/shared/ui.js';
import { isConfigured } from '/shared/supabase.js';
import { CONFIG } from '/shared/config.js';
import { formatNumber } from '/shared/format.js';
import { listCategories, listBrandNames, searchProducts, getImagesByProduct, sanitizeSearch } from './api.js';
import { grid, loadingBlock, errorBlock, emptyBlock } from './cards.js';

const main = document.getElementById('app');
const DEFAULTS = { q: '', category: '', brand: '', condition: '', min: '', max: '', inStock: false, sort: 'newest' };
const SORTS = ['newest', 'price_asc', 'price_desc', 'name'];

let state = { ...DEFAULTS, page: 0 };
let categories = [];
let brands = [];
let rows = [];
let images = new Map();
let total = 0;
let requestToken = 0;
let filtersOpen = false;

function readUrl() {
  const p = new URLSearchParams(location.search);
  state = {
    q: sanitizeSearch(p.get('q') || ''),
    category: /^[a-z0-9-]{0,80}$/.test(p.get('category') || '') ? p.get('category') : '',
    brand: (p.get('brand') || '').slice(0, 80),
    condition: ['new', 'used', 'refurbished'].includes(p.get('condition')) ? p.get('condition') : '',
    min: (p.get('min') || '').replace(/[^0-9.]/g, '').slice(0, 10),
    max: (p.get('max') || '').replace(/[^0-9.]/g, '').slice(0, 10),
    inStock: p.get('stock') === '1',
    sort: SORTS.includes(p.get('sort')) ? p.get('sort') : 'newest',
    page: 0,
  };
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.category) p.set('category', state.category);
  if (state.brand) p.set('brand', state.brand);
  if (state.condition) p.set('condition', state.condition);
  if (state.min) p.set('min', state.min);
  if (state.max) p.set('max', state.max);
  if (state.inStock) p.set('stock', '1');
  if (state.sort !== 'newest') p.set('sort', state.sort);
  const qs = p.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

async function init() {
  readUrl();
  await mountLayout({ active: 'catalog' });
  if (!isConfigured) {
    clear(main);
    main.append(errorBlock(t('state.not_configured')));
    return;
  }
  try {
    [categories, brands] = await Promise.all([listCategories(), listBrandNames()]);
  } catch (err) {
    categories = [];
    brands = [];
  }
  renderShell();
  await load();
  onLayoutLanguageChange(() => { renderShell(); renderResults(); });
  window.addEventListener('popstate', () => { readUrl(); renderShell(); load(); });
}

function renderShell() {
  const lang = getLang();
  const title = state.q
    ? t('catalog.results_for', { q: state.q })
    : t('catalog.title');
  document.title = `${state.q ? `${state.q} · ` : ''}${t('catalog.title')} · POWER TECH`;

  const form = el('form', { className: 'filters-grid', attrs: { id: 'filter-form', novalidate: true } },
    el('div', { className: 'field' },
      el('label', { attrs: { for: 'f-category', 'data-i18n': 'filters.category' } }, t('filters.category')),
      el('select', { className: 'select', attrs: { id: 'f-category', name: 'category' } },
        el('option', { attrs: { value: '' } }, t('filters.all')),
        categories.map((c) => el('option', { attrs: { value: c.slug, selected: c.slug === state.category ? 'selected' : null } },
          localized(c, 'name', lang))))),
    el('div', { className: 'field' },
      el('label', { attrs: { for: 'f-brand', 'data-i18n': 'filters.brand' } }, t('filters.brand')),
      el('select', { className: 'select', attrs: { id: 'f-brand', name: 'brand' } },
        el('option', { attrs: { value: '' } }, t('filters.all')),
        brands.map((b) => el('option', { attrs: { value: b, selected: b === state.brand ? 'selected' : null } }, b)))),
    el('div', { className: 'field' },
      el('label', { attrs: { for: 'f-condition', 'data-i18n': 'filters.condition' } }, t('filters.condition')),
      el('select', { className: 'select', attrs: { id: 'f-condition', name: 'condition' } },
        ['', 'new', 'used', 'refurbished'].map((v) => el('option', {
          attrs: { value: v, selected: v === state.condition ? 'selected' : null },
        }, v ? t(`condition.${v}`) : t('filters.all'))))),
    el('div', { className: 'form-grid two' },
      el('div', { className: 'field' },
        el('label', { attrs: { for: 'f-min', 'data-i18n': 'filters.price_min' } }, t('filters.price_min')),
        el('input', { className: 'input', attrs: { id: 'f-min', name: 'min', inputmode: 'decimal', value: state.min, placeholder: '0' } })),
      el('div', { className: 'field' },
        el('label', { attrs: { for: 'f-max', 'data-i18n': 'filters.price_max' } }, t('filters.price_max')),
        el('input', { className: 'input', attrs: { id: 'f-max', name: 'max', inputmode: 'decimal', value: state.max } }))),
    el('div', { className: 'checkbox-row' },
      el('input', { attrs: { id: 'f-stock', name: 'stock', type: 'checkbox', checked: state.inStock ? 'checked' : null } }),
      el('label', { attrs: { for: 'f-stock', 'data-i18n': 'filters.in_stock_only' } }, t('filters.in_stock_only'))),
    el('div', { className: 'row' },
      el('button', { className: 'btn btn-dark', attrs: { type: 'submit', 'data-i18n': 'catalog.apply' } }, t('catalog.apply')),
      el('button', { className: 'btn btn-ghost', attrs: { type: 'button', id: 'f-clear', 'data-i18n': 'catalog.clear' }, on: { click: clearFilters } }, t('catalog.clear'))),
    el('p', { className: 'status', attrs: { id: 'filter-status', role: 'status' }, dataset: { kind: 'error' }, hidden: true }));
  form.addEventListener('submit', onFilterSubmit);

  const sort = el('select', { className: 'select', attrs: { id: 'sort', 'aria-label': t('sort.label') } },
    SORTS.map((s) => el('option', { attrs: { value: s, selected: s === state.sort ? 'selected' : null } }, t(`sort.${s === 'newest' ? 'newest' : s}`))));
  sort.addEventListener('change', () => { state.sort = sort.value; state.page = 0; writeUrl(); load(); });

  clear(main);
  main.append(
    el('div', { className: 'page-head' },
      el('h1', { attrs: { id: 'catalog-title' } }, title),
      state.q ? el('a', { className: 'btn btn-ghost btn-small', attrs: { href: '/customer/catalog.html' } }, t('search.clear')) : null),
    el('div', { className: 'catalog-layout' },
      el('div', {},
        el('button', {
          className: 'btn btn-ghost filters-toggle', attrs: { type: 'button', 'aria-expanded': String(filtersOpen), 'aria-controls': 'filters' },
          on: { click: () => { filtersOpen = !filtersOpen; renderShell(); } },
        }, filtersOpen ? t('catalog.hide_filters') : t('catalog.show_filters')),
        el('aside', { className: 'filters', attrs: { id: 'filters', 'aria-label': t('catalog.filters') }, dataset: { collapsed: String(!filtersOpen) } },
          el('h2', { className: 'visually-hidden' }, t('catalog.filters')), form)),
      el('section', { attrs: { 'aria-labelledby': 'catalog-title' } },
        el('div', { className: 'toolbar' },
          el('p', { className: 'muted', attrs: { id: 'result-count', role: 'status', 'aria-live': 'polite' } }, ''),
          el('div', { className: 'row' }, el('label', { className: 'label', attrs: { for: 'sort' } }, t('sort.label')), sort)),
        el('div', { attrs: { id: 'results' } }))));
  renderResults();
}

function num(v) {
  const n = Number(v);
  return v === '' || !Number.isFinite(n) ? null : n;
}

function onFilterSubmit(event) {
  event.preventDefault();
  const f = new FormData(event.currentTarget);
  const min = num(f.get('min'));
  const max = num(f.get('max'));
  const status = document.getElementById('filter-status');
  if (min !== null && max !== null && min > max) {
    status.textContent = t('val.number');
    status.hidden = false;
    document.getElementById('f-min')?.setAttribute('aria-invalid', 'true');
    return;
  }
  status.hidden = true;
  state = {
    ...state,
    category: String(f.get('category') || ''),
    brand: String(f.get('brand') || ''),
    condition: String(f.get('condition') || ''),
    min: min === null ? '' : String(min),
    max: max === null ? '' : String(max),
    inStock: f.get('stock') === 'on',
    page: 0,
  };
  writeUrl();
  if (window.matchMedia('(max-width: 899px)').matches) filtersOpen = false;
  load();
  renderShell();
}

function clearFilters() {
  state = { ...state, category: '', brand: '', condition: '', min: '', max: '', inStock: false, page: 0 };
  writeUrl();
  renderShell();
  load();
}

/** Fetch a page. Stale responses (from an earlier request) are discarded. */
async function load({ append = false } = {}) {
  const token = ++requestToken;
  if (!append) {
    rows = [];
    images = new Map();
    renderResults(loadingBlock(t('catalog.loading')));
  }
  try {
    const result = await searchProducts({
      q: state.q,
      categorySlug: state.category,
      brand: state.brand,
      condition: state.condition,
      minPrice: num(state.min),
      maxPrice: num(state.max),
      inStockOnly: state.inStock,
      sort: state.sort,
      page: state.page,
    });
    const imgs = await getImagesByProduct(result.rows.map((r) => r.id));
    if (token !== requestToken) return;
    rows = append ? rows.concat(result.rows) : result.rows;
    images = append ? new Map([...images, ...imgs]) : imgs;
    total = result.count;
    renderResults();
  } catch (err) {
    if (token !== requestToken) return;
    renderResults(errorBlock(errorMessage(err), () => load()));
  }
}

function renderResults(override) {
  const box = document.getElementById('results');
  const count = document.getElementById('result-count');
  if (!box) return;
  clear(box);
  if (override) {
    box.append(override);
    if (count) count.textContent = '';
    return;
  }
  if (count) count.textContent = total ? t('catalog.count', { n: formatNumber(total, getLang()) }) : '';
  if (!rows.length) {
    box.append(emptyBlock(t('catalog.no_results')));
    return;
  }
  box.append(grid(rows, images));
  if (rows.length < total) {
    box.append(el('div', { className: 'load-more' },
      el('button', {
        className: 'btn btn-ghost', attrs: { type: 'button' },
        on: { click: (e) => { e.currentTarget.disabled = true; state.page += 1; load({ append: true }); } },
      }, t('catalog.load_more'))));
  }
  applyI18n(box);
}

init();
