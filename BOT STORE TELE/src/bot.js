import { Telegraf, session, Markup } from "telegraf";
import { initSchema } from "./db/schema.js";
import { upsertUser, getTotalUsers } from "./db/user.js";
import { parseAdminIds } from "./utils/auth.js";
import { mainMenuKeyboard, mainMenuReplyKeyboard } from "./utils/ui.js";
import { mainReplyKeyboard } from "./utils/reply_kb.js";
import { registerUserMenuHears } from "./routes/user_menu_hears.js";
import { registerUserActions, handleUserText, handleUserDocument, handleUserMedia } from "./routes/user.js";
import { registerAdminActions, handleAdminText, handleAdminDocument, handleAdminMedia } from "./routes/admin.js";
import { registerTenantActions, handleTenantText, handleTenantDocument, handleTenantMedia } from "./routes/tenant.js";
import { registerAdminMenuHears } from "./routes/admin_menu_hears.js";
import { registerTenantMenuHears } from "./routes/tenant_menu_hears.js";
import { registerDepositRoutes } from "./routes/deposit.js";
import { getSetting } from "./db/settings.js";
import { listRecentPending, getOrder, setPaid, markDelivered, listPendingWithExpiry, setExpired, touchRefresh, getTenantStats } from "./db/order.js";
import { listRecentPendingDeposits, getDeposit, markDepositPaid, setPaymentMessage } from "./db/deposit.js";
import { getVariant, getVariantByTenant } from "./db/variant.js";
import { popStockFIFO } from "./db/stock.js";
import { transactionDetail, payUrl } from "./services/pakasir.js";
import { getPakasirConfigByTenantId } from "./services/pakasir_config.js";
import { getUserTenant, setUserTenant, getTenant, getTenantByOwner } from "./db/tenant.js";
import { parseWelcomeValueMedia } from "./utils/welcome.js";
import { sendWelcome } from "./services/welcome_sender.js";
import { addBalance } from "./db/balance.js";
import { buildInvoicePng } from "./services/invoice_image.js";
import { resolveInvoiceLogoBuffer } from "./services/invoice_logo.js";
import { getTenantUserCount } from "./db/tenant_users.js";
import { fmtWIB } from "./utils/times.js";

let BOT_USERNAME = null;

export function getBotUsername() {
  return BOT_USERNAME;
}

export function startBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const adminSet = parseAdminIds(process.env.ADMIN_IDS);

  bot.use(session());

  // session guard (ANTI ctx.session undefined)
  bot.use((ctx, next) => {
    if (!ctx.session) ctx.session = {};
    return next();
  });

  initSchema();

  // inject user & menu
  bot.use((ctx, next) => {
    if (ctx.from) {
      upsertUser(ctx.from.id, ctx.from.username || "");
      ctx.state.isAdmin = adminSet.has(ctx.from.id);
      const ownerTenant = getTenantByOwner(ctx.from.id);
      ctx.state.isTenantOwner = !!ownerTenant;
      const tid = getUserTenant(ctx.from.id);
      ctx.state.tenantId = Number(tid) || 0;
      // Use centralized reply keyboard builder for consistency
      ctx.state.menu = mainReplyKeyboard({ storeName: "STORE", isAdmin: ctx.state.isAdmin, isTenantOwner: ctx.state.isTenantOwner });
    }
    return next();
  });

  bot.start(async (ctx) => {
    // parse startPayload store_x (kalau ada)
    const payload = ctx.startPayload || "";
    const m = String(payload).match(/^store_(\d+)$/);

    if (m) {
      ctx.state.tenantId = Number(m[1]);
    }
    const tenantId = Number(ctx.state.tenantId || 0);

    // catat mapping user -> tenant
    setUserTenant(ctx.from.id, tenantId);

    // kirim welcome dengan statistik + WIB + custom media/text
    await sendWelcome(ctx, tenantId);

    // lalu kirim reply keyboard dengan placeholder store name
    const t = tenantId > 0 ? getTenant(tenantId) : null;
    const storeName = t?.name || "STORE ADMIN";
    const kb = mainReplyKeyboard({ storeName, isAdmin: ctx.state.isAdmin, isTenantOwner: ctx.state.isTenantOwner });
    ctx.state.menu = kb;
    await ctx.reply(`🏪 ${storeName}\nPilih menu di bawah:`, kb);
  });


  // ACTION routes only
  registerUserActions(bot, adminSet);
  registerUserMenuHears(bot);
  registerAdminActions(bot, adminSet);
  registerAdminMenuHears(bot, adminSet);
  registerTenantActions(bot);
  registerTenantMenuHears(bot);
  registerDepositRoutes(bot);

  // SINGLE TEXT HANDLER (no bentrok)
  bot.on("text", async (ctx) => {
    try {
      // admin flow has priority when adminState exists
      const handledAdmin = await handleAdminText(ctx, adminSet);
      if (handledAdmin) return;

      const handledTenant = await handleTenantText(ctx);
      if (handledTenant) return;

      const handledUser = await handleUserText(ctx);
      if (handledUser) return;

      await ctx.reply("Ketik /start untuk membuka menu.");
    } catch (e) {
      console.error("TEXT_HANDLER_ERR:", e);
      await ctx.reply("⚠️ Terjadi error. Coba lagi /start.");
    }
  });

  // SINGLE MEDIA/DOCUMENT HANDLER (photo/video/document)
  bot.on(["photo", "video", "document"], async (ctx) => {
    try {
      // Tenant media (welcome / broadcast)
      const handledTenantMedia = await handleTenantMedia(ctx);
      if (handledTenantMedia) return;

      // If document, allow tenant document handler (e.g. stock .txt)
      if (ctx.message?.document) {
        const handledTenantDoc = await handleTenantDocument(ctx);
        if (handledTenantDoc) return;
      }

      // Admin handlers
      const handledAdminMedia = await handleAdminMedia(ctx, adminSet);
      if (handledAdminMedia) return;
      if (ctx.message?.document) {
        const handledAdminDoc = await handleAdminDocument(ctx, adminSet);
        if (handledAdminDoc) return;
      }

      // User handlers
      if (ctx.message?.document) {
        const handledUserDoc = await handleUserDocument(ctx);
        if (handledUserDoc) return;
      } else {
        const handledUserMedia = await handleUserMedia(ctx);
        if (handledUserMedia) return;
      }

      await ctx.reply("Ketik /start untuk membuka menu.");
    } catch (e) {
      console.error("MEDIA_HANDLER_ERR:", e);
      await ctx.reply("⚠️ Error media. Coba lagi.");
    }
  });

  bot.telegram.getMe()
    .then((me) => {
      BOT_USERNAME = me.username; // tanpa @
      console.log("✅ BOT USERNAME:", BOT_USERNAME);
    })
    .catch((e) => console.error("❌ getMe failed:", e));

  bot.launch();
  console.log("🤖 Bot running...");

  // small worker: auto-check recent pending payments and process completed ones
  const AUTO_CHECK_INTERVAL_MS = Number(process.env.AUTO_CHECK_INTERVAL_MS || 30000);

  function pakasirCfg() {
    const slug = process.env.PAKASIR_SLUG;
    const apiKey = process.env.PAKASIR_API_KEY;
    if (!slug || !apiKey) return null;
    return { slug, apiKey };
  }

  async function autoCheckWorker(bot) {
    // batasi pengecekan agar tidak membebani server
    const pendings = listRecentPending(15, 45);

    for (const o of pendings) {
      try {
        // resolve pakasir config from the order's tenant_id (order is source of truth)
        const cfgOrder = getPakasirConfigByTenantId(o.tenant_id || 0);
        if (!cfgOrder?.slug || !cfgOrder?.apiKey) continue;

        const detail = await transactionDetail({ slug: cfgOrder.slug, apiKey: cfgOrder.apiKey, amount: o.amount, orderId: o.order_id });

        // If detail is null (404), payment not yet recorded by Pakasir API - skip for now
        if (!detail) continue;

        const tx = detail?.transaction || detail?.payment || detail?.data || null;
        const status = String(tx?.status || "").toLowerCase();

        if (status !== "completed") continue;

        // mark paid
        setPaid(o.order_id);

        // detect rent by rents table as fallback in case kind was mis-saved
        const rentRow = (() => { try { const { getRent } = require('./db/rent.js'); return getRent(o.order_id); } catch { return null; } })();
        if (o.kind === "RENT" || rentRow) {
          // activate rent if possible
          try {
            const { activateRent } = require('./db/rent.js');
            activateRent(o.order_id, rentRow?.months ?? 1);
          } catch (e) {
            // ignore activation errors here
          }
          await bot.telegram.sendMessage(o.user_id, `✅ Pembayaran sewa terkonfirmasi.\nInvoice: ${o.order_id}`);
          continue;
        }

        // product: kirim stok jika belum delivered
        const orderLatest = getOrder(o.order_id);
        if (orderLatest?.delivered_at) continue;

        const items = popStockFIFO(o.tenant_id, o.variant_id, o.qty, o.order_id);
        if (!items) {
          await bot.telegram.sendMessage(o.user_id, `⚠️ Invoice PAID tapi stok tidak cukup.\nInvoice: ${o.order_id}\nHubungi admin.`);
          continue;
        }

        const v = getVariantByTenant(o.tenant_id, o.variant_id);
        
        // Delete QRIS payment message if exists
        if (o.pay_msg_chat_id && o.pay_msg_id) {
          try {
            await bot.telegram.deleteMessage(o.pay_msg_chat_id, o.pay_msg_id);
          } catch (e) {
            // Message might already be deleted, ignore
          }
        }

        // Send invoice PNG
        try {
          const logoBuffer = await resolveInvoiceLogoBuffer(bot.telegram, o.tenant_id || 0);
          
          const invoicePng = await buildInvoicePng({
            title: "✅ INVOICE TERBAYAR",
            orderId: o.order_id,
            lines: [
              `Produk: ${v?.name || "-"}`,
              `Qty: ${o.qty}`,
              `Total: Rp${o.total.toLocaleString("id-ID")}`
            ],
            totalText: `Total: Rp${o.total.toLocaleString("id-ID")}`,
            storeName: getTenant(o.tenant_id)?.name || "",
            logoBuffer: logoBuffer || null
          });
          
          await bot.telegram.sendPhoto(
            o.user_id,
            { source: invoicePng },
            { caption: `✅ INVOICE TERBAYAR\n\nProduk: ${v?.name || "-"}\nQty: ${o.qty}\nInvoice: ${o.order_id}` }
          );
        } catch (e) {
          console.error("INVOICE_PNG_ERR:", o.order_id, e?.message);
        }

        // Send stok file
        const buffer = Buffer.from(items.join("\n"), "utf-8");
        await bot.telegram.sendDocument(
          o.user_id,
          { source: buffer, filename: `stok_${o.order_id}.txt` },
          { caption: `✅ Stok pesanan Anda\n\nProduk: ${v?.name || "-"}\nQty: ${o.qty}\nInvoice: ${o.order_id}` }
        );

        markDelivered(o.order_id, o.qty);
      } catch (e) {
        // jangan crash: cukup log
        console.error("AUTO_CHECK_ERR:", o.order_id, e?.message || e);
      }
    }
  }

  // auto-check setiap 90 detik (ringan)
  setInterval(() => {
    autoCheckWorker(bot).catch((e) => console.error("WORKER_ERR:", e));
  }, Number(process.env.AUTO_CHECK_MS || 90_000));

  // auto-check deposits: verify payment status and add balance automatically
  async function autoDepositCheckWorker(bot) {
    // batasi pengecekan agar tidak membebani server
    const pendings = listRecentPendingDeposits(15, 45);

    for (const dep of pendings) {
      try {
        // resolve pakasir config from the deposit's tenant_id
        const cfgDep = getPakasirConfigByTenantId(dep.tenant_id || 0);
        if (!cfgDep?.slug || !cfgDep?.apiKey) continue;

        const detail = await transactionDetail({
          slug: cfgDep.slug,
          apiKey: cfgDep.apiKey,
          amount: dep.amount,
          orderId: dep.order_id
        });

        // If detail is null (404), payment not yet recorded by Pakasir API - skip for now
        if (!detail) continue;

        const tx = detail?.transaction || detail?.payment || detail?.data || null;
        const status = String(tx?.status || "").toLowerCase();

        if (status !== "completed") continue;

        // Payment confirmed - mark as paid FIRST, then add balance
        markDepositPaid(dep.order_id);

        // SECURITY: verify status before adding balance
        const updated = getDeposit(dep.order_id);
        if (updated?.status !== "PAID") {
          throw new Error("DEPOSIT_STATUS_MISMATCH");
        }

        addBalance(dep.tenant_id, dep.user_id, dep.amount);

        // Delete QRIS payment message if exists
        if (dep.pay_msg_chat_id && dep.pay_msg_id) {
          try {
            await bot.telegram.deleteMessage(dep.pay_msg_chat_id, dep.pay_msg_id);
          } catch (e) {
            // Message might already be deleted, ignore
          }
        }

        // Send invoice PNG
        try {
          const logoBuffer = await resolveInvoiceLogoBuffer(bot.telegram, dep.tenant_id || 0);
          
          const invoicePng = await buildInvoicePng({
            title: "✅ DEPOSIT BERHASIL",
            orderId: dep.order_id,
            lines: [
              `Nominal Deposit: Rp${dep.amount.toLocaleString("id-ID")}`,
              `Saldo Ditambah`,
              `Status: Terbayar`
            ],
            totalText: `Nominal: Rp${dep.amount.toLocaleString("id-ID")}`,
            storeName: getTenant(dep.tenant_id)?.name || "",
            logoBuffer: logoBuffer || null
          });
          
          await bot.telegram.sendPhoto(
            dep.user_id,
            { source: invoicePng },
            { caption: `✅ DEPOSIT BERHASIL\n\nNominal: Rp${dep.amount.toLocaleString("id-ID")}\nSaldo sudah bertambah!\n\nInvoice: ${dep.order_id}` }
          );
        } catch (e) {
          console.error("DEPOSIT_INVOICE_PNG_ERR:", dep.order_id, e?.message);
        }

        // Notify user of successful deposit
        await bot.telegram.sendMessage(
          dep.user_id,
          `✅ DEPOSIT BERHASIL\n\nNominal: Rp${dep.amount.toLocaleString("id-ID")}\nSaldo sudah bertambah!`,
          Markup.keyboard([["💰 Cek Saldo"]]).resize()
        );
      } catch (e) {
        // jangan crash: cukup log
        console.error("AUTO_DEPOSIT_CHECK_ERR:", dep.order_id, e?.message || e);
      }
    }
  }

  // auto-check deposits setiap 60 detik (ringan)
  setInterval(() => {
    autoDepositCheckWorker(bot).catch((e) => console.error("DEPOSIT_WORKER_ERR:", e));
  }, Number(process.env.AUTO_DEPOSIT_CHECK_MS || 60_000));

  // payment expiry worker: delete expired messages, update countdown
  async function paymentExpiryWorker(bot) {
    const cfg = pakasirCfg();
    if (!cfg) return;

    const refreshSec = Number(process.env.PAY_REFRESH_SEC || 20);
    const now = Date.now();

    const rows = listPendingWithExpiry(30);

    for (const o of rows) {
      try {
        if (!o.pay_msg_chat_id || !o.pay_msg_id || !o.expires_at) continue;

        const exp = new Date(o.expires_at).getTime();
        const remainMs = exp - now;

        // expired -> delete message + mark expired + notify user
        if (remainMs <= 0) {
          try { await bot.telegram.deleteMessage(o.pay_msg_chat_id, o.pay_msg_id); } catch {}
          setExpired(o.order_id);
          await bot.telegram.sendMessage(o.user_id, `⌛ Payment Expired\nInvoice: ${o.order_id}\nSilakan buat invoice baru.`);
          continue;
        }

        // refresh countdown caption/text (edit message) tiap refreshSec
        const last = o.last_refresh_at ? new Date(o.last_refresh_at).getTime() : 0;
        if (now - last >= refreshSec * 1000) {
          const mins = Math.floor(remainMs / 60000);
          const secs = Math.floor((remainMs % 60000) / 1000);

          // Update original message text (remove inline keyboard; users use reply keyboard flows)
          await bot.telegram.editMessageText(
            o.pay_msg_chat_id,
            o.pay_msg_id,
            undefined,
            `💳 Pembayaran QRIS\nInvoice: ${o.order_id}\nTotal: Rp ${Number(o.total).toLocaleString("id-ID")}\n\n⏳ Sisa waktu: ${mins}m ${secs}s`
          );

          touchRefresh(o.order_id);
        }
      } catch (e) {
        // jangan crash
        console.error("PAYMENT_EXP_WORKER_ERR:", o.order_id, e?.message || e);
      }
    }
  }

  // payment expiry check setiap 5 detik (ringan)
  setInterval(() => {
    paymentExpiryWorker(bot).catch(e => console.error("PAYMENT_EXP_WORKER_FATAL:", e));
  }, 5000);
}
