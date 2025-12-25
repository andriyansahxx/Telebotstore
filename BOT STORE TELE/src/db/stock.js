import { db } from "./index.js";
import { syncVariantStock } from "./variant.js";

export function addStock(variantId, items, tenantId = 0) {
  const ins = db.prepare(`
    INSERT INTO stock_items (variant_id, item, used, used_order_id, created_at, tenant_id)
    VALUES (?,?,0,NULL,?,?)
  `);

  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    for (const it of items) ins.run(variantId, it, now, tenantId);
  });

  tx();
  syncVariantStock(variantId);
}

export function popStockFIFO(tenantId, variantId, qty, orderId) {
  const tx = db.transaction(() => {
    const rows = db.prepare(`
      SELECT id, item FROM stock_items
      WHERE tenant_id=? AND variant_id=? AND used=0
      ORDER BY id ASC
      LIMIT ?
    `).all(tenantId, variantId, qty);

    if (rows.length < qty) return null;

    const upd = db.prepare("UPDATE stock_items SET used=1, used_order_id=? WHERE id=? AND used=0");
    for (const r of rows) upd.run(orderId, r.id);

    syncVariantStock(variantId);
    return rows.map((r) => r.item);
  });

  return tx();
}