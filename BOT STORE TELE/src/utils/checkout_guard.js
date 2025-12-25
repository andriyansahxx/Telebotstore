import { getTenant, getTenantByOwner } from "../db/tenant.js";
import { editOrReply } from "./edit_or_reply.js";

export function tenantNeedsPakasir(tenantId) {
  if (!tenantId || tenantId <= 0) return false; // toko admin bebas
  const t = getTenant(tenantId);
  if (!t) return true;
  return !(t.pakasir_slug && t.pakasir_api_key);
}

export function getTenantOwnerControls(ctx) {
  const owner = getTenantByOwner(ctx.from?.id);
  return owner ? true : false;
}

export async function sendPakasirNotSetMessage(ctx, tenantId) {
  const t = getTenant(tenantId);
  const shopName = t?.name || `Toko #${tenantId}`;

  const isOwner = getTenantByOwner(ctx.from?.id)?.id === tenantId;

  const text =
`⚠️ Payment toko belum siap

${shopName} belum mengatur Pakasir (slug & api key).
Checkout diblokir agar tidak memakai payment admin.

${isOwner ? "Silakan set Pakasir toko kamu sekarang." : "Silakan hubungi owner toko untuk set payment."}`;

  const rows = [];
  if (isOwner) {
    rows.push(["🔑 Set Pakasir"]);
    rows.push(["🏪 Panel Toko"]);
  }
  rows.push(["⬅️ Menu"]);

  try {
    await editOrReply(ctx, text, { reply_markup: { keyboard: rows, resize_keyboard: true } });
  } catch {
    await ctx.reply(text);
  }
}