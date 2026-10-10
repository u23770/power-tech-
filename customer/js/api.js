// customer/js/api.js — every storefront data call. Reads go through public views with explicit columns;
// writes go through trusted RPCs (place_order, track_order). No table writes happen from the storefront.
import { requireClient } from '/shared/supabase.js';
import { CONFIG } from '/shared/config.js';

// Explicit allow-list of columns exposed to the public (matches storefront_products in migration 0003).
const PRODUCT_COLS = [
  'id', 'slug', 'sku', 'model_number', 'brand_name', 'category_slug', 'category_name_en', 'category_name_ar',
  'title_en', 'title_ar', 'description_en', 'description_ar', 'condition', 'price', 'sale_price', 'currency',
  'warranty_text_en', 'warranty_text_ar', 'track_mode', 'is_featured', 'specs', 'created_at',
  'effective_price', 'stock_state', 'status',
].join(',');

const UNIT_COLS = 'id,product_id,condition_grade,cosmetic_notes_en,cosmetic_notes_ar,battery_health_pct,included_accessories,warranty_text,selling_price';

/** Keep user search text to letters, digits, spaces and a few safe symbols (also prevents PostgREST filter injection). */
export function sanitizeSearch(text) {
  return (text || '').normalize('NFKC').replace(/[^\p{L}\p{N}\s\-_.+/]/gu, '').trim().slice(0, 80);
}

export async function getPublicSettings() {
  const { data, error } = await requireClient().from('store_settings').select('key,value').eq('is_public', true);
  if (error) throw error;
  return Object.fromEntries(data.map((row) => [row.key, row.value]));
}

export async function listCategories() {
  const { data, error } = await requireClient().from('categories')
    .select('id,slug,name_en,name_ar,sort_order').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return data;
}

export async function listBrandNames() {
  const { data, error } = await requireClient().from('brands').select('name').order('name');
  if (error) throw error;
  return data.map((b) => b.name);
}

/**
 * Catalog query with search, filters, sort and paging. Uses count=exact for the result total.
 * opts: { q, categorySlug, brand, condition, minPrice, maxPrice, inStockOnly, sort, page }
 */
export async function searchProducts(opts = {}) {
  let query = requireClient().from('storefront_products').select(PRODUCT_COLS, { count: 'exact' });
  const term = sanitizeSearch(opts.q);
  if (term) {
    const like = `%${term}%`;
    query = query.or(`title_en.ilike.${like},title_ar.ilike.${like},sku.ilike.${like},model_number.ilike.${like},brand_name.ilike.${like}`);
  }
  if (opts.categorySlug) query = query.eq('category_slug', opts.categorySlug);
  if (opts.brand) query = query.eq('brand_name', opts.brand);
  if (['new', 'used', 'refurbished'].includes(opts.condition)) query = query.eq('condition', opts.condition);
  if (Number.isFinite(opts.minPrice)) query = query.gte('effective_price', opts.minPrice);
  if (Number.isFinite(opts.maxPrice)) query = query.lte('effective_price', opts.maxPrice);
  if (opts.inStockOnly) query = query.neq('stock_state', 'out_of_stock');
  if (opts.featured) query = query.eq('is_featured', true);

  switch (opts.sort) {
    case 'price_asc': query = query.order('effective_price', { ascending: true }).order('id'); break;
    case 'price_desc': query = query.order('effective_price', { ascending: false }).order('id'); break;
    case 'name': query = query.order('title_en', { ascending: true }).order('id'); break;
    default: query = query.order('created_at', { ascending: false }).order('id');
  }

  const page = Math.max(0, Number(opts.page) || 0);
  const from = page * CONFIG.PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + CONFIG.PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data, count: count ?? 0 };
}

/** Newest published products (for "new arrivals") or featured ones. */
export async function listHighlights({ featured = false, limit = 8 } = {}) {
  let query = requireClient().from('storefront_products').select(PRODUCT_COLS).limit(limit);
  query = featured ? query.eq('is_featured', true) : query;
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/** Products on sale: sale_price is set in the database (no fake countdowns or invented "was" prices). */
export async function listOnSale(limit = 8) {
  const { data, error } = await requireClient().from('storefront_products').select(PRODUCT_COLS)
    .not('sale_price', 'is', null).limit(limit).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getProductBySlug(slug) {
  const { data, error } = await requireClient().from('storefront_products').select(PRODUCT_COLS)
    .eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await requireClient().from('storefront_products').select(PRODUCT_COLS).in('id', ids);
  if (error) throw error;
  return data;
}

export async function getUnitsForProduct(productId) {
  const { data, error } = await requireClient().from('storefront_units').select(UNIT_COLS)
    .eq('product_id', productId).order('selling_price', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getUnitsByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await requireClient().from('storefront_units').select(UNIT_COLS).in('id', ids);
  if (error) throw error;
  return data;
}

/** Images for many products in one query. Returns Map(productId -> [image...]). */
export async function getImagesByProduct(productIds) {
  const map = new Map();
  if (!productIds.length) return map;
  const { data, error } = await requireClient().from('product_images')
    .select('product_id,storage_path,alt_en,alt_ar,sort_order').in('product_id', productIds).order('sort_order');
  if (error) throw error;
  for (const img of data) {
    if (!map.has(img.product_id)) map.set(img.product_id, []);
    map.get(img.product_id).push(img);
  }
  return map;
}

/** Public URL of a stored product image (bucket is public read; writes are staff-only). */
export function imageUrl(storagePath) {
  if (!storagePath) return '';
  const { data } = requireClient().storage.from('product-images').getPublicUrl(storagePath);
  return data.publicUrl;
}

/** Trusted server-side order placement. `payload` never contains prices. */
export async function placeOrder(payload) {
  const { data, error } = await requireClient().rpc('place_order', {
    p_items: payload.items,
    p_customer: payload.customer,
    p_fulfillment: payload.fulfillment,
    p_payment_method: payload.paymentMethod,
    p_coupon_code: payload.couponCode || null,
    p_idempotency_key: payload.idempotencyKey,
  });
  if (error) throw error;
  return data;
}

export async function trackOrder(reference, token) {
  const { data, error } = await requireClient().rpc('track_order', { p_reference: reference, p_token: token });
  if (error) throw error;
  return data;
}

// ---------- Accounts ----------
export async function getSession() {
  const { data, error } = await requireClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp({ email, password, fullName }) {
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/customer/account.html` },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const { error } = await requireClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/customer/account.html?mode=reset`,
  });
  if (error) throw error;
}

export async function updatePassword(password) {
  const { error } = await requireClient().auth.updateUser({ password });
  if (error) throw error;
}

export async function getProfile(userId) {
  const { data, error } = await requireClient().from('profiles').select('full_name,phone').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveProfile(userId, { fullName, phone }) {
  const { error } = await requireClient().from('profiles')
    .update({ full_name: fullName, phone: phone || null }).eq('id', userId);
  if (error) throw error;
}

/** RLS limits this to the signed-in customer's own orders. */
export async function listMyOrders() {
  const { data, error } = await requireClient().from('orders')
    .select('id,reference,status,fulfillment,total,currency,created_at')
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

export async function listOrderItems(orderIds) {
  if (!orderIds.length) return [];
  const { data, error } = await requireClient().from('order_items')
    .select('order_id,title_snapshot,title_ar_snapshot,quantity,line_total').in('order_id', orderIds);
  if (error) throw error;
  return data;
}
