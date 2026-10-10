// admin/js/api.js — staff data access. Every call is authorized by RLS and/or trusted RPCs on the server.
// The client-side role checks in app.js only control what the UI shows; they are NOT the security boundary.
import { requireAdminClient } from '/shared/supabase.js';

const db = () => requireAdminClient();

// ---------- Session and role ----------
export async function getCurrentUser() {
  const { data, error } = await db().auth.getUser();
  if (error) throw error;
  return data.user;
}

/** Returns 'owner' | 'manager' | 'staff' | null. RLS lets a user read only their own staff_roles row. */
export async function getStaffRole(userId) {
  const { data, error } = await db().from('staff_roles').select('role').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.role || null;
}

export async function signInStaff(email, password) {
  const { error } = await db().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOutStaff() {
  const { error } = await db().auth.signOut();
  if (error) throw error;
}

// ---------- Dashboard ----------
export async function dashboardSummary(fromIso, toIso) {
  const { data, error } = await db().rpc('admin_dashboard_summary', { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return data;
}

export async function countPendingOrders() {
  const { count, error } = await db().from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}

// ---------- Catalogue ----------
export async function listCategoriesAdmin() {
  const { data, error } = await db().from('categories').select('id,slug,name_en,name_ar,sort_order,is_active').order('sort_order');
  if (error) throw error;
  return data;
}

export async function listBrandsAdmin() {
  const { data, error } = await db().from('brands').select('id,name').order('name');
  if (error) throw error;
  return data;
}

/** Brands are created only by managers (RLS). Staff must choose an existing brand. */
export async function findOrCreateBrand(name, canCreate) {
  const clean = (name || '').trim();
  if (!clean) return null;
  const { data: existing, error: findErr } = await db().from('brands').select('id').eq('name', clean).maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing.id;
  if (!canCreate) {
    const err = new Error('forbidden');
    err.code = '42501';
    throw err;
  }
  const { data, error } = await db().from('brands').insert({ name: clean }).select('id').single();
  if (error) throw error;
  return data.id;
}

const PRODUCT_LIST_COLS = 'id,slug,sku,model_number,title_en,title_ar,price,sale_price,currency,status,track_mode,condition,is_featured,inventory(quantity_on_hand,low_stock_threshold)';

export async function listProductsAdmin({ q = '', status = '', page = 0, pageSize = 25 } = {}) {
  let query = db().from('products').select(PRODUCT_LIST_COLS, { count: 'exact' });
  const term = (q || '').replace(/[^\p{L}\p{N}\s\-_.]/gu, '').trim().slice(0, 80);
  if (term) {
    const like = `%${term}%`;
    query = query.or(`title_en.ilike.${like},title_ar.ilike.${like},sku.ilike.${like},model_number.ilike.${like},slug.ilike.${like}`);
  }
  if (status) query = query.eq('status', status);
  const from = page * pageSize;
  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data, count: count ?? 0 };
}

export async function getProductAdmin(id) {
  const { data, error } = await db().from('products')
    .select('*, inventory(quantity_on_hand,low_stock_threshold), product_images(id,storage_path,alt_en,alt_ar,sort_order)')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Cost price is readable by owner/manager only (RLS on product_private). Returns null for staff. */
export async function getProductCost(id) {
  const { data, error } = await db().from('product_private').select('cost_price').eq('product_id', id).maybeSingle();
  if (error) return null; // not permitted for this role; the UI then hides the field
  return data?.cost_price ?? null;
}

export async function saveProductCost(id, cost) {
  const { error } = await db().from('product_private').upsert({ product_id: id, cost_price: cost }, { onConflict: 'product_id' });
  if (error) throw error;
}

export async function insertProduct(row) {
  const { data, error } = await db().from('products').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateProduct(id, row) {
  const { error } = await db().from('products').update(row).eq('id', id);
  if (error) throw error;
}

export async function setProductStatus(id, status) {
  const { error } = await db().from('products').update({ status }).eq('id', id);
  if (error) throw error;
}

/** Image upload: validated by the bucket (type and size) and staff-only RLS on storage.objects. */
export async function uploadProductImage(productId, file) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!ext) throw Object.assign(new Error('invalid_mime'), { code: 'invalid_mime' });
  if (file.size > 5 * 1024 * 1024) throw Object.assign(new Error('file_too_large'), { code: 'file_too_large' });
  const path = `products/${productId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db().storage.from('product-images').upload(path, file, {
    contentType: file.type, cacheControl: '3600', upsert: false,
  });
  if (upErr) throw upErr;
  const { error } = await db().from('product_images').insert({
    product_id: productId, storage_path: path, sort_order: 0,
  });
  if (error) throw error;
  return path;
}

/** Public URL for a product image. The product-images bucket is public-read by policy. */
export function imageUrl(path) {
  if (!path) return '';
  return db().storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

export async function listImagesFor(productId) {
  const { data, error } = await db().from('product_images').select('id,storage_path,alt_en,alt_ar,sort_order')
    .eq('product_id', productId).order('sort_order');
  if (error) throw error;
  return data;
}

export async function updateImageAlt(imageId, altEn, altAr) {
  const { error } = await db().from('product_images').update({ alt_en: altEn || null, alt_ar: altAr || null }).eq('id', imageId);
  if (error) throw error;
}

export async function deleteProductImage(image) {
  const { error } = await db().from('product_images').delete().eq('id', image.id);
  if (error) throw error;
  // Storage delete is allowed for staff (0003 policy). A failure here leaves an orphan file; the error is shown.
  const { error: stErr } = await db().storage.from('product-images').remove([image.storage_path]);
  if (stErr) throw stErr;
}

// ---------- Unit tracking (used/refurbished devices; manager only) ----------
export async function listUnits(productId) {
  const { data, error } = await db().from('inventory_units')
    .select('id,internal_ref,serial_number,condition_grade,battery_health_pct,selling_price,included_accessories,cosmetic_notes_en,status,created_at')
    .eq('product_id', productId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data;
}

/** Units are created with status 'available'; the database enforces the rules and rejects sold units. */
export async function insertUnit(row) {
  const { error } = await db().from('inventory_units').insert(row);
  if (error) throw error;
}

// ---------- Stock ----------
export async function listQuantityStock() {
  const { data, error } = await db().from('products')
    .select('id,title_en,sku,status,inventory(quantity_on_hand,low_stock_threshold)')
    .eq('track_mode', 'quantity').order('title_en').limit(500);
  if (error) throw error;
  return data;
}

export async function adjustStock(productId, delta, reason) {
  const { data, error } = await db().rpc('adjust_stock', { p_product_id: productId, p_delta: delta, p_reason: reason });
  if (error) throw error;
  return data;
}

export async function setLowStockThreshold(productId, threshold) {
  const { error } = await db().from('inventory').update({ low_stock_threshold: threshold }).eq('product_id', productId);
  if (error) throw error;
}

// ---------- Orders ----------
export async function listOrdersAdmin({ status = '', q = '', page = 0, pageSize = 25 } = {}) {
  let query = db().from('orders')
    .select('id,reference,status,total,currency,created_at,fulfillment,payment_method,customer_name,customer_phone', { count: 'exact' });
  if (status) query = query.eq('status', status);
  const term = (q || '').replace(/[^A-Za-z0-9+\-\s]/g, '').trim().slice(0, 30);
  if (term) {
    query = term.toUpperCase().startsWith('PT-')
      ? query.ilike('reference', `${term.toUpperCase()}%`)
      : query.ilike('customer_phone', `%${term}%`);
  }
  const from = page * pageSize;
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data, count: count ?? 0 };
}

export async function getOrderAdmin(id) {
  const [orderRes, itemsRes, historyRes] = await Promise.all([
    db().from('orders').select('*').eq('id', id).maybeSingle(),
    db().from('order_items').select('*').eq('order_id', id).order('created_at'),
    db().from('order_status_history').select('to_status,from_status,note,created_at').eq('order_id', id).order('created_at'),
  ]);
  if (orderRes.error) throw orderRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (historyRes.error) throw historyRes.error;
  return { order: orderRes.data, items: itemsRes.data, history: historyRes.data };
}

export async function setOrderStatus(orderId, toStatus, note) {
  const { data, error } = await db().rpc('set_order_status', { p_order_id: orderId, p_to_status: toStatus, p_note: note || null });
  if (error) throw error;
  return data;
}

// ---------- Audit ----------
export async function listAudit({ limit = 100 } = {}) {
  const { data, error } = await db().from('audit_logs')
    .select('id,action,entity,entity_id,created_at,actor_id').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}


// ---------- Catalogue management ----------
export async function insertCategoryAdmin(row) {
  const { data, error } = await db().from('categories').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateCategoryAdmin(id, row) {
  const { error } = await db().from('categories').update(row).eq('id', id);
  if (error) throw error;
}

export async function setCategoryActiveAdmin(id, is_active) {
  const { error } = await db().from('categories').update({ is_active }).eq('id', id);
  if (error) throw error;
}

export async function deleteCategoryAdmin(id) {
  const { count, error: countError } = await db().from('products')
    .select('id', { count: 'exact', head: true }).eq('category_id', id);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new Error('category_in_use');
  const { error } = await db().from('categories').delete().eq('id', id);
  if (error) throw error;
}

export async function insertBrandAdmin(name) {
  const clean = (name || '').trim();
  if (clean.length < 1 || clean.length > 80) throw new Error('invalid_brand_name');
  const { data, error } = await db().from('brands').insert({ name: clean }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deleteBrandAdmin(id) {
  const { count, error: countError } = await db().from('products')
    .select('id', { count: 'exact', head: true }).eq('brand_id', id);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new Error('brand_in_use');
  const { error } = await db().from('brands').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Coupons ----------
export async function listCouponsAdmin() {
  const { data, error } = await db().from('coupons')
    .select('id,code,kind,value,min_subtotal,starts_at,ends_at,max_redemptions,redemptions_count,first_order_only,applies_to_sale_items,is_active,created_at,updated_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function insertCouponAdmin(row) {
  const { data, error } = await db().from('coupons').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateCouponAdmin(id, row) {
  const { error } = await db().from('coupons').update(row).eq('id', id);
  if (error) throw error;
}

export async function setCouponActiveAdmin(id, is_active) {
  const { error } = await db().from('coupons').update({ is_active }).eq('id', id);
  if (error) throw error;
}

export async function deleteCouponAdmin(id) {
  const { count, error: countError } = await db().from('coupon_redemptions')
    .select('id', { count: 'exact', head: true }).eq('coupon_id', id);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new Error('coupon_in_use');
  const { error } = await db().from('coupons').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Store settings ----------
export async function listStoreSettingsAdmin() {
  const { data, error } = await db().from('store_settings')
    .select('key,value,is_public,updated_at').order('key');
  if (error) throw error;
  return data;
}

export async function saveStoreSettingAdmin(key, value, is_public = true) {
  const { error } = await db().from('store_settings').upsert(
    { key, value, is_public }, { onConflict: 'key' });
  if (error) throw error;
}


// ---------- CSV import/export (manager-only route; no private cost fields) ----------
export async function listProductsForCsvAdmin() {
  const columns = 'id,slug,sku,model_number,brand_id,category_id,title_en,title_ar,description_en,description_ar,condition,price,sale_price,currency,warranty_text_en,warranty_text_ar,track_mode,status,is_featured,specs,created_at,inventory(quantity_on_hand,low_stock_threshold)';
  const pageSize = 1000;
  const { count, error: countError } = await db().from('products').select('id', { count: 'exact', head: true });
  if (countError) throw countError;
  const total = count ?? 0;
  const rows = [];
  for (let from = 0; from < total; from += pageSize) {
    const { data, error } = await db().from('products').select(columns)
      .order('created_at', { ascending: true }).range(from, Math.min(from + pageSize - 1, total - 1));
    if (error) throw error;
    rows.push(...data);
  }
  return rows;
}
