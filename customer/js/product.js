// customer/js/product.js — product details: photos, price, stock, specs, used-unit selection, related items.
import { mountLayout, onLayoutLanguageChange } from './layout.js';
import { applyI18n, t, getLang, localized } from '/shared/i18n.js';
import { el, clear, errorMessage, setStatus, setBusy } from '/shared/ui.js';
import { formatMoney, productUrl } from '/shared/format.js';
import { addItem } from '/shared/cart.js';
import { isConfigured } from '/shared/supabase.js';
import {
  getProductBySlug, getImagesByProduct, getUnitsForProduct, getPublicSettings, searchProducts, imageUrl,
} from './api.js';
import { grid, loadingBlock, errorBlock, emptyBlock, priceBlock, stockBadge, conditionBadge } from './cards.js';
import { updateCartBadge } from './layout.js';

const main = document.getElementById('app');
const slug = new URLSearchParams(location.search).get('slug') || '';
let product = null;
let images = [];
let units = [];
let maxQty = 10;
let currentImage = 0;

async function init() {
  await mountLayout({ active: 'catalog' });
  if (!isConfigured) {
    clear(main);
    main.append(errorBlock(t('state.not_configured')));
    return;
  }
  await load();
  onLayoutLanguageChange(render);
}

async function load() {
  clear(main);
  main.append(loadingBlock());
  try {
    if (!slug || !/^[a-z0-9-]{2,120}$/.test(slug)) return notFound();
    product = await getProductBySlug(slug);
    if (!product) return notFound();
    const [imgMap, unitRows, settings] = await Promise.all([
      getImagesByProduct([product.id]),
      product.track_mode === 'unit' ? getUnitsForProduct(product.id) : Promise.resolve([]),
      getPublicSettings().catch(() => ({})),
    ]);
    images = imgMap.get(product.id) || [];
    units = unitRows;
    maxQty = Number(settings.max_qty_per_line) || 10;
    currentImage = 0;
    setSeo();
    render();
    loadRelated();
  } catch (err) {
    clear(main);
    main.append(errorBlock(errorMessage(err), load));
  }
}

function notFound() {
  clear(main);
  document.title = `${t('product.not_found')} · POWER TECH`;
  main.append(emptyBlock(t('product.not_found'), '/customer/catalog.html', 'catalog.title'));
}

function setSeo() {
  const lang = getLang();
  const title = localized(product, 'title', lang);
  document.title = `${title} · POWER TECH`;
  const desc = (localized(product, 'description', lang) || title).slice(0, 160);
  setMeta('name', 'description', desc);
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', desc);
  setMeta('property', 'og:type', 'product');
  setMeta('property', 'og:url', productUrl(product.slug));
  if (images[0]) setMeta('property', 'og:image', imageUrl(images[0].storage_path));

  // Canonical URL uses the current origin (no placeholder domain).
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.append(canonical);
  }
  canonical.href = productUrl(product.slug);

  // JSON-LD only from real stored fields. Availability reflects stock_state; never invented.
  const existing = document.getElementById('product-jsonld');
  existing?.remove();
  if (product.price !== null && product.price !== undefined) {
    const availability = {
      in_stock: 'https://schema.org/InStock',
      low_stock: 'https://schema.org/LimitedAvailability',
      out_of_stock: 'https://schema.org/OutOfStock',
    }[product.stock_state] || 'https://schema.org/OutOfStock';
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title_en || product.title_ar || '',
      url: productUrl(product.slug),
      offers: {
        '@type': 'Offer',
        priceCurrency: product.currency,
        price: String(product.track_mode === 'unit' ? product.effective_price : (product.sale_price ?? product.price)),
        availability,
      },
    };
    if (product.sku) data.sku = product.sku;
    if (product.brand_name) data.brand = { '@type': 'Brand', name: product.brand_name };
    if (product.model_number) data.mpn = product.model_number;
    if (product.description_en) data.description = product.description_en;
    if (images[0]) data.image = imageUrl(images[0].storage_path);
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'product-jsonld';
    script.textContent = JSON.stringify(data);
    document.head.append(script);
  }
}

function setMeta(attr, name, content) {
  let node = document.querySelector(`meta[${attr}="${name}"]`);
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute(attr, name);
    document.head.append(node);
  }
  node.setAttribute('content', content);
}

function render() {
  if (!product) return;
  const lang = getLang();
  const title = localized(product, 'title', lang);
  clear(main);
  document.title = `${title} · POWER TECH`;

  const crumbs = el('nav', { attrs: { 'aria-label': 'Breadcrumb' }, className: 'muted', style: 'font-size:.9rem' },
    el('a', { attrs: { href: '/customer/catalog.html' } }, t('catalog.title')),
    product.category_slug
      ? [' / ', el('a', { attrs: { href: `/customer/catalog.html?category=${encodeURIComponent(product.category_slug)}` } },
        localized({ name_en: product.category_name_en, name_ar: product.category_name_ar }, 'name', lang))]
      : null,
    ' / ', title);

  const stateNote = product.stock_state === 'out_of_stock' ? el('p', { className: 'notice' }, t('stock.out_of_stock')) : null;
  const addStatus = el('div', { attrs: { id: 'add-status', role: 'status', 'aria-live': 'polite' }, className: 'status', hidden: true });

  main.append(
    crumbs,
    el('div', { className: 'detail', style: 'margin-top:1rem' },
      gallery(title),
      el('div', { className: 'stack' },
        el('div', { className: 'row' }, conditionBadge(product.condition), stockBadge(product.stock_state)),
        el('h1', {}, title),
        el('p', { className: 'muted', style: 'margin:0' },
          [product.brand_name, product.model_number].filter(Boolean).join(' · ')),
        el('div', { className: 'buy-box' },
          el('div', { className: 'buy-price', attrs: { 'aria-label': t('product.price') } }, priceBlock(product)),
          product.track_mode === 'unit' ? unitSection(lang) : quantitySection(),
          stateNote,
          addStatus,
          el('div', { className: 'share-row' },
            el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: copyLink } }, t('product.share')))),
        el('div', {},
          el('h2', { attrs: { 'data-i18n': 'product.specs' } }, t('product.specs')),
          specsTable()),
        el('div', {},
          el('h2', { attrs: { 'data-i18n': 'product.warranty' } }, t('product.warranty')),
          el('p', {}, localized(product, 'warranty_text', lang) || t('product.no_warranty'))),
        el('div', {},
          el('h2', { attrs: { 'data-i18n': 'product.description' } }, t('product.description')),
          el('div', { className: 'description' }, localized(product, 'description', lang) || t('product.no_description')))),
    ),
    el('section', { className: 'section', attrs: { 'aria-labelledby': 'related-h' } },
      el('h2', { attrs: { id: 'related-h', 'data-i18n': 'product.related' } }, t('product.related')),
      el('div', { attrs: { id: 'related' } }, loadingBlock())));

  applyI18n(main);
  if (product.track_mode !== 'unit') {
    bindGallery();
  }
}

function gallery(title) {
  if (!images.length) {
    return el('div', { className: 'gallery' }, el('div', { className: 'gallery-main' },
      el('span', { className: 'muted', attrs: { 'data-i18n': 'product.no_image' } }, t('product.no_image'))));
  }
  const lang = getLang();
  const current = images[currentImage] || images[0];
  return el('div', { className: 'gallery', attrs: { id: 'gallery' } },
    el('div', { className: 'gallery-main' },
      el('img', { attrs: { id: 'gallery-img', src: imageUrl(current.storage_path), alt: localized(current, 'alt', lang) || title, width: 800, height: 600, decoding: 'async' } })),
    images.length > 1 ? el('div', { className: 'gallery-thumbs', attrs: { role: 'group', 'aria-label': t('admin.images') } },
      images.map((img, idx) => el('button', {
        attrs: { type: 'button', 'aria-pressed': String(idx === currentImage), 'aria-label': `${idx + 1}` },
        dataset: { idx },
      }, el('img', { attrs: { src: imageUrl(img.storage_path), alt: '', loading: 'lazy', width: 64, height: 64 } })))) : null);
}

function bindGallery() {
  document.querySelectorAll('.gallery-thumbs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentImage = Number(btn.dataset.idx) || 0;
      const img = images[currentImage];
      const mainImg = document.getElementById('gallery-img');
      if (mainImg && img) {
        mainImg.src = imageUrl(img.storage_path);
        mainImg.alt = localized(img, 'alt', getLang()) || localized(product, 'title', getLang());
      }
      document.querySelectorAll('.gallery-thumbs button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });
}

function quantitySection() {
  const canBuy = product.status === 'published' && product.stock_state !== 'out_of_stock';
  const select = el('select', { className: 'select', attrs: { id: 'qty', 'aria-label': t('product.qty') } },
    Array.from({ length: maxQty }, (_, i) => el('option', { attrs: { value: i + 1 } }, String(i + 1))));
  const button = el('button', {
    className: 'btn btn-primary',
    attrs: { type: 'button', id: 'add-btn', disabled: canBuy ? null : true, 'data-i18n': 'product.add' },
    on: { click: () => {
      const qty = Number(select.value) || 1;
      addToCart(product.id, null, qty, button);
    } },
  }, t('product.add'));
  return el('div', { className: 'row' },
    el('label', { attrs: { for: 'qty' }, className: 'label' }, t('product.qty')), select, button);
}

function unitSection(lang) {
  if (!units.length) {
    return el('p', { className: 'muted' }, t('product.no_units'));
  }
  return el('div', { className: 'stack' },
    el('p', { className: 'hint' }, t('product.unit_note')),
    el('ul', { className: 'unit-list', attrs: { style: 'list-style:none;padding:0;margin:0' } },
      units.map((u) => el('li', { className: 'unit-card' },
        el('div', { className: 'row' },
          el('strong', {}, formatMoney(u.selling_price, product.currency, lang)),
          u.condition_grade ? el('span', { className: 'badge badge-dark' }, `${t('product.grade')}: ${u.condition_grade}`) : null,
          u.battery_health_pct !== null && u.battery_health_pct !== undefined
            ? el('span', { className: 'badge' }, `${t('product.battery')}: ${u.battery_health_pct}%`) : null),
        localized(u, 'cosmetic_notes', lang) ? el('p', { className: 'muted', style: 'margin:0' }, `${t('product.cosmetic')}: ${localized(u, 'cosmetic_notes', lang)}`) : null,
        u.included_accessories ? el('p', { className: 'muted', style: 'margin:0' }, `${t('product.accessories')}: ${u.included_accessories}`) : null,
        u.warranty_text ? el('p', { className: 'muted', style: 'margin:0' }, `${t('product.warranty')}: ${u.warranty_text}`) : null,
        el('button', {
          className: 'btn btn-primary btn-small', attrs: { type: 'button', 'aria-label': `${t('product.choose_unit')}: ${formatMoney(u.selling_price, product.currency, lang)}` },
          on: { click: (e) => addToCart(product.id, u.id, 1, e.currentTarget) },
        }, t('product.choose_unit'))))));
}

function specsTable() {
  const specs = product.specs && typeof product.specs === 'object' ? Object.entries(product.specs) : [];
  if (!specs.length) return el('p', { className: 'muted' }, t('state.empty'));
  return el('div', { className: 'table-wrap' },
    el('table', { className: 'specs' },
      el('tbody', {}, specs.map(([k, v]) => el('tr', {},
        el('th', { attrs: { scope: 'row' } }, k.replace(/_/g, ' ')),
        el('td', {}, String(v)))))));
}

function addToCart(productId, unitId, qty, button) {
  const status = document.getElementById('add-status');
  try {
    addItem({ productId, unitId, qty, maxQty });
    updateCartBadge();
    clear(status);
    status.append(`${t('product.added')}. `, el('a', { attrs: { href: '/customer/cart.html' } }, t('nav.cart')));
    setStatus(status, status.textContent, 'success');
  } catch (err) {
    setStatus(status, t('err.quantity_limit'), 'error');
  }
  if (button) button.blur?.();
}

async function copyLink() {
  const status = document.getElementById('add-status');
  try {
    await navigator.clipboard.writeText(productUrl(product.slug));
    setStatus(status, t('product.link_copied'), 'success');
  } catch {
    setStatus(status, t('product.copy_failed'), 'error');
  }
}

async function loadRelated() {
  const box = document.getElementById('related');
  if (!box || !product.category_slug) {
    if (box) { clear(box); box.append(emptyBlock(t('state.empty'))); }
    return;
  }
  try {
    const { rows } = await searchProducts({ categorySlug: product.category_slug, page: 0 });
    const others = rows.filter((r) => r.id !== product.id).slice(0, 4);
    const imgs = await getImagesByProduct(others.map((r) => r.id));
    clear(box);
    box.append(others.length ? grid(others, imgs) : emptyBlock(t('state.empty')));
  } catch (err) {
    clear(box);
    box.append(errorBlock(errorMessage(err)));
  }
}

init();
