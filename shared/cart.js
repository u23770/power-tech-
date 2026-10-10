// shared/cart.js — guest-friendly cart stored in localStorage on THIS device.
// The cart holds only references (product id, optional unit id, quantity). It never stores prices
// as authoritative values: prices and stock are re-read from the database and re-checked by place_order().
// The cart is not synced across devices. Signing in does not merge carts (documented in docs/SECURITY.md).

const KEY = 'pt_cart_v1';
const MAX_LINES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidItem(item) {
  return item && typeof item === 'object'
    && UUID.test(item.productId || '')
    && (item.unitId === null || UUID.test(item.unitId || ''))
    && Number.isInteger(item.qty) && item.qty >= 1 && item.qty <= 100;
}

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isValidItem).slice(0, MAX_LINES) : [];
  } catch {
    return []; // corrupted storage: start empty rather than crash the page
  }
}

function write(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: the cart still works for this page view; tell the user.
    window.dispatchEvent(new CustomEvent('cart:error'));
  }
  window.dispatchEvent(new CustomEvent('cart:change'));
}

export function lineKey(item) {
  return item.unitId ? `u:${item.unitId}` : `p:${item.productId}`;
}

export function getItems() {
  return read();
}

export function cartCount() {
  return read().reduce((sum, i) => sum + i.qty, 0);
}

/** Add a product (or a specific used unit). Units are always quantity 1. */
export function addItem({ productId, unitId = null, qty = 1, maxQty = 10 }) {
  const items = read();
  const key = unitId ? `u:${unitId}` : `p:${productId}`;
  const existing = items.find((i) => lineKey(i) === key);
  if (unitId) {
    if (!existing) items.push({ productId, unitId, qty: 1 });
  } else if (existing) {
    existing.qty = Math.min(existing.qty + qty, maxQty);
  } else {
    if (items.length >= MAX_LINES) throw new Error('cart_full');
    items.push({ productId, unitId: null, qty: Math.min(qty, maxQty) });
  }
  write(items);
  return items;
}

export function setQty(key, qty, maxQty = 10) {
  const items = read();
  const item = items.find((i) => lineKey(i) === key);
  if (!item || item.unitId) return items; // units are fixed at 1
  item.qty = Math.max(1, Math.min(Number(qty) || 1, maxQty));
  write(items);
  return items;
}

export function removeItem(key) {
  const items = read().filter((i) => lineKey(i) !== key);
  write(items);
  return items;
}

export function clearCart() {
  write([]);
}

/** Keep only lines that still exist in the database (called after a storefront refresh). */
export function pruneTo(validKeys) {
  const set = new Set(validKeys);
  const items = read();
  const kept = items.filter((i) => set.has(lineKey(i)));
  if (kept.length !== items.length) write(kept);
  return items.length - kept.length;
}
