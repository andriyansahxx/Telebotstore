import { Markup } from "telegraf";
import { makeAdminHomeHandler, makeAdminProductsHandler, makeAdminBalanceHandler } from "./admin.js";
import { listProductsPaged, getProduct } from "../db/product.js";
import { listVariants, getVariant } from "../db/variant.js";
import { getBotStats } from "../db/statistic.js";
import { rupiah } from "../utils/ui.js";
import { numberKeyboard } from "../utils/reply_kb.js";
import { addStock } from "../db/stock.js";

const PAGE_SIZE = 10;

export function registerAdminMenuHears(bot, adminSet) {
  const isAdmin = (ctx) => adminSet.has(ctx.from?.id);

  bot.hears("🛠 Admin Panel", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = null;
    // reuse admin action handler logic
    const handler = makeAdminHomeHandler(adminSet);
    return handler(ctx);
  });

  bot.hears("📦 Kelola Produk", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const handler = makeAdminProductsHandler(adminSet);
    ctx.session = ctx.session || {};
    ctx.session.pickMode = "PRODUCT";
    // set ctx.match so the handler can read page if needed
    ctx.match = [undefined, '1'];
    return handler(ctx);
  });

  bot.hears("➕ Tambah Produk", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "ADD_PRODUCT";
    await ctx.reply("➕ Kirim nama produk:");
  });

  bot.hears("📊 Statistik", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const s = getBotStats();
    const text = `📊 STATISTIK BOT\n\n👥 Total User: ${s.users}\n💰 Total Saldo User: ${rupiah(s.saldo)}\n\n🧾 Total Transaksi: ${s.totalOrder}\n✅ Transaksi PAID: ${s.paidOrder}\n\n📦 Total Qty Terjual: ${s.qty}\n💵 Total Omzet: ${rupiah(s.omzet)}`;
    await ctx.reply(text, Markup.keyboard([["⬅️ Admin Panel"]]).resize());
  });

  bot.hears("👋 Set Welcome", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "WELCOME_ANY";
    await ctx.reply(`👋 Set Welcome\n\nKirim teks / foto / video / dokumen.`, Markup.keyboard([["❌ Batal"]]).resize());
  });

  bot.hears("📣 Broadcast", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "BROADCAST_ANY";
    await ctx.reply("📣 Broadcast\n\nKirim teks / foto / video / dokumen untuk dikirim ke semua user.", Markup.keyboard([["❌ Batal"]]).resize());
  });

  bot.hears("🖼 Set Logo Invoice", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "A_WAIT_LOGO";
    await ctx.reply("🖼 Kirim logo invoice untuk STORE UTAMA (foto).", Markup.keyboard([["⬅️ Admin Panel"]]).resize());
  });

  bot.hears("💰 Saldo User", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const handler = makeAdminBalanceHandler(adminSet);
    return handler(ctx);
  });

  bot.hears("➕ Tambah Saldo", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "BAL_ADD";
    await ctx.reply("Kirim format:\nuser_id amount\nContoh:\n123456789 50000");
  });

  bot.hears("➖ Kurangi Saldo", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "BAL_SUB";
    await ctx.reply("Kirim format:\nuser_id amount\nContoh:\n123456789 10000");
  });

  // numeric handler for admin flows
  bot.hears(/^\d+$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    const st = ctx.session?.adminState;
    if (!st) return;
    const n = Number(String(ctx.message?.text || "").trim());
    if (!Number.isFinite(n)) return;

    if (st === "ADMIN_PICK_PRODUCT") {
      const map = ctx.session.adminProductMap || [];
      const found = map.find((x) => x.num === n);
      if (!found) { await ctx.reply("Nomor produk tidak valid."); return; }
      const product = getProduct(0, found.id);
      if (!product) { await ctx.reply("Produk tidak ditemukan."); ctx.session.adminState = null; return; }

      const vars = listVariants(product.id, 0);
      if (!vars.length) { await ctx.reply(`🧾 ${product.name}\n\nBelum ada varian.`); ctx.session.adminState = null; return; }

      const vmap = vars.map((v,i) => ({ num: i+1, id: v.id, name: v.name, price: v.price, stock: v.stock }));
      ctx.session.adminVariantMap = vmap;
      ctx.session.adminState = "ADMIN_PICK_VARIANT";
      ctx.session.pickMode = "VARIANT";

      let txt = `🧾 ${product.name}\n\nPilih varian (ketik nomor):\n`;
      vars.forEach((v,i) => (txt += `${i+1}. ${v.name} — ${rupiah(v.price)} (stok: ${v.stock})\n`));
      await ctx.reply(txt, numberKeyboard(Math.min(vars.length, 11), "Gwei Store"));
      return;
    }

    if (st === "ADMIN_PICK_VARIANT") {
      const vmap = ctx.session.adminVariantMap || [];
      const found = vmap.find((x) => x.num === n);
      if (!found) { await ctx.reply("Nomor varian tidak valid."); return; }
      ctx.session.adminState = "A_WAIT_VARIANT_ACTION";
      ctx.session.pickMode = null;
      ctx.session.adminSelectedVariant = found;
      await ctx.reply(`✅ Kamu memilih:\n${found.name}\nHarga: ${rupiah(found.price)}\nStok: ${found.stock}\n\nPilih aksi:`, Markup.keyboard([["📥 Stok", "✏️ Edit Varian", "🗑 Hapus Varian"], ["⬅️ Admin Panel"]]).resize());
      return;
    }
  });
}
