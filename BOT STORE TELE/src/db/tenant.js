import { db } from "./index.js";

export function createTenant({ ownerUserId, name }) {
  const now = new Date().toISOString();
  const id = db
    .prepare(`
      INSERT INTO tenants(
        owner_user_id, name,
        pakasir_slug, pakasir_api_key, qris_only,
        welcome_type, welcome_value, logo_file_id,
        active, created_at
      ) VALUES (?,?,?,?,?,?,?,?,1,?)
    `)
    .run(ownerUserId, name, null, null, 1, "text", `👋 Selamat datang di ${name}`, null, now)
    .lastInsertRowid;
  return Number(id);
}

export function getTenant(tenantId) {
  return db.prepare(`SELECT * FROM tenants WHERE id=? AND active=1`).get(tenantId) || null;
}

export function getTenantByOwner(ownerUserId) {
  return (
    db
      .prepare(`SELECT * FROM tenants WHERE owner_user_id=? AND active=1 ORDER BY id DESC LIMIT 1`)
      .get(ownerUserId) || null
  );
}

export function setTenantPakasir(tenantId, slug, apiKey, qrisOnly) {
  db.prepare(
    `UPDATE tenants SET pakasir_slug=?, pakasir_api_key=?, qris_only=? WHERE id=?`
  ).run(slug, apiKey, qrisOnly ? 1 : 0, tenantId);
}

export function setTenantWelcome(tenantId, type, value) {
  db.prepare(`UPDATE tenants SET welcome_type=?, welcome_value=? WHERE id=?`).run(type, value, tenantId);
}

export function setTenantLogo(tenantId, fileId) {
  db.prepare(`UPDATE tenants SET logo_file_id=? WHERE id=?`).run(fileId, tenantId);
}

export function setUserTenant(userId, tenantId) {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO user_tenant(user_id, tenant_id, updated_at)
      VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET tenant_id=excluded.tenant_id, updated_at=excluded.updated_at
    `
  ).run(userId, tenantId, now);
}

export function getUserTenant(userId) {
  const r = db.prepare(`SELECT tenant_id FROM user_tenant WHERE user_id=?`).get(userId);
  return r ? Number(r.tenant_id) : 0;
}

export function getTenantBranding(tenantId) {
  const r = db
    .prepare(`SELECT id, name, welcome_type, welcome_value, logo_file_id FROM tenants WHERE id=? AND active=1`)
    .get(tenantId);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    welcome_type: r.welcome_type || "text",
    welcome_value: r.welcome_value || "",
    logo_file_id: r.logo_file_id || null,
  };
}