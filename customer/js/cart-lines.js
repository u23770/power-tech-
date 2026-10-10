// customer/js/cart-lines.js — joins local cart references with live catalogue data.
// Prices shown here are DISPLAY ONLY. place_order() recalculates everything on the server.
import { getItems, pruneTo, lineKey } from '/shared/cart.js';
import { getProductsByIds, getUnitsByIds, getImagesByProduct } from './api.js';

/**
 * Returns { lines, removedCount }.
 * line: { key, item, product, unit, available, unitPrice, image }
 * Lines whose product no longer exists in the public catalogue are removed from the local cart.
 */
export async function loadCartLines() {
  const items = getItems();
  if (!items.length) return { lines: [], removedCount: 0 };

  const productIds = [...new Set(items.map((i) => i.productId))];
  const unitIds = items.filter((i) => i.unitId).map((i) => i.unitId);
  const [products, units] = await Promise.all([getProductsByIds(productIds), getUnitsByIds(unitIds)]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const unitMap = new Map(units.map((u) => [u.id, u]));

  const lines = items.map((item) => {
    const product = productMap.get(item.productId) || null;
    const unit = item.unitId ? unitMap.get(item.unitId) || null : null;
    const available = Boolean(product)
      && product.status === 'published'
      && product.stock_state !== 'out_of_stock'
      && (!item.unitId || Boolean(unit));
    const rawPrice = item.unitId ? unit?.selling_price : product?.effective_price;
    const unitPrice = rawPrice === undefined || rawPrice === null ? null : Number(rawPrice);
    return { key: lineKey(item), item, product, unit, available, unitPrice };
  });

  const removedCount = pruneTo(lines.filter((l) => l.product).map((l) => l.key));
  const images = await getImagesByProduct(productIds);
  const visible = lines.filter((l) => l.product).map((l) => ({ ...l, image: images.get(l.product.id)?.[0] || null }));
  return { lines: visible, removedCount };
}
