import { getTenant } from "../db/tenant.js";

export function getPakasirConfigByTenantId(tenantId) {
  if (tenantId && tenantId > 0) {
    const t = getTenant(tenantId);
    if (t?.pakasir_slug && t?.pakasir_api_key) {
      return { slug: t.pakasir_slug, apiKey: t.pakasir_api_key, qrisOnly: !!t.qris_only };
    }
  }
  // fallback to global env; return null if not configured
  const slug = process.env.PAKASIR_SLUG;
  const apiKey = process.env.PAKASIR_API_KEY;
  const qrisOnly = process.env.PAKASIR_QRIS_ONLY === "1";
  if (!slug || !apiKey) return null;
  return { slug, apiKey, qrisOnly };
}