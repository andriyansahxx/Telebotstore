import { Markup } from "telegraf";
import { makeTenantHomeHandler } from "./tenant.js";
import { getTenantByOwner } from "../db/tenant.js";
import { listProductsPaged, getProduct } from "../db/product.js";
import { listVariants } from "../db/variant.js";
import { numberKeyboard } from "../utils/reply_kb.js";
import { rupiah } from "../utils/ui.js";
import { getTenantUserCount } from "../db/tenant_users.js";
import { getTenantStats } from "../db/order.js";

const PAGE_SIZE = 10;

export function registerTenantMenuHears(bot) {
  bot.hears("🏪 Panel Toko", async (ctx) => {
    // reuse tenant action handler logic
    const handler = makeTenantHomeHandler();
    return handler(ctx);
  });

  bot.hears("📦 Produk Toko", async (ctx) => {
    const t = getTenantByOwner(ctx.from.id);
    if (!t) return ctx.reply("Kamu belum punya toko.");

    const page = 1;
    const { rows, pages, total } = listProductsPaged(t.id, page, PAGE_SIZE);
    let text = `📦 PRODUK TOKO\nToko: ${t.name}\nTotal: ${total}\n\n`;
    const map = rows.map((p, idx) => ({ num: idx + 1, id: p.id, name: p.name }));
      ctx.session.tenantProductMap = map;
      ctx.session.userState = "PICK_TENANT_PRODUCT";

      // Build inline keyboard so product selection uses callback (hybrid flow)
      const buttons = rows.map((p) => [{ text: p.name, callback_data: `T_PRODUCT:${p.id}` }]);
      // add back button
      buttons.push([{ text: "⬅️ Panel Toko", callback_data: "T_HOME" }]);
      await ctx.reply(text, Markup.inlineKeyboard(buttons));
  });

  // numeric handler for tenant product/variant selection
  bot.hears(/^\d+$/, async (ctx) => {
    const us = ctx.session?.userState;
    if (!us) return;
    const n = Number(String(ctx.message?.text || "").trim());
    if (!Number.isFinite(n)) return;

    if (us === "PICK_TENANT_PRODUCT") {
      const map = ctx.session.tenantProductMap || [];
      const found = map.find((x) => x.num === n);
      if (!found) { await ctx.reply("Nomor produk tidak valid."); return; }
      const tenant = getTenantByOwner(ctx.from.id);
      const product = getProduct(tenant.id, found.id);
      if (!product) { await ctx.reply("Produk tidak ditemukan."); ctx.session.userState = null; return; }

      const vars = listVariants(product.id, tenant.id);
      if (!vars.length) { await ctx.reply(`🧾 ${product.name}\n\nBelum ada varian.`); ctx.session.userState = null; return; }

      const vmap = vars.map((v,i) => ({ num: i+1, id: v.id, name: v.name, price: v.price, stock: v.stock }));
        ctx.session.tenantVariantMap = vmap;
        ctx.session.userState = "PICK_TENANT_VARIANT";
        ctx.session.pickMode = "VARIANT";

      let txt = `🧾 ${product.name}\n\nPilih varian (ketik nomor):\n`;
      vars.forEach((v,i) => (txt += `${i+1}. ${v.name} — ${rupiah(v.price)} (stok: ${v.stock})\n`));
      await ctx.reply(txt, numberKeyboard(Math.min(vars.length, 11), tenant.name));
      return;
    }

    if (us === "PICK_TENANT_VARIANT") {
      const vmap = ctx.session.tenantVariantMap || [];
      const found = vmap.find((x) => x.num === n);
      if (!found) { await ctx.reply("Nomor varian tidak valid."); return; }
      ctx.session.userState = "WAIT_QTY";
      ctx.session.pickMode = "QTY";
      ctx.session.buyVariantId = found.id;
      await ctx.reply(`✅ Kamu memilih:\n${found.name}\nHarga: ${rupiah(found.price)}\nStok: ${found.stock}\n\nKirim angka qty.\nContoh: 3`, { reply_markup: { force_reply: true } });
      return;
    }
  });
}
