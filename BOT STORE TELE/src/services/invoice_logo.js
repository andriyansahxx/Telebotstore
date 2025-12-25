import { getTenant } from "../db/tenant.js";
import { getSetting } from "../db/settings.js";
import { loadTelegramFileBuffer } from "./logo_loader.js";

export async function resolveInvoiceLogoBuffer(telegram, tenantId) {
  try {
    console.log("🎯 RESOLVE_LOGO: tenantId=", tenantId);
    
    if (tenantId && tenantId > 0) {
      const t = getTenant(tenantId);
      console.log("📊 TENANT_LOGO_LOOKUP:", { tenantId, hasLogoFileId: !!t?.logo_file_id });
      
      if (t?.logo_file_id) {
        console.log("📥 LOADING_TENANT_LOGO:", t.logo_file_id);
        const buf = await loadTelegramFileBuffer(telegram, t.logo_file_id);
        console.log("✅ TENANT_LOGO_LOADED:", buf ? `${buf.length} bytes` : "null");
        return buf;
      }
      console.log("⚠️ NO_TENANT_LOGO_FILE_ID");
      return null;
    }

    // tenant 0 (admin store)
    const adminLogo = getSetting("admin_invoice_logo_file_id");
    console.log("📊 ADMIN_LOGO_LOOKUP:", { adminLogo });
    
    if (adminLogo) {
      console.log("📥 LOADING_ADMIN_LOGO:", adminLogo);
      const buf = await loadTelegramFileBuffer(telegram, adminLogo);
      console.log("✅ ADMIN_LOGO_LOADED:", buf ? `${buf.length} bytes` : "null");
      return buf;
    }

    console.log("⚠️ NO_ADMIN_LOGO_FILE_ID");
    return null;
  } catch (e) {
    console.error("❌ RESOLVE_INVOICE_LOGO_ERR:", tenantId, e?.message, e?.stack);
    return null;
  }
}