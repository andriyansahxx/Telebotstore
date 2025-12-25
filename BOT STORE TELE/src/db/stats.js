import { db } from "./index.js";

export function countUsersByTenant(tenantId) {
  // butuh user_tenant selalu di-set saat /start (store_.. atau default 0)
  const r = db.prepare(`SELECT COUNT(*) AS c FROM user_tenant WHERE tenant_id=?`).get(tenantId);
  return Number(r?.c || 0);
}

export function countTransactionsByTenant(tenantId) {
  // transaksi = order PAID / SUCCESS (sesuaikan status kamu)
  const r = db.prepare(`
    SELECT COUNT(*) AS c
    FROM orders
    WHERE tenant_id=? AND status IN ('PAID','SUCCESS','DELIVERED')
  `).get(tenantId);
  return Number(r?.c || 0);
}

export function sumQtySoldByTenant(tenantId) {
  // qty terjual: sum qty untuk order paid
  const r = db.prepare(`
    SELECT COALESCE(SUM(qty),0) AS s
    FROM orders
    WHERE tenant_id=? AND status IN ('PAID','SUCCESS','DELIVERED')
  `).get(tenantId);
  return Number(r?.s || 0);
}