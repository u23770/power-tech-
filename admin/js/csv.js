// admin/js/csv.js — pure CSV parsing, serialization and product import validation.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const SKU = /^[A-Za-z0-9._-]{2,64}$/;
const SLUG = /^[a-z0-9-]{2,120}$/;
const SPEC_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const CONDITIONS = new Set(['new', 'used', 'refurbished']);
const TRACK_MODES = new Set(['quantity', 'unit']);
const STATUSES = new Set(['draft', 'published', 'unavailable', 'archived']);

export function parseCsvText(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
    } else {
      if (ch === '"') throw new Error('invalid_csv_quote');
      field += ch;
    }
  }
  if (inQuotes) throw new Error('invalid_csv_quotes');
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  }
  return rows;
}

export function serializeCsvRows(rows) {
  const cell = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

function slugifyCsv(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function parseSpecsCsv(text) {
  const result = {};
  const source = String(text || '').replace(/\s*;\s*/g, '\n');
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 60) return { specs: result, valid: false };
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 1) return { specs: result, valid: false };
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!SPEC_KEY.test(key) || !value || value.length > 300 || Object.hasOwn(result, key)) {
      return { specs: result, valid: false };
    }
    result[key] = value;
  }
  return { specs: result, valid: true };
}

const clean = (value) => String(value ?? '').trim();
const isTrue = (value) => ['1', 'true', 'yes', 'y'].includes(clean(value).toLowerCase());

export function prepareProductImport(csvText, { categories = [], brands = [], existingProducts = [] } = {}) {
  const table = parseCsvText(csvText);
  const errors = [];
  const items = [];
  let skipped = 0;
  if (!table.length) return { items, errors: [{ line: 1, code: 'empty_csv' }], skipped };

  const headers = table[0].map((h) => clean(h).toLowerCase());
  if (headers.some((h) => !h)) return { items, errors: [{ line: 1, code: 'empty_header' }], skipped };
  if (new Set(headers).size !== headers.length) return { items, errors: [{ line: 1, code: 'duplicate_header' }], skipped };
  const missing = ['title_en', 'price'].filter((h) => !headers.includes(h));
  if (missing.length) return { items, errors: [{ line: 1, code: 'missing_required_columns', details: missing.join(', ') }], skipped };

  const categoryBySlug = new Map(categories.map((c) => [clean(c.slug).toLowerCase(), c]));
  const brandByName = new Map(brands.map((b) => [clean(b.name).toLowerCase(), b]));
  const seenSlugs = new Set(existingProducts.map((p) => clean(p.slug).toLowerCase()).filter(Boolean));
  const seenSkus = new Set(existingProducts.map((p) => clean(p.sku)).filter(Boolean));

  for (let index = 1; index < table.length; index += 1) {
    const line = index + 1;
    const cells = table[index];
    if (!cells.some((cell) => clean(cell))) continue;
    const record = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
    if (isTrue(record.is_example)) {
      skipped += 1;
      continue;
    }

    const rowErrors = [];
    const add = (code) => { if (!rowErrors.includes(code)) rowErrors.push(code); };
    const titleEn = clean(record.title_en);
    const titleAr = clean(record.title_ar);
    const sku = clean(record.sku);
    const slug = clean(record.slug) || slugifyCsv(titleEn);
    const condition = (clean(record.condition) || 'new').toLowerCase();
    const trackMode = (clean(record.track_mode) || 'quantity').toLowerCase();
    const status = (clean(record.status) || 'draft').toLowerCase();
    const currency = (clean(record.currency) || 'EGP').toUpperCase();
    const price = clean(record.price);
    const salePrice = clean(record.sale_price);
    const quantityRaw = clean(record.quantity) || '0';
    const thresholdRaw = clean(record.low_stock_threshold) || '0';
    const quantity = Number(quantityRaw);
    const lowStockThreshold = Number(thresholdRaw);
    const brandName = clean(record.brand);
    const categorySlug = clean(record.category_slug).toLowerCase();
    const brand = brandName ? brandByName.get(brandName.toLowerCase()) : null;
    const category = categorySlug ? categoryBySlug.get(categorySlug) : null;
    const specsResult = parseSpecsCsv(record.specs);

    if (titleEn.length < 2 || titleEn.length > 200) add('invalid_title');
    if (titleAr.length > 200) add('invalid_title_ar');
    if (!SLUG.test(slug)) add('invalid_slug');
    if (sku && !SKU.test(sku)) add('invalid_sku');
    if (sku && seenSkus.has(sku)) add('duplicate_sku');
    if (slug && seenSlugs.has(slug)) add('duplicate_slug');
    if (!MONEY.test(price)) add('invalid_price');
    if (salePrice && (!MONEY.test(salePrice) || Number(salePrice) >= Number(price))) add('invalid_sale_price');
    if (!/^[A-Z]{3}$/.test(currency)) add('invalid_currency');
    if (!CONDITIONS.has(condition)) add('invalid_condition');
    if (!TRACK_MODES.has(trackMode)) add('invalid_track_mode');
    if (!STATUSES.has(status)) add('invalid_status');
    if (!Number.isInteger(quantity) || quantity < 0) add('invalid_quantity');
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) add('invalid_threshold');
    if (trackMode === 'unit' && quantity > 0) add('unit_quantity');
    if (brandName && !brand) add('unknown_brand');
    if (categorySlug && !category) add('unknown_category');
    if (!specsResult.valid) add('invalid_specs');
    if (clean(record.model_number).length > 80
      || clean(record.warranty_text_en).length > 500
      || clean(record.warranty_text_ar).length > 500
      || clean(record.description_en).length > 5000
      || clean(record.description_ar).length > 5000) add('text_too_long');

    if (sku) seenSkus.add(sku);
    if (slug) seenSlugs.add(slug);
    if (rowErrors.length) {
      rowErrors.forEach((code) => errors.push({ line, code }));
      continue;
    }

    items.push({
      line,
      product: {
        slug,
        sku: sku || null,
        model_number: clean(record.model_number) || null,
        brand_id: brand?.id || null,
        category_id: category?.id || null,
        title_en: titleEn,
        title_ar: titleAr || null,
        description_en: clean(record.description_en) || null,
        description_ar: clean(record.description_ar) || null,
        condition,
        price,
        sale_price: salePrice || null,
        currency,
        warranty_text_en: clean(record.warranty_text_en) || null,
        warranty_text_ar: clean(record.warranty_text_ar) || null,
        track_mode: trackMode,
        status,
        is_featured: isTrue(record.is_featured),
        specs: specsResult.specs,
      },
      quantity: trackMode === 'quantity' ? quantity : 0,
      lowStockThreshold: trackMode === 'quantity' ? lowStockThreshold : 0,
    });
  }

  if (!items.length && !errors.length) errors.push({ line: 1, code: 'no_importable_rows' });
  return { items, errors, skipped };
}
