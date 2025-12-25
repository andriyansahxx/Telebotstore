import { db } from "./index.js";

function touch(tenantId, userId) {
  db.prepare(`
    INSERT INTO balances(tenant_id, user_id, balance, updated_at)
    VALUES(?,?,0,?)
    ON CONFLICT(tenant_id, user_id) DO UPDATE SET updated_at=excluded.updated_at
  `).run(tenantId, userId, new Date().toISOString());
}

export function getBalance(tenantId, userId) {
  touch(tenantId, userId);
  const r = db.prepare(`SELECT balance FROM balances WHERE tenant_id=? AND user_id=?`)
    .get(tenantId, userId);
  return r ? Number(r.balance || 0) : 0;
}

export function addBalance(tenantId, userId, amount) {
  touch(tenantId, userId);
  db.prepare(`
    UPDATE balances SET balance = balance + ?, updated_at=?
    WHERE tenant_id=? AND user_id=?
  `).run(amount, new Date().toISOString(), tenantId, userId);
}

export function deductBalance(tenantId, userId, amount) {
  touch(tenantId, userId);
  // aman: tidak bisa minus
  const info = db.prepare(`
    UPDATE balances
    SET balance = balance - ?, updated_at=?
    WHERE tenant_id=? AND user_id=? AND balance >= ?
  `).run(amount, new Date().toISOString(), tenantId, userId, amount);

  return info.changes > 0;
}