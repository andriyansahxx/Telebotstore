import { db } from "./index.js";

export function createProduct(name, tenantId = 0) {
  return db.prepare("INSERT INTO products(name,active,created_at,tenant_id) VALUES(?,1,?,?)")
    .run(name, new Date().toISOString(), tenantId).lastInsertRowid;
}

export function listProductsPaged(tenantId, page, pageSize) {
  // Ensure all parameters are proper integers
  tenantId = +tenantId || 0;
  page = +page || 1;
  pageSize = +pageSize || 10;
  
  const offset = (page - 1) * pageSize;
  
  const total = db.prepare("SELECT COUNT(*) AS c FROM products WHERE active=1 AND tenant_id=?")
    .get(tenantId).c;
  const pages = Math.max(1, Math.ceil(Number(total) / pageSize));
  
  const rows = db.prepare(`
    SELECT * FROM products
    WHERE active=1 AND tenant_id=?
    ORDER BY id ASC
    LIMIT ? OFFSET ?
  `).all(tenantId, pageSize, offset);
  return { rows, pages, total: Number(total) };
}

export function getProduct(tenantId, id) {
  return db.prepare("SELECT * FROM products WHERE id=? AND active=1 AND tenant_id=?")
    .get(id, tenantId) || null;
}

export function updateProductName(productId, name) {
  return db.prepare("UPDATE products SET name=?, updated_at=? WHERE id=?")
    .run(name, new Date().toISOString(), productId);
}

export function deleteProduct(productId) {
  // soft delete (legacy helper)
  return db.prepare("UPDATE products SET active=0, updated_at=? WHERE id=?")
    .run(new Date().toISOString(), productId);
}

export function updateProduct(tenantId, productId, newName) {
  db.prepare(`
    UPDATE products SET name=?, updated_at=?
    WHERE id=? AND active=1 AND (tenant_id=? OR ?=0)
  `).run(newName, new Date().toISOString(), productId, tenantId, tenantId);
}

export function deactivateProduct(tenantId, productId) {
  // soft delete produk + nonaktifkan semua variannya
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE products SET active=0, updated_at=?
      WHERE id=? AND (tenant_id=? OR ?=0)
    `).run(new Date().toISOString(), productId, tenantId, tenantId);

    db.prepare(`
      UPDATE variants SET active=0
      WHERE product_id=? AND (tenant_id=? OR ?=0)
    `).run(productId, tenantId, tenantId);
  });
  tx();
}