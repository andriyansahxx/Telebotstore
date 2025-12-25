import { mainMenuKeyboard, mainMenuReplyKeyboard } from "../utils/ui.js";
import { mainReplyKeyboard } from "../utils/reply_kb.js";
import { Markup } from "telegraf";
import { listProductsPaged, getProduct } from "../db/product.js";
import { listVariants, getVariant, getVariantByTenant } from "../db/variant.js";
import { createOrder, getOrder, setPaid, listOrdersPaged, markDelivered } from "../db/order.js";
import { popStockFIFO } from "../db/stock.js";
import { getSetting } from "../db/settings.js";
import { createRent, getRent, activateRent } from "../db/rent.js";
import { rupiah } from "../utils/ui.js";
import { payUrl, transactionDetail, createQrisTx } from "../services/pakasir.js";
import { getPakasirConfigByTenantId } from "../services/pakasir_config.js";
import { tenantNeedsPakasir, sendPakasirNotSetMessage } from "../utils/checkout_guard.js";
import { qrisPreviewUrl } from "../services/qris.js";
import { makeQrisPngBuffer } from "../services/qris_preview.js";
import { getBotUsername } from "../bot.js";
import { editOrReply } from "../utils/edit_or_reply.js";
import { setPaymentMessage } from "../db/order.js";
import { buildInvoicePng } from "../services/invoice_image.js";
import { resolveInvoiceLogoBuffer } from "../services/invoice_logo.js";
import { getTenantByOwner, createTenant, setUserTenant, setTenantPakasir, getTenant, setTenantWelcome, setTenantLogo } from "../db/tenant.js";
import { getBalance, deductBalance } from "../db/balance.js";
import { db } from "../db/index.js";
import { fulfillProductOrder } from "../services/order_fulfill.js";

const PAGE_SIZE = 10;
const MAX_QTY = Number(process.env.MAX_QTY || 50);

function makeVariantPrompt(product, variants) {
  let text = `🧾 ${product.name}\n\nPilih varian:\n`;
  variants.forEach((v, i) => (text += `${i + 1}. ${v.name} — ${rupiah(v.price)} (stok: ${v.stock})\n`));

  const buttons = variants.map((v) => [{ text: `${v.name}`, callback_data: `U_VARIANT:${v.id}` }]);
  buttons.push([{ text: "⬅️ Menu", callback_data: "BACK_MENU" }]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

function makeQtyKeyboard(maxQty) {
  const buttons = [];
  for (let i = 1; i <= maxQty; i++) {
    const row = Math.floor((i - 1) / 5);
    buttons[row] = buttons[row] || [];
    buttons[row].push({ text: `${i}`, callback_data: `U_QTY:${i}` });
  }
  buttons.push([{ text: "❌ Batal", callback_data: "CANCEL" }]);
  return Markup.inlineKeyboard(buttons);
}

// Exportable factories so hears can reuse the same handlers as actions
export function makeUserProductsHandler() {
  return async function userProducts(ctx) {
    try {
      const page = Number(ctx.match?.[1]) || 1;
      const tenantId = Number(ctx.state.tenantId) || 0;
      const { rows, pages, total } = listProductsPaged(tenantId, page, PAGE_SIZE);

      if (!total) {
        await editOrReply(ctx, "🛍 LIST PRODUK\n\nBelum ada produk.", ctx.state.menu);
        return;
      }

      // mapping nomor -> product_id
      const map = rows.map((p, idx) => ({ num: idx + 1, id: p.id, name: p.name }));
      ctx.session = ctx.session || {};
      ctx.session.productMap = map;

      let text = "🛍 LIST PRODUK\n\n";
      rows.forEach((p, i) => (text += `${i + 1}. ${p.name}\n`));

      // Use inline keyboard for product selection (hybrid pattern)
      const buttons = rows.map((p, i) => [{ text: `${i + 1}. ${p.name}`, callback_data: `U_PNUM:${i + 1}` }]);
      const nav = [];
      if (page > 1) nav.push({ text: "⬅️", callback_data: `U_PRODUCTS:${page - 1}` });
      nav.push({ text: `${page}/${pages}`, callback_data: "NOP" });
      if (page < pages) nav.push({ text: "➡️", callback_data: `U_PRODUCTS:${page + 1}` });
      buttons.push(nav);
      buttons.push([{ text: "⬅️ Menu", callback_data: "BACK_MENU" }]);

      try {
        await editOrReply(ctx, text, Markup.inlineKeyboard(buttons));
      } catch (e) {
        if (e.response?.error_code === 400 && e.response?.description?.includes("not modified")) {
          await ctx.answerCbQuery("Page sudah ditampilkan");
          return;
        }
        throw e;
      }
    } catch (e) {
      if (e.response?.error_code === 400 && e.response?.description?.includes("not modified")) {
        await ctx.answerCbQuery("Page sudah ditampilkan");
        return;
      }
      throw e;
    }
  };
}

export function makeUserSaldoHandler() {
  return async function userSaldo(ctx) {
    try {
      const tenantId = Number(ctx.state.tenantId) || 0;
      const balance = getBalance(tenantId, ctx.from.id);
      await editOrReply(ctx, `💰 Saldo kamu: ${rupiah(balance)}`, ctx.state.menu);
    } catch (e) {
      if (e.response?.error_code === 400 && e.response?.description?.includes("not modified")) {
        await ctx.answerCbQuery("Saldo sudah ditampilkan");
        return;
      }
      throw e;
    }
  };
}

export function makeUserHistoryHandler() {
  return async function userHistory(ctx) {
    const page = Number(ctx.match?.[1]) || 1;
    const { rows, pages, total } = listOrdersPaged(ctx.from.id, page, 10);

    if (!total) {
      await editMessageSafe(ctx, "🧾 Riwayat kosong.", { reply_markup: ctx.state.menu });
      return;
    }

    let text = "🧾 RIWAYAT\n\n";
    for (const r of rows) {
      const label = r.kind === "RENT" ? "SEWA BOT" : (r.variant_name || "-");
      text += `• ${label} x${r.qty} = ${rupiah(r.total)} (${r.status})\nInvoice: ${r.order_id}\n\n`;
    }

    const nav = [];
    if (page > 1) nav.push("⬅️");
    nav.push(`${page}/${pages}`);
    if (page < pages) nav.push("➡️");
    try { await editMessageSafe(ctx, text); } catch {}
    await ctx.reply(text, Markup.keyboard([nav, ["⬅️ Menu"]]).resize());
  };
}

export function makeUserStockHandler() {
  return async function userStock(ctx) {
    await ctx.reply("📦 Stock: pilih produk dulu.", ctx.state.menu);
  };
}

async function editMessageSafe(ctx, text, options = {}) {
  try {
    return await ctx.editMessageText(text, options);
  } catch (e) {
    // If original message was a photo (no text to edit), try editing caption
    try {
      return await ctx.editMessageCaption(text, { reply_markup: options.reply_markup });
    } catch (e2) {
      // Last resort: send a new message
      try { return await ctx.reply(text, options); } catch (e3) { console.error('EDIT_FALLBACK_FAILED', e3); }
    }
  }
}

// use getPakasirConfigByTenant from services to resolve pakasir config per-tenant

export function registerUserActions(bot, adminSet) {
  bot.action("BACK_MENU", async (ctx) => {
    // Send a new message with reply-keyboard (hybrid flow)
    try {
      await ctx.reply("Menu:", { reply_markup: ctx.state.menu });
    } catch (e) {
      // last resort
      await ctx.reply("Menu:");
    }
  });

  // welcome settings preview on /start is already; optional via button later
  
  bot.action(/U_PRODUCTS:(\d+)/, makeUserProductsHandler());

  bot.action(/U_PNUM:(\d+)/, async (ctx) => {
    const num = Number(ctx.match[1]);
    const map = ctx.session.productMap || [];
    const found = map.find((x) => x.num === num);
    if (!found) {
      await ctx.answerCbQuery("Nomor tidak valid");
      return;
    }

    const tenantId = Number(ctx.state.tenantId) || 0;
    const product = getProduct(tenantId, found.id);
    if (!product) {
      await editOrReply(ctx, "Produk tidak ditemukan.", ctx.state.menu);
      return;
    }

    const vars = listVariants(product.id, tenantId);
    if (!vars.length) {
      await editOrReply(ctx, `🧾 ${product.name}\n\nBelum ada varian.`, ctx.state.menu);
      return;
    }

    ctx.session.userState = "PICK_VARIANT_INLINE";

    const { text, keyboard } = makeVariantPrompt(product, vars);
    await editOrReply(ctx, text, keyboard);
  });

  bot.action(/U_VARIANT:(\d+)/, async (ctx) => {
    const vid = Number(ctx.match[1]);
    const v = getVariant(vid);
    if (!v) {
      await editOrReply(ctx, "Varian tidak ditemukan.", ctx.state.menu);
      return;
    }

    const maxQty = Math.min(MAX_QTY, Number(v.stock) || 0);
    if (maxQty <= 0) {
      await editOrReply(ctx, `⚠️ Stok ${v.name} sedang kosong.`, ctx.state.menu);
      return;
    }

    ctx.session.userState = "PICK_QTY_INLINE";
    ctx.session.buyVariantId = vid;

    await ctx.reply(
      `✅ Varian dipilih:\n${v.name}\nHarga: ${rupiah(v.price)}\nStok: ${v.stock}\n\nPilih qty:`,
      makeQtyKeyboard(maxQty)
    );
  });

  bot.action(/U_QTY:(\d+)/, async (ctx) => {
    const qty = Number(ctx.match[1]);
    const vid = Number(ctx.session?.buyVariantId);

    if (!vid) {
      await ctx.answerCbQuery("❌ Pilih varian terlebih dahulu.");
      return;
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      await ctx.answerCbQuery("❌ Qty tidak valid.");
      return;
    }

    const v = getVariant(vid);
    if (!v) {
      await editOrReply(ctx, "Varian tidak ditemukan.", ctx.state.menu);
      return;
    }

    const maxQty = Math.min(MAX_QTY, Number(v.stock) || 0);
    if (qty > maxQty) {
      await ctx.answerCbQuery("❌ Qty melebihi stok/maks.");
      return;
    }

    ctx.session.buyVariantId = null;
    ctx.session.userState = null;

    await startCheckoutFlow(ctx, vid, qty);
  });
  
  bot.action("CANCEL", async (ctx) => {
    ctx.session.userState = null;
    ctx.session.buyVariantId = null;
    ctx.session.checkoutData = null;
    await editMessageSafe(ctx, "❌ Dibatalkan.", { reply_markup: ctx.state.menu });
  });

  // PAYMENT METHOD: BALANCE
  bot.action(/PAY_BALANCE:(.+)/, async (ctx) => {
    try {
      const orderId = String(ctx.match[1]).trim();
      let order = getOrder(orderId);
      
      // DEBUG: Log order lookup
      if (!order) {
        console.log("🔍 PAY_BALANCE order not found:", orderId);
      }

      // Jika order belum ada tapi ada checkout data, buat order dulu
      if (!order && ctx.session?.checkoutData) {
        const checkout = ctx.session.checkoutData;
        if (checkout.orderId === orderId) {
          // Create order from checkout session
          createOrder({
            tenantId: checkout.tenantId,
            userId: ctx.from.id,
            kind: "PRODUCT",
            variantId: checkout.variantId,
            qty: checkout.qty,
            orderId: orderId,
            amount: checkout.amount,
            total: checkout.amount
          });
          order = getOrder(orderId);
        }
      }

      if (!order) {
        await ctx.answerCbQuery("❌ Order tidak ditemukan.");
        // Delete payment confirmation message
        try {
          await ctx.deleteMessage();
        } catch (e) {
          // Message might already be deleted, ignore
        }
        // Send error message
        await ctx.reply(
          `⚠️ PESANAN TIDAK DITEMUKAN\n\n` +
          `Invoice: ${orderId}\n\n` +
          `Pembayaran tidak dapat diproses. Silakan hubungi admin.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      if (order.user_id !== ctx.from.id) {
        await ctx.answerCbQuery("❌ Bukan order kamu.");
        return;
      }

      if (order.status !== "PENDING") {
        await ctx.answerCbQuery("❌ Order sudah diproses.");
        return;
      }

      if (order.kind !== "PRODUCT") {
        await ctx.answerCbQuery("❌ Metode saldo hanya untuk produk.");
        return;
      }

      const total = Number(order.total);
      const tenantId = Number(order.tenant_id ?? 0);
      const bal = getBalance(tenantId, ctx.from.id);

      if (bal < total) {
        await ctx.answerCbQuery("❌ Saldo tidak cukup.");
        await ctx.reply(`❌ SALDO TIDAK CUKUP\n\nSaldo: Rp${bal.toLocaleString("id-ID")}\nTotal: Rp${total.toLocaleString("id-ID")}\n\nSilakan deposit saldo terlebih dahulu.`, Markup.keyboard([["💳 Deposit Saldo"]]).resize());
        return;
      }

      // Validasi stok tersedia SEBELUM deduct balance
      // Ini untuk mencegah pembayaran sukses tapi stok kosong
      const variantId = Number(order.variant_id);
      const qty = Number(order.qty);

      const v = getVariantByTenant(tenantId, variantId);
      if (!v) {
        await ctx.answerCbQuery("❌ Produk tidak ditemukan.");
        await ctx.reply(`⚠️ Produk tidak ditemukan. Silakan hubungi admin.`, { parse_mode: "HTML" });
        return;
      }

      // Cek stok FIFO tersedia
      const stockRows = db.prepare(`
        SELECT id FROM stock_items
        WHERE tenant_id=? AND variant_id=? AND used=0
        LIMIT ?
      `).all(tenantId, variantId, qty);

      if (stockRows.length < qty) {
        await ctx.answerCbQuery("❌ Stok tidak cukup.");
        await ctx.reply(
          `⚠️ STOK TIDAK CUKUP\n\n` +
          `Produk: <b>${v.name}</b>\n` +
          `Stok tersedia: ${stockRows.length}\n` +
          `Diminta: ${qty}\n\n` +
          `Silakan hubungi admin atau ubah qty.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // Semua validasi passed - deduct saldo (aman karena pakai syarat saldo >= amount di SQL)
      deductBalance(tenantId, ctx.from.id, total);

      await ctx.answerCbQuery("✅ Diproses...");

      // Delete payment confirmation message
      try {
        await ctx.deleteMessage();
      } catch (e) {
        // Message might already be deleted, ignore
      }

      // Fulfillment = kirim stok (gunakan fulfillProductOrder untuk consistency)
      const ok = await fulfillProductOrder({ ctx, order });
      if (!ok) return;

      const newBalance = getBalance(tenantId, ctx.from.id);
      await ctx.reply(
        `✅ PEMBAYARAN VIA SALDO BERHASIL\n\n` +
        `Invoice: <code>${orderId}</code>\n` +
        `Total: Rp${total.toLocaleString("id-ID")}\n` +
        `Saldo tersisa: Rp${newBalance.toLocaleString("id-ID")}`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("PAY_BALANCE_ERR:", e);
      await ctx.answerCbQuery("⚠️ Error saat proses saldo");
      await ctx.reply(
        `⚠️ TERJADI ERROR\n\n` +
        `Error: ${e.message}\n\n` +
        `Silakan coba /start atau hubungi admin.`,
        { parse_mode: "HTML" }
      );
    }
  });

  // PAYMENT METHOD: QRIS
  bot.action(/PAY_QRIS:(.+)/, async (ctx) => {
    try {
      const orderId = String(ctx.match[1]).trim();
      let order = getOrder(orderId);
      
      // DEBUG: Log order lookup
      if (!order) {
        console.log("🔍 PAY_QRIS order not found:", orderId);
      }

      // Jika order belum ada tapi ada checkout data, buat order dulu
      if (!order && ctx.session?.checkoutData) {
        const checkout = ctx.session.checkoutData;
        if (checkout.orderId === orderId) {
          // Create order from checkout session
          createOrder({
            tenantId: checkout.tenantId,
            userId: ctx.from.id,
            kind: "PRODUCT",
            variantId: checkout.variantId,
            qty: checkout.qty,
            orderId: orderId,
            amount: checkout.amount,
            total: checkout.amount
          });
          order = getOrder(orderId);
        }
      }

      if (!order) {
        await ctx.answerCbQuery("❌ Order tidak ditemukan.");
        // Delete payment confirmation message
        try {
          await ctx.deleteMessage();
        } catch (e) {
          // Message might already be deleted, ignore
        }
        // Send error message
        await ctx.reply(
          `⚠️ PESANAN TIDAK DITEMUKAN\n\n` +
          `Invoice: ${orderId}\n\n` +
          `Pembayaran tidak dapat diproses. Silakan hubungi admin.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      if (order.user_id !== ctx.from.id) {
        await ctx.answerCbQuery("❌ Bukan order kamu.");
        return;
      }

      if (order.status !== "PENDING") {
        await ctx.answerCbQuery("❌ Order sudah diproses.");
        return;
      }

      if (order.kind !== "PRODUCT") {
        await ctx.answerCbQuery("❌ Metode QRIS hanya untuk produk.");
        return;
      }

      const tenantId = Number(order.tenant_id ?? 0);
      const total = Number(order.total);

      // Get pakasir config
      const cfg = getPakasirConfigByTenantId(tenantId);
      if (!cfg?.slug || !cfg?.apiKey) {
        await ctx.answerCbQuery("❌ Pakasir belum dikonfigurasi.");
        return;
      }

      // Create QRIS transaction via Pakasir API
      let tx, qrString;
      try {
        tx = await createQrisTx({
          slug: cfg.slug,
          apiKey: cfg.apiKey,
          orderId,
          amount: total
        });
        
        // Extract QR string dari payment_number (QRIS payload)
        qrString = tx.payment?.payment_number;
        if (!qrString) {
          console.error("❌ QR_STRING_MISSING: payment_number tidak ada dalam response");
          throw new Error("pakasir_payment_number_missing");
        }
        
        console.log("✅ QRIS TX created:", orderId, "qr_len:", qrString.length);
      } catch (txErr) {
        console.error("❌ createQrisTx failed:", txErr.message);
        await ctx.answerCbQuery("❌ Gagal buat QRIS");
        await ctx.reply(`⚠️ Gagal membuat QRIS: ${txErr.message}`);
        return;
      }

      // Render QR string ke PNG
      let pngBuffer;
      try {
        pngBuffer = await makeQrisPngBuffer(qrString);
        console.log("✅ QR PNG rendered:", pngBuffer.length, "bytes");
      } catch (pngErr) {
        console.error("❌ makeQrisPngBuffer failed:", pngErr.message);
        await ctx.answerCbQuery("❌ Gagal render QR");
        await ctx.reply(`⚠️ Gagal render QR: ${pngErr.message}`);
        return;
      }

      // Save payment message for tracking
      const expireMin = Number(process.env.PAY_EXPIRE_MIN || 10);
      const expiresAt = new Date(Date.now() + expireMin * 60_000);

      await ctx.answerCbQuery("✅ Menampilkan QRIS...");

      // Delete payment confirmation message
      try {
        await ctx.deleteMessage();
      } catch (e) {
        // Message might already be deleted, ignore
      }

      const msg = await ctx.replyWithPhoto({ source: pngBuffer }, { caption: `📲 QRIS PAYMENT\n\nInvoice: ${orderId}\nTotal: Rp${total.toLocaleString("id-ID")}\nExpired: ${expiresAt.toLocaleString("id-ID")}\n\nScan QR untuk membayar.\nPayment akan dicek otomatis setiap beberapa detik.` });
      // Simpan message id untuk di-refresh / delete ketika expired
      setPaymentMessage(orderId, msg.chat.id, msg.message_id, expiresAt.toISOString());
      // send pay URL and reply keyboard
      await ctx.reply(`Bayar sekarang: ${payUrl({ slug: cfg.slug, apiKey: cfg.apiKey, amount: total, orderId })}`, Markup.keyboard([["❌ Batal"]]).resize());
    } catch (e) {
      console.error("PAY_QRIS_ERR:", e);
      await ctx.answerCbQuery("⚠️ Error saat proses QRIS");
      await ctx.reply("⚠️ Terjadi error saat proses QRIS. Silakan coba /start.");
    }
  });

  bot.action("U_SALDO", makeUserSaldoHandler());
  bot.action(/U_HISTORY:(\d+)/, makeUserHistoryHandler());

  

  // ===== RENT =====
  bot.action("U_RENT", async (ctx) => {
    const p1 = Number(process.env.RENT_PLAN_1M || 50000);
    const p3 = Number(process.env.RENT_PLAN_3M || 135000);
    const p12 = Number(process.env.RENT_PLAN_12M || 480000);

    const buttons = [
      [{ text: `1 Bulan — ${rupiah(p1)}`, callback_data: "U_RENT_PLAN:1" }],
      [{ text: `3 Bulan — ${rupiah(p3)}`, callback_data: "U_RENT_PLAN:3" }],
      [{ text: `12 Bulan — ${rupiah(p12)}`, callback_data: "U_RENT_PLAN:12" }],
      [{ text: "⬅️ Menu", callback_data: "BACK_MENU" }]
    ];
    try{ await editMessageSafe(ctx, "🤝 SEWA BOT\n\nPilih paket:"); }catch{};
    await ctx.reply("🤝 SEWA BOT\n\nPilih paket:", Markup.inlineKeyboard(buttons));
  });

  bot.action(/U_RENT_PLAN:(\d+)/, async (ctx) => {
    const months = Number(ctx.match[1]);
    // determine order tenant id first
    const ownerT = getTenantByOwner(ctx.from.id);
    const tenantForOrder = Number(ctx.state.tenantId) || (ownerT ? ownerT.id : 0);

    // guard based on order.tenant_id
    if (tenantNeedsPakasir(tenantForOrder)) {
      await sendPakasirNotSetMessage(ctx, tenantForOrder);
      return editMessageSafe(ctx, "Pakasir belum dikonfigurasi.", { reply_markup: ctx.state.menu });
    }

    let cfg = getPakasirConfigByTenantId(tenantForOrder);
    if (!cfg?.slug || !cfg?.apiKey) return editMessageSafe(ctx, "Pakasir belum dikonfigurasi.", { reply_markup: ctx.state.menu });

    const price =
      months === 1 ? Number(process.env.RENT_PLAN_1M || 50000) :
      months === 3 ? Number(process.env.RENT_PLAN_3M || 135000) :
      Number(process.env.RENT_PLAN_12M || 480000);

    const orderId = `R${Date.now().toString(36)}`.toUpperCase();
    const tenantId = Number(ctx.state.tenantId) || 0;

    // GUARD: jika tenant > 0 dan belum set pakasir, stop
    if (tenantNeedsPakasir(tenantId)) {
      await sendPakasirNotSetMessage(ctx, tenantId);
      ctx.session.userState = null;
      return editMessageSafe(ctx, "⚠️ Checkout diblokir karena Pakasir belum diset.", { reply_markup: ctx.state.menu });
    }

    createOrder({
      tenantId: tenantId,
      userId: ctx.from.id,
      kind: "RENT",
      variantId: null,
      qty: 1,
      orderId,
      amount: price,
      total: price,
      payUrl: null
    });
    createRent({ userId: ctx.from.id, plan: `${months} Bulan`, months, price, orderId });

    // Create QRIS transaction via Pakasir API
    let tx, qrString;
    try {
      tx = await createQrisTx({
        slug: cfg.slug,
        apiKey: cfg.apiKey,
        orderId,
        amount: price
      });
      
      // Extract QR string dari payment_number (QRIS payload)
      qrString = tx.payment?.payment_number;
      if (!qrString) {
        console.error("❌ RENT QR_STRING_MISSING: payment_number tidak ada");
        throw new Error("pakasir_payment_number_missing");
      }
      
      console.log("✅ RENT QRIS TX created:", orderId, "qr_len:", qrString.length);
    } catch (txErr) {
      console.error("❌ RENT createQrisTx failed:", txErr.message);
      return editMessageSafe(ctx, `⚠️ Gagal buat QRIS: ${txErr.message}`, { reply_markup: ctx.state.menu });
    }

    // Render QR string ke PNG
    let pngBuffer;
    try {
      pngBuffer = await makeQrisPngBuffer(qrString);
    } catch (pngErr) {
      console.error("❌ RENT makeQrisPngBuffer failed:", pngErr.message);
      return editMessageSafe(ctx, `⚠️ Gagal render QR: ${pngErr.message}`, { reply_markup: ctx.state.menu });
    }

    const expireMin = Number(process.env.PAY_EXPIRE_MIN || 10);
    const expiresAt = new Date(Date.now() + expireMin * 60_000);
    const expiresText = `Expired: ${expiresAt.toLocaleString("id-ID")}`;

    const msg = await ctx.replyWithPhoto(
      { source: pngBuffer },
      {
        caption:
          `📲 QRIS PAYMENT (RENT)\n\n` +
          `Invoice: ${orderId}\n` +
          `Total: ${rupiah(price)}\n` +
          `${expiresText}\n\n` +
          `Scan QR untuk membayar.`,
        parse_mode: 'HTML'
      }
    );

    // simpan message id untuk di-refresh / delete ketika expired
    setPaymentMessage(orderId, msg.chat.id, msg.message_id, expiresAt.toISOString());
    // send pay url and reply keyboard controls
    await ctx.reply(`Bayar sekarang: ${payUrl({ slug: cfg.slug, apiKey: cfg.apiKey, amount: price, orderId })}`);
    await ctx.reply('Jika sudah membayar, tekan:', Markup.keyboard([["✅ Saya sudah bayar"], ["❌ Batal"]]).resize());
  });

  // ===== CHECK PAYMENT =====
  bot.action(/U_CHECKPAY:(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = getOrder(orderId);
    if (order?.status === "PAID" && order?.delivered_at) {
      await ctx.answerCbQuery("Sudah PAID & sudah terkirim.");
      await ctx.reply(`✅ Invoice ${orderId} sudah selesai.`);
      return;
    }
    if (order?.status === "EXPIRED") {
      await ctx.reply("⌛ Invoice sudah expired. Buat invoice baru ya.");
      return;
    }
    if (!order || order.user_id !== ctx.from.id) return ctx.answerCbQuery("Invoice tidak ditemukan.");

    // Resolve pakasir config from the order itself (source of truth)
    const cfg = getPakasirConfigByTenantId(order.tenant_id || 0);
    if (!cfg?.slug || !cfg?.apiKey) return ctx.answerCbQuery("Pakasir belum diset.");

    try {
      const detail = await transactionDetail({ slug: cfg.slug, apiKey: cfg.apiKey, amount: order.amount, orderId });
      
      // If detail is null (404), payment not yet recorded by Pakasir API
      if (!detail) {
        await ctx.reply(`⏳ Pembayaran belum terdeteksi.\nTunggu beberapa saat dan coba lagi.\nInvoice: ${orderId}`);
        return;
      }

      const tx = detail?.transaction || detail?.payment || detail?.data || null;

      // Pakasir docs use transactiondetail; status sukses umumnya "completed"
      const status = String(tx?.status || "").toLowerCase();
      if (status !== "completed") {
        await ctx.reply(`⏳ Belum lunas.\nInvoice: ${orderId}\nStatus: ${tx?.status || "unknown"}`);
        return;
      }

      setPaid(orderId);

      // build and send paid invoice image before activation/delivery
      const paidOrder = getOrder(orderId);
      const rentRow = getRent(orderId);
      const isRent = (paidOrder?.kind === "RENT") || Boolean(rentRow);
      if (paidOrder) {
        try {
          if (isRent) {
            const months = rentRow?.months ?? 1;
            const tenantId = Number(paidOrder?.tenant_id || 0);
            const logoBuffer = await resolveInvoiceLogoBuffer(ctx.telegram, tenantId);
            
            const invoicePng = await buildInvoicePng({
              title: "INVOICE (SUKSES)",
              orderId,
              totalText: rupiah(paidOrder.total),
              payUrl: paidOrder.pay_url || "",
              expiresText: "Status: PAID",
              lines: [
                "Produk: SEWA BOT",
                `Qty: ${paidOrder.qty}`,
                `Pembayaran: LUNAS`
              ],
              storeName: getTenant(tenantId)?.name || "",
              logoBuffer: logoBuffer || null
            });

            await ctx.replyWithPhoto(
              { source: invoicePng, filename: `invoice_${orderId}.png` },
              { caption: `✅ Pembayaran sukses\nInvoice: ${orderId}` }
            );

            // activate rent after sending invoice; prefer months from rent row
            activateRent(orderId, rentRow?.months ?? monthsFromPlan(orderId));
            const rent = getRent(orderId);
            
            // create tenant for reseller if not already exists
            const existing = getTenantByOwner(ctx.from.id);
            const newTenantId = existing ? existing.id : createTenant({ ownerUserId: ctx.from.id, name: `Toko ${ctx.from.username || ctx.from.id}` });
            setUserTenant(ctx.from.id, newTenantId);
            
            // update ctx.state with new tenant info so tenant payments use tenant pakasir
            ctx.state.tenantId = newTenantId;
            ctx.state.isTenantOwner = true;
            ctx.state.menu = mainReplyKeyboard({ storeName: getTenant(newTenantId)?.name || "STORE", isAdmin: ctx.state.isAdmin, isTenantOwner: true });
            
            const botUsername = getBotUsername();
            if (!botUsername) {
              await ctx.reply("⚠️ Bot username belum siap. Coba lagi beberapa detik.");
              return;
            }
            
            await editMessageSafe(ctx,
              `✅ SEWA AKTIF!\n\nInvoice: ${orderId}\nBerakhir: ${rent?.ends_at || "-"}\n\n🏪 Link Toko:\nhttps://t.me/${botUsername}?start=store_${tenantId}`,
              { reply_markup: ctx.state.menu }
            );
            return;
          }

          // PRODUCT: send invoice image, then deliver stock
          const v = getVariant(paidOrder.variant_id);
          const tenantId = Number(paidOrder?.tenant_id || 0);
          const logoBuffer = await resolveInvoiceLogoBuffer(ctx.telegram, tenantId);

          try {
            const invoicePng = await buildInvoicePng({
              title: "INVOICE (SUKSES)",
              orderId,
              totalText: rupiah(paidOrder.total),
              payUrl: paidOrder.pay_url || "",
              expiresText: "Status: PAID",
              lines: [
                `Produk: ${(v?.name || "-")}`,
                `Qty: ${paidOrder.qty}`,
                `Pembayaran: LUNAS`
              ],
              storeName: getTenant(tenantId)?.name || "",
              logoBuffer: logoBuffer || null
            });

            await ctx.replyWithPhoto(
              { source: invoicePng, filename: `invoice_${orderId}.png` },
              { caption: `✅ Pembayaran sukses\nInvoice: ${orderId}` }
            );
          } catch (e) {
            console.error("INVOICE_PNG_FAIL:", e);
            await ctx.reply(`✅ Pembayaran sukses\nInvoice: ${orderId}\nTotal: ${rupiah(paidOrder.total)}`);
          }

          const items = popStockFIFO(paidOrder.variant_id, paidOrder.qty, orderId);
          if (!items) {
            await ctx.reply(`⚠️ PAID tapi stok tidak cukup.\nInvoice: ${orderId}\nHubungi admin.`);
            return;
          }

          const buffer = Buffer.from(items.join("\n"), "utf-8");
          await ctx.replyWithDocument(
            { source: buffer, filename: `stok_${orderId}.txt` },
            { caption: `✅ Delivery berhasil\nProduk: ${v?.name || "-"}\nQty: ${paidOrder.qty}\nInvoice: ${orderId}` }
          );

          // mark order as delivered after sending the stock document
          try {
            markDelivered(orderId, paidOrder.qty);
          } catch (e) {
            console.error("MARK_DELIVERED_ERR:", e);
          }

          await editMessageSafe(ctx, "✅ Pembayaran berhasil & stok terkirim.", { reply_markup: ctx.state.menu });
        } catch (e) {
          console.error("INVOICE_DELIVERY_ERR:", e);
          await ctx.reply("⚠️ Gagal mengirim dokumen invoice. Coba lagi beberapa saat.");
        }
      }
    } catch (e) {
      console.error("CHECKPAY_ERR:", e);
      await ctx.reply("⚠️ Gagal cek pembayaran. Coba lagi beberapa saat.");
    }
  });

  bot.action("NOP", async (ctx) => ctx.answerCbQuery());
}

async function startCheckoutFlow(ctx, variantId, qty) {
  if (!Number.isFinite(qty) || qty <= 0 || qty > 999) {
    await ctx.reply("❌ Qty tidak valid. Contoh: 3");
    return true;
  }

  if (qty > MAX_QTY) {
    await ctx.reply(`❌ Maksimal qty ${MAX_QTY}.`);
    return true;
  }

  const v = getVariant(variantId);
  if (!v) {
    await ctx.reply("Varian tidak ditemukan. /start");
    return true;
  }

  if (qty > Number(v.stock)) {
    await ctx.reply(`❌ Qty melebihi stok. Stok tersedia: ${v.stock}`);
    return true;
  }

  const ownerT = getTenantByOwner(ctx.from.id);
  const tenantForOrder = Number(ctx.state.tenantId) || (ownerT ? ownerT.id : 0);

  if (tenantNeedsPakasir(tenantForOrder)) {
    await sendPakasirNotSetMessage(ctx, tenantForOrder);
    ctx.session.userState = null;
    ctx.session.buyVariantId = null;
    return true;
  }

  const cfg = getPakasirConfigByTenantId(tenantForOrder);
  if (!cfg?.slug || !cfg?.apiKey) {
    await ctx.reply("Pakasir belum dikonfigurasi.");
    return true;
  }

  const total = qty * Number(v.price);
  const orderId = `O${Date.now().toString(36)}`.toUpperCase();
  const tenantId = tenantForOrder;

  try {
    createOrder({
      tenantId: tenantId,
      userId: ctx.from.id,
      kind: "PRODUCT",
      variantId: variantId,
      qty: qty,
      orderId: orderId,
      amount: total,
      total: total
    });
  } catch (createErr) {
    console.error("❌ CREATE_ORDER_FAILED:", orderId, "tenant:", tenantId, "error:", createErr.message);
    await ctx.reply(
      `⚠️ GAGAL BUAT ORDER\n\n` +
      `Error: ${createErr.message}\n\n` +
      `Silakan coba lagi atau hubungi admin.`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  ctx.session.userState = "WAIT_PAYMENT_METHOD";
  ctx.session.checkoutData = {
    tenantId,
    variantId: variantId,
    qty,
    orderId,
    amount: total,
    variantName: v.name
  };

  const balance = getBalance(tenantId, ctx.from.id);
  const user = await ctx.db?.prepare(`SELECT bank_id FROM users WHERE id=?`).get(ctx.from.id) || {};

  await ctx.reply(
    `🧾 KONFIRMASI PEMBAYARAN\n\n👤 Nama: ${ctx.from.first_name}\n🆔 User ID: ${ctx.from.id}\n🏦 Bank ID: ${user.bank_id || "-"}\n\n💰 Saldo: Rp${balance.toLocaleString("id-ID")}\n💵 Total: Rp${total.toLocaleString("id-ID")}\n\nPilih metode pembayaran:`,
    {
      reply_markup: Markup.keyboard([["💰 Pakai Saldo BOT"], ["📲 QRIS Pakasir"], ["❌ Batal"]]).resize(),
    }
  );

  return true;
}

function monthsFromPlan(orderId) {
  // orderId: RENT-userid-timestamp, months stored in rents; we’ll read months from rent table in admin step later.
  // For now, activation uses rents.months via activateRent(orderId, months) already passed in, but we re-activate safely:
  return 1;
}

export async function handleUserText(ctx) {
  // tenant panel text flow
  if (ctx.session?.tenantState === "SET_PAKASIR") {
    const tenant = getTenantByOwner(ctx.from.id);
    if (!tenant) {
      ctx.session.tenantState = null;
      await ctx.reply("❌ Tenant tidak ditemukan.");
      return true;
    }

    const parts = String(ctx.message?.text || "").split("|").map((x) => x.trim());
    const [slug, key, qris] = parts;
    if (!slug || !key) {
      await ctx.reply("❌ Format salah.\nFormat: slug | api_key | qris_only(1/0)");
      return true;
    }

    setTenantPakasir(tenant.id, slug, key, qris === "1");
    ctx.session.tenantState = null;
    await ctx.reply("✅ Pakasir toko berhasil disimpan.");
    return true;
  }


  const state = ctx.session?.userState;
  if (state !== "WAIT_QTY" && state !== "PICK_QTY_INLINE") return false;

  const qty = Number(String(ctx.message?.text || "").trim());
  if (!Number.isFinite(qty)) {
    await ctx.reply("❌ Qty tidak valid. Contoh: 3");
    return true;
  }

  const vid = Number(ctx.session.buyVariantId);
  ctx.session.userState = null;
  ctx.session.buyVariantId = null;

  if (!vid) {
    await ctx.reply("❌ Pilih varian terlebih dahulu.");
    return true;
  }

  await startCheckoutFlow(ctx, vid, qty);
  return true;
}

export async function handleUserDocument(ctx) {
  // handle tenant-related document uploads (welcome media or logo)
  const state = ctx.session?.tenantState;
  if (!state) return false;

  const tenant = getTenantByOwner(ctx.from.id);
  if (!tenant) {
    ctx.session.tenantState = null;
    await ctx.reply('❌ Tenant tidak ditemukan.');
    return true;
  }

  const fileId = ctx.message?.document?.file_id;
  if (!fileId) {
    await ctx.reply('❌ Tidak ada dokumen ditemukan.');
    return true;
  }

  if (state === 'SET_WELCOME_MEDIA') {
    await setTenantWelcome(tenant.id, 'document', fileId);
    ctx.session.tenantState = null;
    await ctx.reply('✅ Welcome media disimpan. Ketik /start untuk preview.');
    return true;
  }

  if (state === 'SET_LOGO') {
    await setTenantLogo(tenant.id, fileId);
    ctx.session.tenantState = null;
    await ctx.reply('✅ Logo berhasil diunggah untuk toko.');
    return true;
  }

  return false;
}

export async function handleUserMedia(ctx) {
  const state = ctx.session?.tenantState;
  if (!state) return false;

  const tenant = getTenantByOwner(ctx.from.id);
  if (!tenant) {
    ctx.session.tenantState = null;
    await ctx.reply('❌ Tenant tidak ditemukan.');
    return true;
  }

  let fileId = null;
  if (ctx.message.photo?.length) {
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  } else if (ctx.message.video) {
    fileId = ctx.message.video.file_id;
  }

  if (!fileId) {
    await ctx.reply('❌ Tidak ada media yang dapat diproses.');
    return true;
  }

  if (state === 'SET_WELCOME_MEDIA') {
    const type = ctx.message.photo?.length ? 'photo' : ctx.message.video ? 'video' : 'document';
    await setTenantWelcome(tenant.id, type, fileId);
    ctx.session.tenantState = null;
    await ctx.reply('✅ Welcome media disimpan. Ketik /start untuk preview.');
    return true;
  }

  if (state === 'SET_LOGO') {
    await setTenantLogo(tenant.id, fileId);
    ctx.session.tenantState = null;
    await ctx.reply('✅ Logo berhasil diunggah untuk toko.');
    return true;
  }

  return false;
}