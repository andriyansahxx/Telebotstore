import { getTenant } from "../db/tenant.js";
import { getSetting } from "../db/settings.js";
import { buildBotInfoBlock } from "../utils/bot_info.js";
import { parseWelcomeValueMedia } from "../utils/welcome.js";

function userTagHtml(from) {
  if (!from) return "User";
  if (from.username) return `@${from.username}`;
  return `<a href="tg://user?id=${from.id}">${from.first_name || "User"}</a>`;
}

export async function sendWelcome(ctx, tenantId) {
  const isAdminStore = !tenantId || tenantId <= 0;

  // Ambil config welcome
  let welcomeType = "text";
  let welcomeValue = "👋 Selamat datang!";
  let storeName = "Gwei Store";
  let ownerInfo = "";

  if (isAdminStore) {
    storeName = getSetting("store_name") || "Gwei Store";
    ownerInfo = getSetting("owner_info") || "";
    welcomeType = getSetting("admin_welcome_type") || "text";
    welcomeValue = getSetting("admin_welcome_value") || `👋 Selamat datang di ${storeName}!`;
  } else {
    const t = getTenant(tenantId);
    storeName = t?.name || `Toko #${tenantId}`;
    welcomeType = t?.welcome_type || "text";
    welcomeValue = t?.welcome_value || `👋 Selamat datang di ${storeName}!`;
  }

  // Info bot per tenant/admin
  const infoBlock = buildBotInfoBlock({ tenantId: isAdminStore ? 0 : tenantId });

  // Build footer dengan owner info dan help message
  let footer = "";
  if (ownerInfo) {
    footer += `\n\n${ownerInfo}`;
  }
  const helpMsg = getSetting("transaction_help") || "";
  if (helpMsg) {
    footer += `\n${helpMsg}`;
  }

  // Base greeting
  const greeting = `👋 Halo ${userTagHtml(ctx.from)}\n🏪 ${storeName}`;

  // Kirim sesuai tipe
  try {
    if (welcomeType === "photo") {
      const parsed = parseWelcomeValueMedia(welcomeValue);
      const fileId = parsed?.file_id || welcomeValue;
      const cap = `${greeting}\n\n${parsed?.caption || ""}`.trim() + infoBlock + footer;

      await ctx.replyWithPhoto(fileId, { caption: cap, parse_mode: "HTML" });
      return;
    }

    if (welcomeType === "video") {
      const parsed = parseWelcomeValueMedia(welcomeValue);
      const fileId = parsed?.file_id || welcomeValue;
      const cap = `${greeting}\n\n${parsed?.caption || ""}`.trim() + infoBlock + footer;

      await ctx.replyWithVideo(fileId, { caption: cap, parse_mode: "HTML" });
      return;
    }

    if (welcomeType === "document") {
      const parsed = parseWelcomeValueMedia(welcomeValue);
      const fileId = parsed?.file_id || welcomeValue;
      const cap = `${greeting}\n\n${parsed?.caption || ""}`.trim() + infoBlock + footer;

      await ctx.replyWithDocument(fileId, { caption: cap, parse_mode: "HTML" });
      return;
    }

    // TEXT
    const text = `${greeting}\n\n${welcomeValue}`.trim() + infoBlock + footer;
    await ctx.reply(text, { parse_mode: "HTML" });
  } catch (e) {
    console.error("WELCOME_SEND_ERR:", e);
    // fallback super aman
    await ctx.reply(`👋 Selamat datang!\n🕒 ${new Date().toLocaleString("id-ID")} WIB`);
  }
}