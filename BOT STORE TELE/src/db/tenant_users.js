import { db } from "./index.js";

export function listTenantUserIds(tenantId) {
  return db.prepare(`
    SELECT user_id FROM user_tenant
    WHERE tenant_id=?
  `).all(tenantId).map(r => Number(r.user_id));
}

/**
 * Get total number of users for a specific tenant
 */
export function getTenantUserCount(tenantId) {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM user_tenant
    WHERE tenant_id=?
  `).get(tenantId);
  return result?.count || 0;
}