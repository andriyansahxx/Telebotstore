import { createCanvas, loadImage } from "@napi-rs/canvas";
import QRCode from "qrcode";

export async function buildInvoicePng({
  title,
  lines = [],
  orderId,
  totalText,
  payUrl,
  expiresText,
  storeName = "",
  logoFileId = null,
  logoBuffer = null,
  productName = "",
  productQty = 0,
  productDetails = "",
  paymentMethod = "QRIS",
  createdAt = null,
  expiredIn = "5 menit",
}) {
  const W = 900, H = 1000; // Tinggi lebih besar untuk info lengkap
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);

  // card
  ctx.fillStyle = "#121c33";
  roundRect(ctx, 30, 30, W - 60, H - 60, 24);
  ctx.fill();

  // header
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 36px Sans";
  ctx.fillText(title || "INVOICE", 60, 100);
  
  // store name (small)
  if (storeName) {
    ctx.font = "20px Sans";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(storeName, 60, 130);
  }
  
  // meta - Invoice ID dan Tanggal
  ctx.font = "18px Sans";
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText(`Invoice: ${orderId}`, 60, 165);
  if (createdAt) {
    ctx.fillText(`Dibuat: ${createdAt}`, 60, 190);
  }
  ctx.fillText(`Expired: ${expiresText || expiredIn}`, 60, 215);

  // ===== PRODUCT DETAILS =====
  let y = 260;
  
  // Produk yang dibeli
  if (productName) {
    ctx.font = "bold 22px Sans";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("📦 PRODUK", 60, y);
    y += 35;
    
    ctx.font = "18px Sans";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(`Nama: ${productName}`, 80, y);
    y += 28;
    ctx.fillText(`Qty: ${productQty} unit`, 80, y);
    y += 28;
    
    if (productDetails) {
      ctx.fillText(`Detail: ${productDetails}`, 80, y);
      y += 28;
    }
    y += 15;
  }

  // Additional info lines
  if (lines.length > 0) {
    ctx.font = "18px Sans";
    ctx.fillStyle = "#e2e8f0";
    for (const ln of lines.slice(0, 3)) {
      ctx.fillText(`• ${ln}`, 60, y);
      y += 30;
    }
    y += 10;
  }

  // ===== PAYMENT INFO =====
  ctx.font = "bold 22px Sans";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("💳 PEMBAYARAN", 60, y);
  y += 35;
  
  ctx.font = "18px Sans";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(`Metode: ${paymentMethod}`, 80, y);
  y += 28;
  
  // ===== TOTAL =====
  y += 15;
  ctx.font = "bold 28px Sans";
  ctx.fillStyle = "#4ade80";
  ctx.fillText(`Total: ${totalText}`, 60, y);

  // QR (generate PNG data url) - lebih kecil
  if (payUrl) {
    try {
      const qrDataUrl = await QRCode.toDataURL(payUrl, { margin: 1, width: 200 });
      const qrImg = await loadImageFromDataUrl(qrDataUrl);
      ctx.drawImage(qrImg, W - 280, H - 280, 220, 220);
      
      ctx.font = "16px Sans";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("Scan untuk bayar", W - 280, H - 50);
    } catch (e) {
      console.error('QR_GENERATION_ERR:', e?.message);
    }
  }

  // logo: try load from buffer first (direct image data)
  if (logoBuffer) {
    try {
      console.log("🎨 INVOICE: Loading logo from buffer", logoBuffer.length, "bytes");
      const logoImg = await loadImage(logoBuffer);
      console.log("✅ INVOICE: Logo image loaded, drawing at top-right");
      // draw logo at top-right inside header box
      const logoW = 100;
      const logoH = 100;
      ctx.drawImage(logoImg, W - 60 - logoW, 40, logoW, logoH);
      console.log("✅ INVOICE: Logo drawn successfully");
    } catch (e) {
      console.error('❌ LOGO_BUFFER_FAIL:', e?.message || e);
    }
  } else {
    console.log("⚠️ INVOICE: No logoBuffer provided");
  }
  // logo: try load from Telegram file if file id provided
  if (logoFileId && process.env.BOT_TOKEN) {
    try {
      const botToken = process.env.BOT_TOKEN;
      const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(logoFileId)}`;
      const gf = await fetch(getFileUrl);
      const gj = await gf.json();
      if (gj && gj.ok && gj.result && gj.result.file_path) {
        const filePath = gj.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
        const logoImg = await loadImageFromUrl(fileUrl);
        // draw logo at top-right inside header box
        const logoW = 100;
        const logoH = 100;
        ctx.drawImage(logoImg, W - 60 - logoW, 40, logoW, logoH);
      }
    } catch (e) {
      // ignore logo errors
      console.error('LOGO_FETCH_FAIL:', e?.message || e);
    }
  }

  return canvas.toBuffer("image/png");
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function loadImageFromDataUrl(dataUrl) {
  // @napi-rs/canvas supports Image via global
  const { Image } = await import("@napi-rs/canvas");
  const img = new Image();
  img.src = Buffer.from(dataUrl.split(",")[1], "base64");
  return img;
}

async function loadImageFromUrl(url) {
  const { Image } = await import("@napi-rs/canvas");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${res.status}`);
  const buf = await res.arrayBuffer();
  const img = new Image();
  img.src = Buffer.from(buf);
  return img;
}