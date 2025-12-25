import { listProductsPaged, getProduct } from "../db/product.js";
import { makeUserProductsHandler, makeUserSaldoHandler, makeUserHistoryHandler, makeUserStockHandler } from "./user.js";
import { getBalance, deductBalance } from "../db/balance.js";
import { listOrdersPaged, createOrder, getOrder, setPaymentMessage } from "../db/order.js";
import { Markup } from "telegraf";
import { rupiah } from "../utils/ui.js";
import { listVariants, getVariantByTenant } from "../db/variant.js";
import { db } from "../db/index.js";
import { fulfillProductOrder } from "../services/order_fulfill.js";
import { createQrisTx, payUrl } from "../services/pakasir.js";
import { getPakasirConfigByTenantId } from "../services/pakasir_config.js";
import { makeQrisPngBuffer } from "../services/qris_preview.js";

const PAGE_SIZE = 11;

export function registerUserMenuHears(bot) {
  bot.hears("📋 List Product", async (ctx) => {
    const handler = makeUserProductsHandler();
    // emulate a page=1 callback match for the handler
    ctx.match = [undefined, '1'];
    ctx.session = ctx.session || {};
    ctx.session.pickMode = "PRODUCT";
    ctx.session.userState = "PICK_PRODUCT";
    return handler(ctx);
  });

  // Numeric input handler: used for selecting product number
  // NOTE: variant and qty selection now use inline keyboards via callback actions
  bot.hears(/^\d+$/, async (ctx, next) => {
    const state = ctx.session?.userState;
    if (!state) return;
    if (state !== "PICK_PRODUCT") return next();
    const n = Number(String(ctx.message?.text || "").trim());
    if (!Number.isFinite(n)) return;

    // PICK_PRODUCT -> select product and show variants
    if (state === "PICK_PRODUCT") {
      const map = ctx.session.productMap || [];
      const found = map.find((x) => x.num === n);
      if (!found) {
        await ctx.reply("Nomor produk tidak valid.");
        return;
      }
      const tenantId = Number(ctx.state.tenantId || 0);
      const product = getProduct(tenantId, found.id);
      if (!product) {
        await ctx.reply("Produk tidak ditemukan.");
        ctx.session.userState = null;
        return;
      }

      const vars = listVariants(product.id, tenantId);
      if (!vars.length) {
        await ctx.reply(`🧾 ${product.name}\n\nBelum ada varian.`, ctx.state.menu);
        ctx.session.userState = null;
        return;
      }

      ctx.session.userState = "PICK_VARIANT_INLINE";

      let txt = `🧾 ${product.name}\n\nPilih varian:\n`;
      vars.forEach((v, i) => (txt += `${i + 1}. ${v.name} — ${rupiah(v.price)} (stok: ${v.stock})\n`));

      const buttons = vars.map((v) => [{ text: `${v.name}`, callback_data: `U_VARIANT:${v.id}` }]);
      buttons.push([{ text: "⬅️ Menu", callback_data: "BACK_MENU" }]);

      await ctx.reply(txt, Markup.inlineKeyboard(buttons));
      return;
    }
  });

  bot.hears("💰 Saldo", async (ctx) => {
    const handler = makeUserSaldoHandler();
    return handler(ctx);
  });

  bot.hears("🧾 Riwayat Transaksi", async (ctx) => {
    const handler = makeUserHistoryHandler();
    ctx.match = [undefined, '1'];
    return handler(ctx);
  });

  bot.hears("💳 Deposit Saldo", async (ctx) => {
    await ctx.reply("💳 Deposit Saldo: ketik jumlah yang ingin diisi.", ctx.state.menu);
  });

  bot.hears("🤝 SEWA BOT", async (ctx) => {
    await ctx.reply("🤝 SEWA BOT: Pilih paket sewa di menu berikutnya.", ctx.state.menu);
  });

  // PAYMENT CHOICES (reply keyboard) when checkout is pending
  bot.hears("💰 Pakai Saldo BOT", async (ctx) => {
    if (ctx.session?.userState !== "WAIT_PAYMENT_METHOD") return;
    const checkout = ctx.session.checkoutData;
    if (!checkout) return await ctx.reply("⚠️ Tidak ada checkout aktif.");

    const orderId = checkout.orderId;
    let order = getOrder(orderId);
    // create order if missing (from session)
    if (!order) {
      createOrder({
        tenantId: checkout.tenantId,
        userId: ctx.from.id,
        kind: "PRODUCT",
        variantId: checkout.variantId,
        qty: checkout.qty,
        orderId: checkout.orderId,
        amount: checkout.amount,
        total: checkout.amount
      });
      order = getOrder(orderId);
    }

    if (!order) return await ctx.reply("❌ Order tidak ditemukan.");
    if (order.user_id !== ctx.from.id) return await ctx.reply("❌ Bukan order kamu.");
    if (order.status !== "PENDING") return await ctx.reply("❌ Order sudah diproses.");
    if (order.kind !== "PRODUCT") return await ctx.reply("❌ Metode saldo hanya untuk produk.");

    const tenantId = Number(order.tenant_id ?? 0);
    const total = Number(order.total);
    const bal = getBalance(tenantId, ctx.from.id);
    if (bal < total) {
      await ctx.reply(`❌ SALDO TIDAK CUKUP\n\nSaldo: Rp${bal.toLocaleString("id-ID")}\nTotal: Rp${total.toLocaleString("id-ID")}\n\nSilakan deposit saldo terlebih dahulu.`, ctx.state.menu);
      return;
    }

    // validate stock
    const variantId = Number(order.variant_id);
    const qty = Number(order.qty);
    const v = getVariantByTenant(tenantId, variantId);
    if (!v) return await ctx.reply('⚠️ Produk tidak ditemukan. Silakan hubungi admin.');

    const stockRows = db.prepare(`SELECT id FROM stock_items WHERE tenant_id=? AND variant_id=? AND used=0 LIMIT ?`).all(tenantId, variantId, qty);
    if (stockRows.length < qty) {
      await ctx.reply(`⚠️ STOK TIDAK CUKUP\n\nProduk: <b>${v.name}</b>\nStok tersedia: ${stockRows.length}\nDiminta: ${qty}\n\nSilakan hubungi admin atau ubah qty.`, { parse_mode: "HTML" });
      return;
    }

    // deduct balance and fulfill
    try {
      deductBalance(tenantId, ctx.from.id, total);
      const ok = await fulfillProductOrder({ ctx, order });
      if (!ok) return;
      const newBal = getBalance(tenantId, ctx.from.id);
      await ctx.reply(`✅ PEMBAYARAN VIA SALDO BERHASIL\n\nInvoice: <code>${orderId}</code>\nTotal: Rp${total.toLocaleString("id-ID")}\nSaldo tersisa: Rp${newBal.toLocaleString("id-ID")}`, { parse_mode: "HTML" });
      ctx.session.userState = null;
      ctx.session.checkoutData = null;
    } catch (e) {
      console.error('PAY_BALANCE_ERR (hears):', e);
      await ctx.reply('⚠️ Terjadi error saat memproses pembayaran.');
    }
  });

  bot.hears("📲 QRIS Pakasir", async (ctx) => {
    if (ctx.session?.userState !== "WAIT_PAYMENT_METHOD") return;
    const checkout = ctx.session.checkoutData;
    if (!checkout) return await ctx.reply("⚠️ Tidak ada checkout aktif.");
    const orderId = checkout.orderId;
    let order = getOrder(orderId);
    if (!order) {
      createOrder({
        tenantId: checkout.tenantId,
        userId: ctx.from.id,
        kind: "PRODUCT",
        variantId: checkout.variantId,
        qty: checkout.qty,
        orderId: checkout.orderId,
        amount: checkout.amount,
        total: checkout.amount
      });
      order = getOrder(orderId);
    }
    if (!order) return await ctx.reply("❌ Order tidak ditemukan.");
    if (order.user_id !== ctx.from.id) return await ctx.reply("❌ Bukan order kamu.");
    if (order.status !== "PENDING") return await ctx.reply("❌ Order sudah diproses.");
    if (order.kind !== "PRODUCT") return await ctx.reply("❌ Metode QRIS hanya untuk produk.");

    const tenantId = Number(order.tenant_id ?? 0);
    const total = Number(order.total);
    const cfg = getPakasirConfigByTenantId(tenantId);
    if (!cfg?.slug || !cfg?.apiKey) return await ctx.reply("❌ Pakasir belum dikonfigurasi.");

    try {
      const tx = await createQrisTx({ slug: cfg.slug, apiKey: cfg.apiKey, orderId, amount: total });
      const qrString = tx.payment?.payment_number;
      if (!qrString) throw new Error('pakasir_payment_number_missing');
      const png = await makeQrisPngBuffer(qrString);

      const expiresAt = new Date(Date.now() + Number(process.env.PAY_EXPIRE_MIN || 10) * 60_000);

      // send QR image + caption (no inline keyboard)
      const msg = await ctx.replyWithPhoto({ source: png }, { caption: `📲 QRIS PAYMENT\n\nInvoice: ${orderId}\nTotal: Rp${total.toLocaleString('id-ID')}\nExpired: ${expiresAt.toLocaleString('id-ID')}\n\nScan QR untuk membayar.\nPayment akan dicek otomatis.`, parse_mode: 'HTML' });
      setPaymentMessage(orderId, msg.chat.id, msg.message_id, expiresAt.toISOString());

      // also send plain pay URL and reply keyboard controls
      await ctx.reply(`Bayar sekarang: ${payUrl({ slug: cfg.slug, apiKey: cfg.apiKey, amount: total, orderId })}`, ctx.state.menu);
      ctx.session.userState = null;
      ctx.session.checkoutData = null;
    } catch (e) {
      console.error('PAY_QRIS_ERR (hears):', e);
      await ctx.reply('⚠️ Terjadi error saat membuat QRIS.');
    }
  });

  bot.hears("❌ Batal", async (ctx) => {
    // cancel checkout
    ctx.session.userState = null;
    ctx.session.checkoutData = null;
    await ctx.reply('❌ Dibatalkan.', ctx.state.menu);
  });

  bot.hears("📦 Stock", async (ctx) => {
    const handler = makeUserStockHandler();
    return handler(ctx);
  });

  bot.hears("✨ Information", async (ctx) => {
    await ctx.reply("✨ Information: Informasi toko.", ctx.state.menu);
  });

  bot.hears("❓ Cara Order", async (ctx) => {
    await ctx.reply("❓ Cara order:\n1) Klik List Product...\n2) Pilih nomor...", ctx.state.menu);
  });
}
