// admin/js/views/products.js — product list and editor (create/update, images, cost, units).
import { t, getLang, applyI18n } from '/shared/i18n.js';
import { el, clear, setStatus, setBusy, errorMessage, confirmAction } from '/shared/ui.js';
import { formatMoney } from '/shared/format.js';
import { PATTERNS, parseSpecs, specsToText, slugify } from '/shared/validators.js';
import * as api from '../api.js';
import { serializeCsvRows, prepareProductImport } from '../csv.js';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const STATUSES = ['draft', 'published', 'unavailable', 'archived'];
const CONDITIONS = ['new', 'used', 'refurbished'];
const TRACK_MODES = ['quantity', 'unit'];

export async function render(main, ctx) {
  if (ctx.id === 'new') return renderEditor(main, ctx, null);
  if (ctx.id) return renderEditor(main, ctx, ctx.id);
  return renderList(main, ctx);
}

// ---------- List ----------
async function renderList(main, ctx) {
  const lang = getLang();
  const q = ctx.query.get('q') || '';
  const status = ctx.query.get('status') || '';
  const page = Number(ctx.query.get('page') || 0);
  const pageSize = 25;

  const search = el('input', { className: 'input', attrs: { type: 'search', name: 'q', value: q, maxlength: '80', 'aria-label': t('admin.search'), placeholder: t('admin.search') } });
  const statusSel = el('select', { className: 'select', attrs: { name: 'status', 'aria-label': t('admin.status') } },
    el('option', { attrs: { value: '' } }, t('admin.all')),
    ...STATUSES.map((s) => el('option', { attrs: { value: s, selected: s === status ? 'selected' : null } }, t(`admin.product_status.${s}`))));
  const form = el('form', { className: 'filter-bar', attrs: { role: 'search' } },
    el('div', { className: 'field' }, el('label', { attrs: { for: 'p-q' } }, t('admin.search')), Object.assign(search, { id: 'p-q' })),
    el('div', { className: 'field' }, el('label', { attrs: { for: 'p-status' } }, t('admin.status')), Object.assign(statusSel, { id: 'p-status' })),
    el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.search')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (search.value.trim()) params.set('q', search.value.trim());
    if (statusSel.value) params.set('status', statusSel.value);
    location.hash = `#/products${params.toString() ? `?${params}` : ''}`;
  });

  const host = el('div', {}, el('p', { className: 'muted', attrs: { role: 'status' } }, t('admin.loading')));
  main.append(
    el('div', { className: 'page-title' },
      el('h1', { className: 'card-title' }, t('admin.nav.products')),
      ctx.can('staff') ? el('a', { className: 'btn btn-gold', attrs: { href: '#/products/new' } }, t('admin.new_product')) : null),
    ctx.can('manager') ? createCsvTools(ctx) : null,
    form, host);

  const { rows, count } = await api.listProductsAdmin({ q, status, page, pageSize });
  clear(host);
  if (!rows.length) {
    host.append(el('p', { className: 'muted' }, t('admin.no_results')));
    applyI18n(main);
    return;
  }
  const thead = el('thead', {}, el('tr', {},
    el('th', {}, t('admin.col.product')), el('th', {}, t('admin.col.sku')), el('th', {}, t('admin.col.price')),
    el('th', {}, t('admin.col.status')), el('th', {}, t('admin.col.stock'))));
  const tbody = el('tbody', {}, ...rows.map((p) => {
    const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
    const stock = p.track_mode === 'unit' ? t('admin.unit_tracked') : (inv ? String(inv.quantity_on_hand) : '0');
    const title = (lang === 'ar' && p.title_ar) ? p.title_ar : p.title_en;
    return el('tr', {},
      el('td', { dataset: { label: t('admin.col.product') } }, el('a', { attrs: { href: `#/products/${p.id}` } }, title)),
      el('td', { className: 'code', dataset: { label: t('admin.col.sku') } }, p.sku || '—'),
      el('td', { className: 'num money', dataset: { label: t('admin.col.price') } },
        p.sale_price ? `${formatMoney(p.sale_price, p.currency, lang)} (${formatMoney(p.price, p.currency, lang)})` : formatMoney(p.price, p.currency, lang)),
      el('td', { dataset: { label: t('admin.col.status') } }, t(`admin.product_status.${p.status}`)),
      el('td', { className: 'num', dataset: { label: t('admin.col.stock') } }, stock));
  }));
  host.append(
    el('div', { className: 'table-wrap' }, el('table', {}, thead, tbody)),
    pager(count, page, pageSize, (p) => {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      params.set('page', String(p));
      location.hash = `#/products?${params}`;
    }));
  applyI18n(host);
}


function createCsvTools(ctx) {
  const section = el('section', { className: 'card form', attrs: { 'aria-labelledby': 'csv-tools-title' } });
  const file = el('input', { className: 'input', attrs: {
    id: 'products-csv-file', name: 'file', type: 'file', accept: '.csv,text/csv',
    'aria-label': t('admin.csv.file'),
  } });
  const note = el('p', { className: 'muted' }, t('admin.csv.intro'));
  const status = el('div', { className: 'status', attrs: { role: 'status', 'aria-live': 'polite', hidden: true } });
  const preview = el('div', { className: 'stack' });
  const validateBtn = el('button', { className: 'btn btn-dark', attrs: { type: 'button' } }, t('admin.csv.validate'));
  const importBtn = el('button', { className: 'btn btn-gold', attrs: { type: 'button', disabled: 'disabled' } }, t('admin.csv.import'));
  const exportBtn = el('button', { className: 'btn btn-ghost', attrs: { type: 'button' } }, t('admin.csv.export'));
  const templateLink = el('a', { className: 'btn btn-ghost', attrs: { href: '/data/products-template.csv', download: 'products-template.csv' } }, t('admin.csv.template'));
  section.append(
    el('h2', { className: 'card-title', attrs: { id: 'csv-tools-title' } }, t('admin.csv.title')),
    note,
    el('div', { className: 'field' }, el('label', { attrs: { for: 'products-csv-file' } }, t('admin.csv.file')), file),
    el('div', { className: 'row' }, templateLink, exportBtn, validateBtn, importBtn),
    status, preview
  );

  let prepared = null;
  file.addEventListener('change', () => {
    prepared = null;
    importBtn.disabled = true;
    clear(preview);
    setStatus(status, '', 'info');
  });

  validateBtn.addEventListener('click', async () => {
    const selected = file.files?.[0];
    prepared = null;
    importBtn.disabled = true;
    clear(preview);
    if (!selected) return setStatus(status, t('admin.csv.no_file'), 'error');
    if (selected.size > 5 * 1024 * 1024) return setStatus(status, t('admin.csv.file_too_large'), 'error');

    setBusy(validateBtn, true, t('state.loading'));
    try {
      const [csvText, existingProducts, categories, brands] = await Promise.all([
        selected.text(),
        api.listProductsForCsvAdmin(),
        api.listCategoriesAdmin(),
        api.listBrandsAdmin(),
      ]);
      const result = prepareProductImport(csvText, { existingProducts, categories, brands });
      prepared = result;
      if (result.errors.length) {
        const visible = result.errors.slice(0, 20);
        const errorList = el('ul', { className: 'item-list' }, ...visible.map((error) =>
          el('li', {}, t('admin.csv.line_error', { line: error.line, message: t(`admin.csv.error.${error.code}`) }))
        ));
        preview.append(
          el('div', { className: 'status', attrs: { role: 'alert' }, dataset: { kind: 'error' } },
            t('admin.csv.validation_failed', { count: result.errors.length })),
          errorList
        );
        if (result.errors.length > visible.length) {
          preview.append(el('p', { className: 'muted' }, t('admin.csv.more_errors', { count: result.errors.length - visible.length })));
        }
        setStatus(status, t('admin.csv.fix_errors'), 'error');
      } else if (!result.items.length) {
        setStatus(status, t('admin.csv.no_importable_rows'), 'error');
      } else {
        importBtn.disabled = false;
        setStatus(status, t('admin.csv.preview_ready', {
          count: result.items.length, skipped: result.skipped,
        }), 'success');
        preview.append(el('p', { className: 'muted' }, t('admin.csv.import_add_only')));
      }
    } catch (err) {
      prepared = null;
      setStatus(status, t(err?.message === 'invalid_csv_quote' || err?.message === 'invalid_csv_quotes'
        ? 'admin.csv.invalid_format' : 'err.unknown'), 'error');
    } finally {
      setBusy(validateBtn, false);
    }
  });

  exportBtn.addEventListener('click', async () => {
    setBusy(exportBtn, true, t('state.loading'));
    try {
      const [products, categories, brands] = await Promise.all([
        api.listProductsForCsvAdmin(), api.listCategoriesAdmin(), api.listBrandsAdmin(),
      ]);
      const categoryById = new Map(categories.map((row) => [row.id, row.slug]));
      const brandById = new Map(brands.map((row) => [row.id, row.name]));
      const headers = [
        'is_example', 'sku', 'slug', 'title_en', 'title_ar', 'brand', 'category_slug',
        'condition', 'track_mode', 'price', 'sale_price', 'currency', 'status',
        'model_number', 'warranty_text_en', 'warranty_text_ar', 'description_en',
        'description_ar', 'specs', 'quantity', 'is_featured', 'low_stock_threshold',
      ];
      const output = [headers];
      for (const product of products) {
        const inventory = Array.isArray(product.inventory) ? product.inventory[0] : product.inventory;
        const specs = Object.entries(product.specs || {}).map(([key, value]) => `${key}: ${value}`).join('; ');
        output.push([
          'no', product.sku || '', product.slug, product.title_en, product.title_ar || '',
          brandById.get(product.brand_id) || '', categoryById.get(product.category_id) || '',
          product.condition, product.track_mode, product.price, product.sale_price ?? '',
          String(product.currency || 'EGP').trim(), product.status, product.model_number || '',
          product.warranty_text_en || '', product.warranty_text_ar || '',
          product.description_en || '', product.description_ar || '', specs,
          inventory?.quantity_on_hand ?? 0, product.is_featured ? 'yes' : 'no',
          inventory?.low_stock_threshold ?? 0,
        ]);
      }
      const blob = new Blob([serializeCsvRows(output)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = el('a', { attrs: { href: url, download: `power-tech-products-${new Date().toISOString().slice(0, 10)}.csv` } });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(status, t('admin.csv.export_done', { count: products.length }), 'success');
    } catch (err) {
      setStatus(status, errorMessage(err), 'error');
    } finally {
      setBusy(exportBtn, false);
    }
  });

  importBtn.addEventListener('click', async () => {
    if (!prepared?.items?.length || prepared.errors.length) return;
    if (!(await confirmAction(t('admin.csv.confirm_import', { count: prepared.items.length })))) return;
    const items = prepared.items;
    prepared = null;
    importBtn.disabled = true;
    setBusy(importBtn, true, t('admin.csv.importing'));
    let created = 0;
    let failed = 0;
    let stockWarnings = 0;
    const failures = [];
    try {
      for (const item of items) {
        let id;
        try {
          id = await api.insertProduct(item.product);
          created += 1;
        } catch (err) {
          failed += 1;
          if (failures.length < 5) failures.push(t('admin.csv.row_failed', {
            line: item.line, message: errorMessage(err),
          }));
          continue;
        }
        if (item.quantity > 0) {
          try {
            await api.adjustStock(id, item.quantity, 'CSV import');
          } catch (err) {
            stockWarnings += 1;
            if (failures.length < 5) failures.push(t('admin.csv.stock_failed', {
              line: item.line, message: errorMessage(err),
            }));
          }
        }
        if (item.lowStockThreshold > 0) {
          try {
            await api.setLowStockThreshold(id, item.lowStockThreshold);
          } catch (err) {
            stockWarnings += 1;
            if (failures.length < 5) failures.push(t('admin.csv.threshold_failed', {
              line: item.line, message: errorMessage(err),
            }));
          }
        }
      }
      const message = t('admin.csv.import_result', { created, failed, stockWarnings });
      try { sessionStorage.setItem('pt_admin_csv_flash', message); } catch {}
      if (failures.length) {
        setStatus(status, message, failed || stockWarnings ? 'error' : 'success');
        preview.replaceChildren(el('ul', { className: 'item-list' }, ...failures.map((failure) => el('li', {}, failure))));
      } else {
        setStatus(status, message, failed || stockWarnings ? 'error' : 'success');
      }
      ctx.refresh();
    } finally {
      setBusy(importBtn, false);
      importBtn.disabled = true;
    }
  });

  try {
    const flash = sessionStorage.getItem('pt_admin_csv_flash');
    if (flash) {
      sessionStorage.removeItem('pt_admin_csv_flash');
      setStatus(status, flash, 'success');
    }
  } catch {}
  applyI18n(section);
  return section;
}


function pager(total, page, pageSize, go) {
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  if (last === 0) return el('p', { className: 'muted' }, t('admin.count', { n: total }));
  return el('nav', { className: 'pager', attrs: { 'aria-label': t('admin.pagination') } },
    btn(t('admin.prev'), page <= 0, () => go(page - 1)),
    el('span', { className: 'muted' }, t('admin.page_of', { p: page + 1, n: last + 1 })),
    btn(t('admin.next'), page >= last, () => go(page + 1)));
}

function btn(label, disabled, onClick) {
  return el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button', disabled: disabled ? 'disabled' : null }, on: { click: onClick } }, label);
}

// ---------- Editor ----------
async function renderEditor(main, ctx, id) {
  const isNew = !id;
  let product = null;
  let cost = null;
  let images = [];
  let inventory = null;
  if (!isNew) {
    product = await api.getProductAdmin(id);
    if (!product) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    cost = ctx.can('manager') ? await api.getProductCost(id) : null;
    images = product.product_images || [];
    inventory = Array.isArray(product.inventory) ? product.inventory[0] : product.inventory;
  }
  const [categories, brands] = await Promise.all([api.listCategoriesAdmin(), api.listBrandsAdmin()]);
  const p = product || { status: 'draft', condition: 'new', track_mode: 'quantity', currency: 'EGP', specs: {}, is_featured: false };
  const canEdit = ctx.can('staff');
  const canManager = ctx.can('manager');
  const lang = getLang();

  const dis = canEdit ? {} : { disabled: 'disabled' };
  const field = (label, input, hint) => el('div', { className: 'field' }, el('label', { attrs: { for: input.id } }, label), input, hint ? el('small', { className: 'muted' }, hint) : null);
  const inp = (name, value = '', attrs = {}) => el('input', { className: 'input', attrs: { id: `f-${name}`, name, value: value ?? '', ...attrs, ...dis } });
  const sel = (name, options, value) => el('select', { className: 'select', attrs: { id: `f-${name}`, name, ...dis } },
    ...options.map(([v, label]) => el('option', { attrs: { value: v, selected: v === value ? 'selected' : null } }, label)));
  const area = (name, value = '', attrs = {}) => el('textarea', { className: 'textarea', attrs: { id: `f-${name}`, name, rows: '4', ...attrs, ...dis } }, value ?? '');

  const f = {
    title_en: inp('title_en', p.title_en, { required: 'required', maxlength: '200' }),
    title_ar: inp('title_ar', p.title_ar, { maxlength: '200', dir: 'rtl' }),
    slug: inp('slug', p.slug, { maxlength: '120', pattern: '[a-z0-9-]{2,120}' }),
    sku: inp('sku', p.sku, { maxlength: '64' }),
    model_number: inp('model_number', p.model_number, { maxlength: '80' }),
    brand: inp('brand', brands.find((b) => b.id === p.brand_id)?.name || '', { list: 'brand-list', maxlength: '80' }),
    category_id: sel('category_id', [['', '—'], ...categories.map((c) => [c.id, lang === 'ar' && c.name_ar ? c.name_ar : c.name_en])], p.category_id || ''),
    condition: sel('condition', CONDITIONS.map((c) => [c, t(`admin.condition.${c}`)]), p.condition),
    track_mode: sel('track_mode', TRACK_MODES.map((m) => [m, t(`admin.track_mode.${m}`)]), p.track_mode),
    status: sel('status', STATUSES.map((s) => [s, t(`admin.product_status.${s}`)]), p.status),
    price: inp('price', p.price, { inputmode: 'decimal', required: 'required', maxlength: '13' }),
    sale_price: inp('sale_price', p.sale_price || '', { inputmode: 'decimal', maxlength: '13' }),
    currency: inp('currency', p.currency, { maxlength: '3', pattern: '[A-Z]{3}' }),
    cost_price: inp('cost_price', cost ?? '', { inputmode: 'decimal', maxlength: '13' }),
    warranty_text_en: area('warranty_text_en', p.warranty_text_en, { maxlength: '500' }),
    warranty_text_ar: area('warranty_text_ar', p.warranty_text_ar, { maxlength: '500', dir: 'rtl' }),
    description_en: area('description_en', p.description_en, { maxlength: '5000' }),
    description_ar: area('description_ar', p.description_ar, { maxlength: '5000', dir: 'rtl' }),
    specs: area('specs', specsToText(p.specs), { maxlength: '6000', 'aria-describedby': 'specs-hint' }),
    low_stock: inp('low_stock', inventory?.low_stock_threshold ?? 0, { inputmode: 'numeric', maxlength: '6' }),
    is_featured: el('input', { attrs: { id: 'f-is_featured', name: 'is_featured', type: 'checkbox', checked: p.is_featured ? 'checked' : null, ...dis } }),
  };

  const status = el('div', { className: 'status', attrs: { role: 'alert', hidden: true }, dataset: { kind: 'error' } });
  const titleH = el('h1', { className: 'card-title', attrs: { id: 'editor-title' } }, isNew ? t('admin.new_product') : (lang === 'ar' && p.title_ar ? p.title_ar : p.title_en));

  const form = el('form', { className: 'card form', attrs: { novalidate: true, 'aria-labelledby': 'editor-title' } },
    el('div', { className: 'two-col' },
      el('fieldset', { className: 'card' },
        el('legend', { attrs: { 'data-i18n': 'admin.section.basic' } }, t('admin.section.basic')),
        field(t('admin.f.title_en'), f.title_en), field(t('admin.f.title_ar'), f.title_ar),
        field(t('admin.f.slug'), f.slug, t('admin.hint.slug')),
        field(t('admin.f.sku'), f.sku), field(t('admin.f.model_number'), f.model_number),
        field(t('admin.f.brand'), f.brand, t('admin.hint.brand')),
        field(t('admin.f.category'), f.category_id),
        field(t('admin.f.condition'), f.condition), field(t('admin.f.track_mode'), f.track_mode, t('admin.hint.track_mode')),
        field(t('admin.f.status'), f.status)),
      el('fieldset', { className: 'card' },
        el('legend', { attrs: { 'data-i18n': 'admin.section.pricing' } }, t('admin.section.pricing')),
        field(t('admin.f.price'), f.price), field(t('admin.f.sale_price'), f.sale_price, t('admin.hint.sale_price')),
        field(t('admin.f.currency'), f.currency),
        canManager ? field(t('admin.f.cost_price'), f.cost_price, t('admin.hint.cost_price')) : el('p', { className: 'muted' }, t('admin.cost_hidden')),
        field(t('admin.f.low_stock'), f.low_stock),
        el('div', { className: 'field' }, el('label', { className: 'row', attrs: { for: 'f-is_featured' } }, f.is_featured, ' ', t('admin.f.featured')))),
    ),
    el('div', { className: 'two-col' },
      el('fieldset', { className: 'card' },
        el('legend', { attrs: { 'data-i18n': 'admin.section.content' } }, t('admin.section.content')),
        field(t('admin.f.description_en'), f.description_en), field(t('admin.f.description_ar'), f.description_ar),
        field(t('admin.f.warranty_en'), f.warranty_text_en, t('admin.hint.warranty')), field(t('admin.f.warranty_ar'), f.warranty_text_ar)),
      el('fieldset', { className: 'card' },
        el('legend', { attrs: { 'data-i18n': 'admin.section.specs' } }, t('admin.section.specs')),
        field(t('admin.f.specs'), f.specs, t('admin.hint.specs')),
        el('p', { className: 'muted', attrs: { id: 'specs-hint' } }, t('admin.hint.specs_format')))),
    el('datalist', { attrs: { id: 'brand-list' } }, ...brands.map((b) => el('option', { attrs: { value: b.name } }))),
    status,
    canEdit ? el('div', { className: 'form-actions' },
      el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.save')),
      el('a', { className: 'btn btn-ghost', attrs: { href: '#/products' } }, t('admin.back')),
      !isNew && canManager ? el('button', { className: 'btn btn-ghost', attrs: { type: 'button', id: 'archive-btn' } }, t('admin.archive')) : null) : null);

  // Auto-slug for new products until the owner edits the slug manually.
  let slugTouched = !isNew;
  f.slug.addEventListener('input', () => { slugTouched = true; });
  f.title_en.addEventListener('input', () => {
    if (!slugTouched) f.slug.value = slugify(f.title_en.value);
  });

  // Mark the form dirty on any change so routing can warn before discarding edits.
  form.addEventListener('input', () => ctx.setDirty(true));
  form.addEventListener('change', () => ctx.setDirty(true));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const errors = validateForm(f, lang);
    if (!f.title_en.value.trim()) errors.unshift(t('admin.err.title_required'));
    if (errors.length) return setStatus(status, errors.join(' '), 'error');
    const { specs, errors: specErrors } = parseSpecs(f.specs.value);
    if (specErrors.length) return setStatus(status, specErrors.join(' '), 'error');

    setBusy(submitBtn, true);
    setStatus(status, '', 'info');
    try {
      const brandId = await api.findOrCreateBrand(f.brand.value, canManager);
      const row = {
        slug: f.slug.value.trim(),
        sku: f.sku.value.trim() || null,
        model_number: f.model_number.value.trim() || null,
        brand_id: brandId,
        category_id: f.category_id.value || null,
        title_en: f.title_en.value.trim(),
        title_ar: f.title_ar.value.trim() || null,
        description_en: f.description_en.value.trim() || null,
        description_ar: f.description_ar.value.trim() || null,
        condition: f.condition.value,
        track_mode: f.track_mode.value,
        status: f.status.value,
        price: f.price.value.trim(),
        sale_price: f.sale_price.value.trim() || null,
        currency: f.currency.value.trim().toUpperCase() || 'EGP',
        warranty_text_en: f.warranty_text_en.value.trim() || null,
        warranty_text_ar: f.warranty_text_ar.value.trim() || null,
        is_featured: f.is_featured.checked,
        specs,
      };
      let savedId = id;
      if (isNew) savedId = await api.insertProduct(row);
      else await api.updateProduct(id, row);
      if (canManager && f.cost_price.value.trim() !== '') {
        if (!MONEY.test(f.cost_price.value.trim())) throw Object.assign(new Error('invalid_money'), { code: 'invalid_money' });
        await api.saveProductCost(savedId, f.cost_price.value.trim());
      }
      if (canManager && !isNew && inventory) {
        const threshold = Number(f.low_stock.value);
        if (Number.isInteger(threshold) && threshold >= 0 && threshold !== inventory.low_stock_threshold) {
          await api.setLowStockThreshold(savedId, threshold);
        }
      }
      ctx.setDirty(false);
      // Navigate to the saved product (new products get a real id). Shows a confirmation via the status bar.
      sessionStorage.setItem('pt_admin_flash', t('admin.saved'));
      if (isNew) location.hash = `#/products/${savedId}`;
      else ctx.refresh();
    } catch (err) {
      setStatus(status, errorMessage(err), 'error');
    } finally {
      setBusy(submitBtn, false);
    }
  });

  main.append(
    el('div', { className: 'page-title' }, titleH,
      el('a', { className: 'btn btn-ghost btn-small', attrs: { href: '#/products' } }, t('admin.back'))),
    form);
  const flash = sessionStorage.getItem('pt_admin_flash');
  if (flash) { sessionStorage.removeItem('pt_admin_flash'); setStatus(status, flash, 'success'); main.insertBefore(status, form); }

  if (!isNew && canEdit) {
    main.append(imagesSection(id, images, ctx, canEdit));
    if (canManager && p.track_mode === 'unit') main.append(await unitsSection(id, ctx));
    main.querySelector('#archive-btn')?.addEventListener('click', async () => {
      if (!(await confirmAction(t('admin.archive_confirm')))) return;
      try { await api.setProductStatus(id, 'archived'); sessionStorage.setItem('pt_admin_flash', t('admin.saved')); ctx.refresh(); }
      catch (err) { setStatus(status, errorMessage(err), 'error'); }
    });
  }
  applyI18n(main);
}

function validateForm(f, lang) {
  const errs = [];
  const v = (x) => x.value.trim();
  if (!PATTERNS.slug.test(v(f.slug))) errs.push(t('admin.err.slug'));
  if (v(f.sku) && !PATTERNS.sku.test(v(f.sku))) errs.push(t('admin.err.sku'));
  if (!MONEY.test(v(f.price))) errs.push(t('admin.err.price'));
  if (v(f.sale_price)) {
    if (!MONEY.test(v(f.sale_price))) errs.push(t('admin.err.sale_price'));
    else if (Number(v(f.sale_price)) >= Number(v(f.price))) errs.push(t('admin.err.sale_price_range'));
  }
  if (!/^[A-Za-z]{3}$/.test(v(f.currency) || 'EGP')) errs.push(t('admin.err.currency'));
  if (v(f.low_stock) && !/^\d{1,6}$/.test(v(f.low_stock))) errs.push(t('admin.err.low_stock'));
  if (v(f.cost_price) && !MONEY.test(v(f.cost_price))) errs.push(t('admin.err.cost'));
  return errs;
}

// ---------- Images ----------
function imagesSection(productId, images, ctx) {
  const host = el('section', { className: 'card', attrs: { 'aria-labelledby': 'img-h' } },
    el('h2', { className: 'card-title', attrs: { id: 'img-h' } }, t('admin.section.images')),
    el('p', { className: 'muted' }, t('admin.hint.images')));
  const status = el('div', { className: 'status', attrs: { role: 'status', hidden: true } });
  const grid = el('div', { className: 'img-grid' });
  const draw = (list) => {
    clear(grid);
    if (!list.length) grid.append(el('p', { className: 'muted' }, t('product.no_image')));
    for (const img of list) {
      const url = supabaseUrl(img.storage_path);
      const alt = el('input', { className: 'input', attrs: { 'aria-label': t('admin.f.alt_en'), value: img.alt_en || '', maxlength: '200', placeholder: t('admin.f.alt_en') } });
      grid.append(el('div', { className: 'card' },
        el('img', { attrs: { src: url, alt: img.alt_en || '', loading: 'lazy', width: 160, height: 160 } }),
        alt,
        el('div', { className: 'table-actions' },
          el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: async () => {
            try { await api.updateImageAlt(img.id, alt.value.trim(), img.alt_ar || null); setStatus(status, t('admin.saved'), 'success'); }
            catch (err) { setStatus(status, errorMessage(err), 'error'); }
          } } }, t('admin.save')),
          el('button', { className: 'btn btn-ghost btn-small', attrs: { type: 'button' }, on: { click: async () => {
            if (!(await confirmAction(t('admin.delete_confirm')))) return;
            try { await api.deleteProductImage(img); ctx.refresh(); }
            catch (err) { setStatus(status, errorMessage(err), 'error'); }
          } } }, t('admin.delete')))));
    }
  };
  draw(images);
  const file = el('input', { attrs: { type: 'file', accept: 'image/jpeg,image/png,image/webp', id: 'img-file', 'aria-label': t('admin.upload') } });
  const upload = el('button', { className: 'btn btn-dark btn-small', attrs: { type: 'button' }, on: { click: async () => {
    const f = file.files?.[0];
    if (!f) return setStatus(status, t('admin.err.no_file'), 'error');
    setBusy(upload, true);
    try { await api.uploadProductImage(productId, f); ctx.refresh(); }
    catch (err) { setStatus(status, errorMessage(err), 'error'); }
    finally { setBusy(upload, false); }
  } } }, t('admin.upload'));
  host.append(grid, el('div', { className: 'row' }, file, upload), status);
  return host;
}

function supabaseUrl(path) {
  return api.imageUrl(path);
}

// ---------- Unit tracking (used/refurbished devices) ----------
async function unitsSection(productId, ctx) {
  const host = el('section', { className: 'card', attrs: { 'aria-labelledby': 'units-h' } },
    el('h2', { className: 'card-title', attrs: { id: 'units-h' } }, t('admin.section.units')));
  const status = el('div', { className: 'status', attrs: { role: 'status', hidden: true } });
  const list = el('div', {}, el('p', { className: 'muted' }, t('admin.loading')));
  host.append(list, status);

  const load = async () => {
    const units = await api.listUnits(productId);
    clear(list);
    if (!units.length) list.append(el('p', { className: 'muted' }, t('admin.no_units')));
    else {
      list.append(el('div', { className: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ...['admin.unit.ref', 'admin.unit.serial', 'admin.unit.grade', 'admin.unit.battery', 'admin.unit.price', 'admin.col.status'].map((k) => el('th', {}, t(k))))),
        el('tbody', {}, ...units.map((u) => el('tr', {},
          el('td', { className: 'code', dataset: { label: t('admin.unit.ref') } }, u.internal_ref),
          el('td', { className: 'code', dataset: { label: t('admin.unit.serial') } }, u.serial_number || '—'),
          el('td', { dataset: { label: t('admin.unit.grade') } }, u.condition_grade || '—'),
          el('td', { className: 'num', dataset: { label: t('admin.unit.battery') } }, u.battery_health_pct ?? '—'),
          el('td', { className: 'num money', dataset: { label: t('admin.unit.price') } }, formatMoney(u.selling_price, 'EGP', getLang())),
          el('td', { dataset: { label: t('admin.col.status') } }, t(`admin.unit_status.${u.status}`))))))));
    }
  };
  await load();

  const v = (name) => host.querySelector(`[name="${name}"]`);
  const addForm = el('form', { className: 'card form', attrs: { novalidate: true, 'aria-labelledby': 'add-unit-h' } },
    el('h3', { className: 'card-title', attrs: { id: 'add-unit-h' } }, t('admin.unit.add')),
    el('div', { className: 'two-col' },
      el('div', { className: 'field' }, el('label', { attrs: { for: 'u-ref' } }, t('admin.unit.ref')), el('input', { className: 'input', attrs: { id: 'u-ref', name: 'internal_ref', required: 'required', maxlength: '60' } })),
      el('div', { className: 'field' }, el('label', { attrs: { for: 'u-serial' } }, t('admin.unit.serial')), el('input', { className: 'input', attrs: { id: 'u-serial', name: 'serial_number', maxlength: '80' } })),
      el('div', { className: 'field' }, el('label', { attrs: { for: 'u-grade' } }, t('admin.unit.grade')), el('select', { className: 'select', attrs: { id: 'u-grade', name: 'condition_grade' } },
        el('option', { attrs: { value: '' } }, '—'), ...['A', 'B', 'C', 'D'].map((g) => el('option', { attrs: { value: g } }, g)))),
      el('div', { className: 'field' }, el('label', { attrs: { for: 'u-battery' } }, t('admin.unit.battery')), el('input', { className: 'input', attrs: { id: 'u-battery', name: 'battery_health_pct', inputmode: 'numeric', maxlength: '3' } })),
      el('div', { className: 'field' }, el('label', { attrs: { for: 'u-price' } }, t('admin.unit.price')), el('input', { className: 'input', attrs: { id: 'u-price', name: 'selling_price', inputmode: 'decimal', required: 'required', maxlength: '13' } })),
      el('div', { className: 'field' }, el('label', { attrs: { for: 'u-acc' } }, t('admin.unit.accessories')), el('input', { className: 'input', attrs: { id: 'u-acc', name: 'included_accessories', maxlength: '500' } }))),
    el('div', { className: 'field' }, el('label', { attrs: { for: 'u-cos' } }, t('admin.unit.cosmetic')), el('textarea', { className: 'textarea', attrs: { id: 'u-cos', name: 'cosmetic_notes_en', rows: '2', maxlength: '1000' } })),
    el('button', { className: 'btn btn-dark', attrs: { type: 'submit' } }, t('admin.unit.add')));

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = addForm.querySelector('button[type="submit"]');
    const battery = v('battery_health_pct').value.trim();
    const price = v('selling_price').value.trim();
    if (!MONEY.test(price)) return setStatus(status, t('admin.err.price'), 'error');
    if (battery && !/^\d{1,3}$/.test(battery)) return setStatus(status, t('admin.err.battery'), 'error');
    setBusy(btn, true);
    try {
      await api.insertUnit({
        product_id: productId,
        internal_ref: v('internal_ref').value.trim(),
        serial_number: v('serial_number').value.trim() || null,
        condition_grade: v('condition_grade').value || null,
        battery_health_pct: battery ? Number(battery) : null,
        selling_price: price,
        included_accessories: v('included_accessories').value.trim() || null,
        cosmetic_notes_en: v('cosmetic_notes_en').value.trim() || null,
      });
      addForm.reset();
      setStatus(status, t('admin.saved'), 'success');
      await load();
    } catch (err) {
      setStatus(status, errorMessage(err), 'error');
    } finally {
      setBusy(btn, false);
    }
  });
  host.append(addForm);
  return host;
}
