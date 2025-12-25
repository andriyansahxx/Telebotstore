import { createDeposit, getDeposit, markDepositPaid, setPaymentMessage } from "../db/deposit.js";
import { Markup } from "telegraf";
import { addBalance } from "../db/balance.js";
import { getPakasirConfigByTenantId } from "../services/pakasir_config.js";
import { payUrl, transactionDetail, createQrisTx } from "../services/pakasir.js";
import { makeQrisPngBuffer } from "../services/qris_preview.js";
import { tenantNeedsPakasir } from "../utils/checkout_guard.js";
import { editOrReply } from "../utils/edit_or_reply.js";
import { qrisPreviewUrl } from "../services/qris.js";

export function registerDepositRoutes(bot) {

  bot.action("U_DEPOSIT", async (ctx) => {
    // SECURITY: Check if tenant has Pakasir configured
    const tenantId = ctx.state.tenantId || 0;
    
    if (tenantNeedsPakasir(tenantId)) {
      await editOrReply(ctx, `⚠️ Deposit belum bisa digunakan\n\nToko Anda belum mengatur Pakasir (slug & api key).\n\nSilakan set Pakasir terlebih dahulu sebelum bisa deposit.`, Markup.keyboard([["🔑 Set Pakasir"],["⬅️ Kembali"]]).resize());
      return;
    }

    ctx.session.userState = "WAIT_DEPOSIT_AMOUNT";
    await editOrReply(ctx, "💳 DEPOSIT SALDO\n\nKirim nominal deposit (min 10.000):", Markup.keyboard([["❌ Batal"]]).resize());
  });

  bot.on("text", async (ctx, next) => {
    if (ctx.session?.userState !== "WAIT_DEPOSIT_AMOUNT") return next();

    const amount = Number(ctx.message.text.replace(/\D/g, ""));
    if (amount < 10000) {
      await ctx.reply("❌ Minimal deposit Rp10.000");
      return;
    }

    const orderId = `DEP-${Date.now()}`;
    const tenantId = ctx.state.tenantId || 0;

    // SECURITY: Double-check Pakasir config exists before proceeding
    if (tenantNeedsPakasir(tenantId)) {
      ctx.session.userState = null;
      await ctx.reply(
        `⚠️ Deposit dibatalkan\n\nKonfigurasi Pakasir toko Anda tidak lengkap.\n\nSilakan hubungi admin atau set Pakasir terlebih dahulu.`
      );
      return;
    }

    try {
      const cfg = getPakasirConfigByTenantId(tenantId);
      if (!cfg?.slug || !cfg?.apiKey) {
        throw new Error("Invalid Pakasir config");
      }

      const url = await payUrl({
        slug: cfg.slug,
        apiKey: cfg.apiKey,
        amount,
        orderId
      });

      createDeposit({
        userId: ctx.from.id,
        tenantId,
        orderId,
        amount,
        payUrl: url
      });

      ctx.session.userState = null;

      // Create QRIS transaction via Pakasir API
      let tx, qrString, payUrl2;
      try {
        tx = await createQrisTx({
          slug: cfg.slug,
          apiKey: cfg.apiKey,
          orderId,
          amount
        });
        
        // Extract QR string dari payment_number
        qrString = tx.payment?.payment_number;
        if (!qrString) {
          throw new Error("pakasir_payment_number_missing");
        }
        
        // Juga dapat payment URL untuk tombol bayar
        payUrl2 = payUrl({
          slug: cfg.slug,
          apiKey: cfg.apiKey,
          amount,
          orderId
        });
        
        console.log("✅ DEPOSIT QRIS TX created:", orderId);
      } catch (txErr) {
        console.error("❌ DEPOSIT createQrisTx failed:", txErr.message);
        await ctx.reply(`⚠️ Gagal buat QRIS: ${txErr.message}`);
        return;
      }

      // Render QR string ke PNG
      let pngBuffer;
      try {
        pngBuffer = await makeQrisPngBuffer(qrString);
      } catch (pngErr) {
        console.error("❌ DEPOSIT makeQrisPngBuffer failed:", pngErr.message);
        await ctx.reply(`⚠️ Gagal render QR: ${pngErr.message}`);
        return;
      }

      const expireMin = Number(process.env.PAY_EXPIRE_MIN || 10);
      const expiresAt = new Date(Date.now() + expireMin * 60_000);
      const expiresText = `Expired: ${expiresAt.toLocaleString("id-ID")}`;

      // Send QRIS PNG untuk scanning
      const msg = await ctx.replyWithPhoto({ source: pngBuffer }, { caption: `💳 DEPOSIT SALDO\n\nInvoice: ${orderId}\nNominal: Rp${amount.toLocaleString("id-ID")}\n${expiresText}\n\nScan QRIS untuk bayar.\nPayment akan dicek otomatis setiap beberapa detik.` });
      // Simpan message id untuk tracking otomatis
      setPaymentMessage(orderId, msg.chat.id, msg.message_id, expiresAt.toISOString());

      // send pay URL and reply keyboard (reply keyboard cannot include URL buttons)
      await ctx.reply(`Bayar sekarang: ${payUrl2}`, Markup.keyboard([["❌ Batal"]]).resize());
    } catch (e) {
      console.error("DEPOSIT_AMOUNT_HANDLER_ERR:", e);
      ctx.session.userState = null;
      await ctx.reply("⚠️ Terjadi error saat proses deposit. Silakan coba lagi.");
    }
  });

  // Note: Manual check button removed - payment verification now happens automatically via bot worker
  // See: bot.js autoDepositCheckWorker()
}
