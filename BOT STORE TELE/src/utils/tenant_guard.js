import { getTenantByOwner } from "../db/tenant.js";

export function getOwnerTenant(ctx) {
  return getTenantByOwner(ctx.from?.id) || null;
}

export function tenantHasPakasir(t) {
  return !!(t?.pakasir_slug && t?.pakasir_api_key);
}