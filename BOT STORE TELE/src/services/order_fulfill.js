import { popStockFIFO } from "../db/stock.js";
import { setPaid, markDelivered } from "../db/order.js";
import { getVariantByTenant } from "../db/variant.js";
import { buildInvoicePng } from "./invoice_image.js";
import { getTenant } from "../db/tenant.js";
import { resolveInvoiceLogoBuffer } from "./invoice_logo.js";

export async function fulfillOrder(order) {
  // Mark order as paid
  if (order.orderId) {
    setPaid(order.orderId);
  }

  // Pop stock from variant
  if (order.variantId && order.qty) {
    try {
      popStockFIFO(order.variantId, order.qty);
    } catch (e) {
      console.error("STOCK_POP_ERR:", e);
      throw e;
    }
  }

  return true;
}

export async function fulfillProductOrder({ ctx, order }) {
  // order wajib punya: tenant_id, variant_id, qty, order_id, user_id
  try {
    const tenantId = Number(order.tenant_id ?? 0);
    const variantId = Number(order.variant_id);
    const qty = Number(order.qty);
    const orderId = order.order_id;

    if (!orderId || !variantId || !qty) {
      throw new Error("Order data tidak lengkap (order_id, variant_id, qty)");
    }

    // Get variant info untuk display
    const variant = getVariantByTenant(tenantId, variantId);
    if (!variant) {
      throw new Error("Variant tidak ditemukan");
    }

    // Pop stok FIFO sesuai tenant_id dan qty yang diminta
    // Stok HARUS cukup (sudah dicek di route sebelum payment, tapi double-check)
    let items;
    try {
      items = popStockFIFO(tenantId, variantId, qty, orderId);
    } catch (stockErr) {
      console.error("STOCK_POP_ERR:", stockErr.message);
      // Stok tidak cukup - ini error kritis, pembayaran sudah diproses
      await ctx.reply(
        `⚠️ STOK TIDAK CUKUP\n\n` +
        `Invoice: ${orderId}\n` +
        `Produk: ${variant.name}\n` +
        `Diminta: ${qty} unit\n\n` +
        `Pembayaran sudah diproses. ` +
        `Silakan hubungi admin untuk penyesuaian stok atau pengembalian dana.`,
        { parse_mode: "HTML" }
      );
      // Log untuk admin review
      console.warn(`CRITICAL: PAYMENT_STOCK_MISMATCH - Order: ${orderId}, Tenant: ${tenantId}, Variant: ${variantId}, Qty: ${qty}`);
      return false;
    }

    if (!items || items.length === 0) {
      // Jangan pernah sampai sini karena popStockFIFO akan throw
      throw new Error("Stok list kosong setelah pop");
    }

    // Send invoice PNG
    try {
      const createdAtStr = new Date(order.created_at).toLocaleString("id-ID");
      const logoBuffer = await resolveInvoiceLogoBuffer(ctx.telegram, tenantId);
      
      const invoicePng = await buildInvoicePng({
        title: "✅ INVOICE TERBAYAR",
        orderId,
        productName: variant.name,
        productQty: qty,
        productDetails: variant.description || "",
        paymentMethod: "SALDO BOT",
        createdAt: createdAtStr,
        expiredIn: "Pembayaran Selesai",
        lines: [],
        totalText: `Rp${order.total.toLocaleString("id-ID")}`,
        storeName: getTenant(tenantId)?.name || "",
        logoBuffer: logoBuffer || null,
      });
      
      await ctx.replyWithPhoto(
        { source: invoicePng },
        {
          caption:
            `✅ INVOICE TERBAYAR\n\n` +
            `Produk: <b>${variant.name}</b>\n` +
            `Qty: ${qty}\n` +
            `Total: Rp${order.total.toLocaleString("id-ID")}\n` +
            `Invoice: <code>${orderId}</code>`,
          parse_mode: "HTML"
        }
      );
    } catch (e) {
      console.error("FULFILL_INVOICE_PNG_ERR:", orderId, e?.message);
    }

    // Kirim file stok ke user
    const buffer = Buffer.from(items.join("\n"), "utf-8");
    await ctx.replyWithDocument(
      { source: buffer, filename: `stok_${orderId}.txt` },
      {
        caption:
          `✅ STOK PESANAN\n\n` +
          `Produk: <b>${variant.name || "-"}</b>\n` +
          `Qty: ${qty}\n` +
          `Invoice: <code>${orderId}</code>\n\n` +
          `Terima kasih atas pemesanan Anda!`,
        parse_mode: "HTML"
      }
    );

    // Tandai order PAID + DELIVERED
    setPaid(orderId);
    markDelivered(orderId, qty);

    return true;

  } catch (e) {
    console.error("FULFILL_PRODUCT_ERR:", e.message);
    // Notifikasi error ke user
    await ctx.reply(
      `⚠️ GAGAL MEMPROSES PESANAN\n\n` +
      `Error: ${e.message}\n` +
      `Invoice: ${order.order_id || "?"}\n\n` +
      `Silakan hubungi admin untuk bantuan.`,
      { parse_mode: "HTML" }
    );
    return false;
  }
}
