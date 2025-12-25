import { db } from "./index.js";

export function createVariant(product_id, name, price, tenantId = 0) {
  db.prepare(`
    INSERT INTO variants (product_id, name, price, stock, active, created_at, tenant_id)
    VALUES (?,?,?,?,1,?,?)
  `).run(product_id, name, price, 0, new Date().toISOString(), tenantId);
}

export function listVariants(product_id, tenantId = 0) {
  return db.prepare(`
    SELECT * FROM variants
    WHERE product_id=? AND active=1 AND tenant_id=?
    ORDER BY id ASC
  `).all(product_id, tenantId);
}

export function getVariant(variantId) {
  return db.prepare("SELECT * FROM variants WHERE id=? AND active=1").get(variantId) || null;
}

export function getVariantByTenant(tenantId, variantId) {
  return db.prepare("SELECT * FROM variants WHERE id=? AND active=1 AND tenant_id=?").get(variantId, tenantId) || null;
}

export function syncVariantStock(variantId) {
  const c = db.prepare("SELECT COUNT(*) AS c FROM stock_items WHERE variant_id=? AND used=0").get(variantId).c;
  db.prepare("UPDATE variants SET stock=? WHERE id=?").run(Number(c), variantId);
}

export function updateVariant(tenantId, variantId, newName, newPrice) {
  db.prepare(`
    UPDATE variants SET name=?, price=?, updated_at=?
    WHERE id=? AND active=1 AND (tenant_id=? OR ?=0)
  `).run(newName, newPrice, new Date().toISOString(), variantId, tenantId, tenantId);
}

export function deactivateVariant(tenantId, variantId) {
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE variants SET active=0, updated_at=?
      WHERE id=? AND (tenant_id=? OR ?=0)
    `).run(new Date().toISOString(), variantId, tenantId, tenantId);

    // optional: hapus stok yang belum kepakai untuk varian ini supaya rapi
    db.prepare(`
      UPDATE stock_items SET used=1, used_order_id='DELETED'
      WHERE variant_id=? AND (tenant_id=? OR ?=0) AND used=0
    `).run(variantId, tenantId, tenantId);

    // sync stok angka di variants
    db.prepare(`UPDATE variants SET stock=0 WHERE id=? AND (tenant_id=? OR ?=0)`).run(variantId, tenantId, tenantId);
  });
  tx();
}