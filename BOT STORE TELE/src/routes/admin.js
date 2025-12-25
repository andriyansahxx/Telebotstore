import { createProduct, listProductsPaged, getProduct, updateProductName, deleteProduct, updateProduct, deactivateProduct } from "../db/product.js";
import { Markup } from "telegraf";
import { editOrReply } from "../utils/edit_or_reply.js";
import { createVariant, listVariants, updateVariant, deactivateVariant } from "../db/variant.js";
import { addStock } from "../db/stock.js";
import { setSetting, getSetting } from "../db/settings.js";
import { addSaldo, subSaldo, allUserIdsBroadcastable } from "../db/user.js";
import { broadcastSafe } from "../services/broadcast.js";
import { splitStockItems, rupiah } from "../utils/ui.js";
import { getBotStats } from "../db/statistic.js";

const PAGE_SIZE = 10;

// Exported factories (top-level) so other modules can import and reuse them
export function makeAdminHomeHandler(adminSet) {
  return async function adminHome(ctx) {
    if (!adminSet.has(ctx.from?.id)) return;

    ctx.session = ctx.session || {};
    ctx.session.adminState = null;
    const buttons = [
      [{ text: "📦 Kelola Produk", callback_data: "A_PRODUCTS:1" }, { text: "➕ Tambah Produk", callback_data: "A_ADD_PRODUCT" }],
      [{ text: "📊 Statistik Bot", callback_data: "A_STATS" }],
      [{ text: "👋 Set Welcome", callback_data: "A_SET_WELCOME" }, { text: "📣 Broadcast", callback_data: "A_BROADCAST" }],
      [{ text: "🖼 Set Logo Invoice (Store)", callback_data: "A_SET_LOGO" }],
      [{ text: "💰 Saldo User", callback_data: "A_BALANCE" }],
      [{ text: "⬅️ Menu", callback_data: "BACK_MENU" }],
    ];
    try {
      await editOrReply(ctx, "🛠 ADMIN PANEL", Markup.inlineKeyboard(buttons));
    } catch {
      await ctx.reply("🛠 ADMIN PANEL");
    }
  };
}

export function makeAdminProductsHandler(adminSet) {
  return async function adminProducts(ctx) {
    if (!adminSet.has(ctx.from?.id)) return;
    try {
      const page = Number(ctx.match?.[1]) || 1;
      const tenantId = Number(ctx.state.tenantId) || 0;
      const { rows, pages, total } = listProductsPaged(tenantId, page, PAGE_SIZE);

      let text = `📦 KELOLA PRODUK\nTotal: ${total}\n\n`;
      // map numbers -> product ids for hears/numeric flow
      const map = rows.map((p, idx) => ({ num: idx + 1, id: p.id, name: p.name }));
      // ensure session object exists then store map
      ctx.session = ctx.session || {};
      ctx.session.adminProductMap = map;

      // build inline keyboard: one button per product (callback -> A_PRODUCT:<id>)
      const buttons = rows.map((p) => [{ text: p.name, callback_data: `A_PRODUCT:${p.id}` }]);
      // navigation row (callbacks to change page)
      const nav = [];
      if (page > 1) nav.push({ text: "⬅️", callback_data: `A_PRODUCTS:${page - 1}` });
      nav.push({ text: `${page}/${pages}`, callback_data: "NOP" });
      if (page < pages) nav.push({ text: "➡️", callback_data: `A_PRODUCTS:${page + 1}` });
      buttons.push(nav.map((b) => b));
      // back button
      buttons.push([{ text: "⬅️ Kembali", callback_data: "A_HOME" }]);

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

export function makeAdminBalanceHandler(adminSet) {
  return async function adminBalance(ctx) {
    if (!adminSet.has(ctx.from?.id)) return;
    const buttons = [
      [{ text: "➕ Tambah Saldo", callback_data: "A_BAL_ADD" }, { text: "➖ Kurangi Saldo", callback_data: "A_BAL_SUB" }],
      [{ text: "⬅️ Kembali", callback_data: "A_HOME" }]
    ];
    await editOrReply(ctx, "💰 SALDO USER\n\nPilih aksi:", Markup.inlineKeyboard(buttons));
  };
}

export function registerAdminActions(bot, adminSet) {
  const ADMIN_TENANT_ID = 0;
  const isAdmin = (ctx) => adminSet.has(ctx.from?.id);

  bot.action("A_HOME", makeAdminHomeHandler(adminSet));

  // factories are declared at module top-level (makeAdminHomeHandler, makeAdminProductsHandler)

  // list products paged (use factory so hears can reuse)
  bot.action(/A_PRODUCTS:(\d+)/, makeAdminProductsHandler(adminSet));

  bot.action("A_ADD_PRODUCT", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "ADD_PRODUCT";
    const buttons = [[{ text: "❌ Batal", callback_data: "A_HOME" }]];
    await editOrReply(ctx, "➕ Kirim nama produk:", Markup.inlineKeyboard(buttons));
  });

  bot.action(/A_PRODUCT:(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    const pid = Number(ctx.match[1]);
    ctx.session.productId = pid;

    const tenantId = Number(ctx.state.tenantId) || 0;
    const prod = getProduct(tenantId, pid);
    if (!prod) {
      await editOrReply(ctx, "Produk tidak ditemukan.", Markup.keyboard([["⬅️"]]).resize());
      return;
    }

    const vars = listVariants(pid, tenantId);
    let text = `🧾 ${prod.name}\n\nVARIAN:\n`;
    const buttons = [];

    if (!vars.length) text += "— belum ada —\n";
    else {
      for (const v of vars) {
        text += `• ${v.name} — ${rupiah(v.price)} (stok: ${v.stock})\n`;
        buttons.push([
          { text: `📥 Stok`, callback_data: `A_UPLOAD:${v.id}` },
          { text: `✏️ Edit Varian`, callback_data: `A_EDIT_VARIANT:${v.id}` },
          { text: `🗑 Hapus Varian`, callback_data: `A_DEL_VARIANT:${v.id}` },
        ]);
      }
    }

    buttons.push([{ text: "➕ Tambah Varian", callback_data: "A_ADD_VARIANT" }]);
    buttons.unshift([
      { text: "✏️ Edit Produk", callback_data: `A_EDIT_PRODUCT:${pid}` },
      { text: "🗑 Hapus Produk", callback_data: `A_DEL_PRODUCT:${pid}` }
    ]);
    buttons.push([{ text: "⬅️ Kembali", callback_data: "A_PRODUCTS:1" }]);
    await editOrReply(ctx, text, Markup.inlineKeyboard(buttons));
  });

  bot.action("A_ADD_VARIANT", async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session.productId) return ctx.answerCbQuery("Pilih produk dulu.");
    ctx.session.adminState = "ADD_VARIANT";
    const buttons = [[{ text: "❌ Batal", callback_data: "A_PRODUCT:" + ctx.session.productId }]];
    await editOrReply(ctx, "➕ Kirim format:\nNama Varian | Harga\nContoh:\nPremium | 15000", Markup.inlineKeyboard(buttons));
  });

  bot.action(/A_UPLOAD:(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.variantId = Number(ctx.match[1]);
    ctx.session.adminState = "UPLOAD_TXT";
    const buttons = [[{ text: "❌ Batal", callback_data: "A_PRODUCT:" + ctx.session.productId }]];
    await editOrReply(ctx, "📥 Kirim file .txt stok (Document)\n• dipisah spasi/enter/tab\n• maks 1MB", Markup.inlineKeyboard(buttons));
  });

  // saldo
  // balance factory is declared at module top-level (makeAdminBalanceHandler)

  bot.action("A_BALANCE", makeAdminBalanceHandler(adminSet));

  bot.action("A_BAL_ADD", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "BAL_ADD";
    const buttons = [[{ text: "❌ Batal", callback_data: "A_BALANCE" }]];
    await editOrReply(ctx, "Kirim format:\nuser_id amount\nContoh:\n123456789 50000", Markup.inlineKeyboard(buttons));
  });

  bot.action("A_BAL_SUB", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "BAL_SUB";
    const buttons = [[{ text: "❌ Batal", callback_data: "A_BALANCE" }]];
    await editOrReply(ctx, "Kirim format:\nuser_id amount\nContoh:\n123456789 10000", Markup.inlineKeyboard(buttons));
  });

  // welcome
  bot.action("A_SET_WELCOME", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "WELCOME_ANY";
    const type = getSetting("admin_welcome_type") || "text";
    const buttons = [[{ text: "❌ Batal", callback_data: "A_HOME" }]];
    await editOrReply(ctx, `👋 Set Welcome\n\nKirim teks / foto / video / dokumen.\nSaat ini: ${type}`, Markup.inlineKeyboard(buttons));
  });

  // set logo invoice (store utama)
  bot.action("A_SET_LOGO", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "A_WAIT_LOGO";
    const buttons = [[{ text: "❌ Batal", callback_data: "A_HOME" }]];
    await editOrReply(ctx, "🖼 Kirim logo invoice untuk STORE UTAMA (foto).", Markup.inlineKeyboard(buttons));
  });

  // broadcast
  bot.action("A_BROADCAST", async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.adminState = "BROADCAST_ANY";
    const buttons = [[{ text: "❌ Batal", callback_data: "A_HOME" }]];
    await editOrReply(ctx, "📣 Broadcast\n\nKirim teks / foto / video / dokumen untuk dikirim ke semua user.", Markup.inlineKeyboard(buttons));
  });

  bot.action("A_CANCEL", async (ctx) => {
    if (!adminSet.has(ctx.from?.id)) return;
    ctx.session.adminState = null;
    ctx.session.variantId = null;
    const buttons = [[{ text: "🛠 Admin Panel", callback_data: "A_HOME" }]];
    await editOrReply(ctx, "❌ Dibatalkan.", Markup.inlineKeyboard(buttons));
  });

  // EDIT / DELETE PRODUCT (admin)
  bot.action(/A_EDIT_PRODUCT:(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;

    const pid = Number(ctx.match[1]);
    ctx.session.adminState = "A_WAIT_EDIT_PRODUCT_NAME";
    ctx.session.adminEditProductId = pid;

    await editOrReply(ctx, "✏️ Kirim nama produk baru:", Markup.keyboard([["❌ Batal"]]).resize());
  });

  bot.action(/A_DEL_PRODUCT:(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;

    const pid = Number(ctx.match[1]);
    const kb3 = [
      [{ text: "✅ Ya, Hapus", callback_data: `A_DEL_PRODUCT_OK:${pid}` }],
      [{ text: "❌ Batal", callback_data: `A_PRODUCT:${pid}` }],
    ];
    const rows4 = kb3.map((r) => r.map((b) => b.text));
    await editOrReply(ctx, "⚠️ Yakin hapus produk ini? (soft delete)", Markup.keyboard(rows4).resize());
  });

  bot.action(/A_DEL_PRODUCT_OK:(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;

    const pid = Number(ctx.match[1]);
    deactivateProduct(ADMIN_TENANT_ID, pid);

    await editOrReply(ctx, "✅ Produk berhasil dihapus (nonaktif).", Markup.keyboard([["📦 List Produk"]]).resize());
  });

  bot.action(/A_EDIT_VARIANT:(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;

    const vid = Number(ctx.match[1]);
    ctx.session.adminState = "A_WAIT_EDIT_VARIANT";
    ctx.session.adminEditVariantId = vid;

    await editOrReply(ctx, "✏️ Kirim format edit varian:\nNama Varian | Harga\nContoh:\nPremium | 15000", Markup.keyboard([["❌ Batal"]]).resize());
  });

  bot.action(/A_DEL_VARIANT:(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;

    const vid = Number(ctx.match[1]);
    const kb4 = [
      [{ text: "✅ Ya, Hapus", callback_data: `A_DEL_VARIANT_OK:${vid}` }],
      [{ text: "❌ Batal", callback_data: "A_HOME" }],
    ];
    const rows5 = kb4.map((r) => r.map((b) => b.text));
    await editOrReply(ctx, "⚠️ Yakin hapus varian ini? (soft delete)", Markup.keyboard(rows5).resize());
  });

  bot.action(/A_DEL_VARIANT_OK:(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;

    const vid = Number(ctx.match[1]);
    deactivateVariant(ADMIN_TENANT_ID, vid);
    await editOrReply(ctx, "✅ Varian berhasil dihapus (nonaktif).", Markup.keyboard([["🛠 Admin Panel"]]).resize());
  });

  bot.action("A_STATS", async (ctx) => {
    if (!adminSet.has(ctx.from.id)) return;

    const s = getBotStats();

    const text =
`📊 STATISTIK BOT

👥 Total User: ${s.users}
💰 Total Saldo User: ${rupiah(s.saldo)}

🧾 Total Transaksi: ${s.totalOrder}
✅ Transaksi PAID: ${s.paidOrder}

📦 Total Qty Terjual: ${s.qty}
💵 Total Omzet: ${rupiah(s.omzet)}
`;

    const buttons = [
      [{ text: "🔄 Refresh", callback_data: "A_STATS" }],
      [{ text: "⬅️ Kembali", callback_data: "A_HOME" }]
    ];
    await editOrReply(ctx, text, Markup.inlineKeyboard(buttons));
  });

  bot.action("NOP", async (ctx) => ctx.answerCbQuery());
}

export async function handleAdminText(ctx, adminSet) {
  if (!adminSet.has(ctx.from?.id)) return false;
  const st = ctx.session?.adminState;
  if (!st) return false;

  const text = String(ctx.message?.text || "").trim();
  if (!text) return true;

  if (st === "ADD_PRODUCT") {
    const tenantId = Number(ctx.state.tenantId) || 0;
    createProduct(text, tenantId);
    ctx.session.adminState = null;
    await ctx.reply("✅ Produk ditambahkan.");
    return true;
  }

  if (st === "ADD_VARIANT") {
    const [name, priceS] = text.split("|").map((x) => x.trim());
    const price = Number(String(priceS || "").replaceAll(".", "").replaceAll(",", ""));
    if (!name || !Number.isFinite(price) || price <= 0) {
      await ctx.reply("❌ Format salah.\nContoh: Premium | 15000");
      return true;
    }
    const tenantId = Number(ctx.state.tenantId) || 0;
    createVariant(ctx.session.productId, name, Math.trunc(price), tenantId);
    ctx.session.adminState = null;
    await ctx.reply("✅ Varian ditambahkan.");
    return true;
  }

  // Admin edit product (A_ flow)
  if (st === "A_WAIT_EDIT_PRODUCT_NAME") {
    const pid = Number(ctx.session.adminEditProductId);
    if (pid) {
      try { updateProduct(0, pid, text); } catch (e) { try { updateProductName(pid, text); } catch(e){} }
    }
    ctx.session.adminState = null;
    ctx.session.adminEditProductId = null;
    await ctx.reply("✅ Nama produk berhasil diubah.");
    return true;
  }

  if (st === "A_WAIT_EDIT_VARIANT") {
    const [name, priceS] = text.split("|").map((x) => x.trim());
    const price = Number(String(priceS || "").replaceAll(".", "").replaceAll(",", ""));
    if (!name || !Number.isFinite(price) || price <= 0) {
      await ctx.reply("❌ Format salah.\nContoh: Premium | 15000");
      return true;
    }
    const vid = Number(ctx.session.adminEditVariantId);
    if (vid) {
      try { updateVariant(0, vid, name, Math.trunc(price)); } catch (e) { try { updateVariant(vid, name, Math.trunc(price)); } catch(e){} }
    }
    ctx.session.adminState = null;
    ctx.session.adminEditVariantId = null;
    await ctx.reply("✅ Varian berhasil diubah.");
    return true;
  }

  if (st === "EDIT_PRODUCT") {
    const pid = Number(ctx.session.adminEditingProductId);
    if (pid) updateProductName(pid, text);
    ctx.session.adminState = null;
    ctx.session.adminEditingProductId = null;
    await ctx.reply("✅ Nama produk diperbarui.");
    return true;
  }

  if (st === "EDIT_VARIANT") {
    const vid = Number(ctx.session.adminEditingVariantId);
    const [name, priceS] = text.split("|").map((x) => x.trim());
    const price = Number(String(priceS || "").replaceAll(".", "").replaceAll(",", ""));
    if (!name || !Number.isFinite(price) || price <= 0) {
      await ctx.reply("❌ Format salah. Contoh: Premium | 15000");
      return true;
    }
    if (vid) updateVariant(vid, name, Math.trunc(price));
    ctx.session.adminState = null;
    ctx.session.adminEditingVariantId = null;
    await ctx.reply("✅ Varian diperbarui.");
    return true;
  }

  if (st === "BAL_ADD" || st === "BAL_SUB") {
    const [uidS, amtS] = text.split(/\s+/);
    const uid = Number(uidS);
    const amt = Number(amtS);
    if (!Number.isFinite(uid) || !Number.isFinite(amt) || amt <= 0) {
      await ctx.reply("❌ Format salah.\nContoh: 123456789 50000");
      return true;
    }
    if (st === "BAL_ADD") addSaldo(uid, Math.trunc(amt));
    else subSaldo(uid, Math.trunc(amt));
    ctx.session.adminState = null;
    await ctx.reply("✅ Saldo diupdate.");
    return true;
  }

  if (st === "WELCOME_ANY") {
    setSetting("admin_welcome_type", "text");
    setSetting("admin_welcome_value", text);
    ctx.session.adminState = null;
    await ctx.reply("✅ Welcome diubah (text).");
    return true;
  }

  if (st === "BROADCAST_ANY") {
    ctx.session.adminState = null;
    const ids = allUserIdsBroadcastable();
    const batch = Number(process.env.BROADCAST_BATCH || 20);
    const delay = Number(process.env.BROADCAST_DELAY_MS || 1200);

    const result = await broadcastSafe({
      telegram: ctx.telegram,
      userIds: ids,
      batchSize: batch,
      delayMs: delay,
      sendFn: (uid) => ctx.telegram.sendMessage(uid, text),
    });

    await ctx.reply(`✅ Broadcast selesai.\nBerhasil: ${result.ok}\nGagal: ${result.fail}`);
    return true;
  }

  return false;
}

export async function handleAdminDocument(ctx, adminSet) {
  if (!adminSet.has(ctx.from?.id)) return false;
  const st = ctx.session?.adminState;
  if (!st) return false;

  const doc = ctx.message?.document;
  if (!doc) return false;

  const maxBytes = Number(process.env.MAX_TXT_BYTES || 1_000_000);

  if (st === "UPLOAD_TXT") {
    const name = String(doc.file_name || "").toLowerCase();
    if (!name.endsWith(".txt")) {
      await ctx.reply("❌ Harus file .txt");
      return true;
    }
    if (Number(doc.file_size || 0) > maxBytes) {
      await ctx.reply(`❌ File terlalu besar. Maks ${maxBytes} bytes`);
      return true;
    }

    try {
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(link.href);
      if (!res.ok) throw new Error("Download failed");

      const content = await res.text();
      const items = splitStockItems(content);
      if (!items.length) {
        await ctx.reply("❌ File kosong.");
        return true;
      }

      const tenantId = Number(ctx.state.tenantId) || 0;
      addStock(Number(ctx.session.variantId), items, tenantId);
      ctx.session.adminState = null;
      ctx.session.variantId = null;

      await ctx.reply(`✅ Stok ditambahkan: ${items.length} item (FIFO)`);
      return true;
    } catch (e) {
      console.error("UPLOAD_TXT_ERR:", e);
      await ctx.reply("⚠️ Gagal memproses TXT.");
      return true;
    }
  }

  if (st === "WELCOME_ANY") {
    const mediaValue = JSON.stringify({ file_id: doc.file_id, caption: doc.caption || "" });
    setSetting("admin_welcome_type", "document");
    setSetting("admin_welcome_value", mediaValue);
    ctx.session.adminState = null;
    await ctx.reply("✅ Welcome diubah (document).");
    return true;
  }

  if (st === "BROADCAST_ANY") {
    ctx.session.adminState = null;
    const ids = allUserIdsBroadcastable();
    const batch = Number(process.env.BROADCAST_BATCH || 20);
    const delay = Number(process.env.BROADCAST_DELAY_MS || 1200);

    const result = await broadcastSafe({
      telegram: ctx.telegram,
      userIds: ids,
      batchSize: batch,
      delayMs: delay,
      sendFn: (uid) => ctx.telegram.sendDocument(uid, doc.file_id, { caption: doc.caption || undefined }),
    });

    await ctx.reply(`✅ Broadcast selesai.\nBerhasil: ${result.ok}\nGagal: ${result.fail}`);
    return true;
  }

  return false;
}

export async function handleAdminMedia(ctx, adminSet) {
  if (!adminSet.has(ctx.from?.id)) return false;
  const st = ctx.session?.adminState;
  if (!st) return false;

  const caption = ctx.message?.caption || "";

  // photo
  if (ctx.message?.photo?.length) {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    if (st === "A_WAIT_LOGO") {
      setSetting("admin_invoice_logo_file_id", fileId);
      ctx.session.adminState = null;
      await ctx.reply("✅ Logo invoice store utama tersimpan.");
      return true;
    }

    if (st === "WELCOME_ANY") {
      const mediaValue = JSON.stringify({ file_id: fileId, caption });
      setSetting("admin_welcome_type", "photo");
      setSetting("admin_welcome_value", mediaValue);
      ctx.session.adminState = null;
      await ctx.reply("✅ Welcome diubah (photo).");
      return true;
    }

    if (st === "BROADCAST_ANY") {
      ctx.session.adminState = null;
      const ids = allUserIdsBroadcastable();
      const batch = Number(process.env.BROADCAST_BATCH || 20);
      const delay = Number(process.env.BROADCAST_DELAY_MS || 1200);

      const result = await broadcastSafe({
        telegram: ctx.telegram,
        userIds: ids,
        batchSize: batch,
        delayMs: delay,
        sendFn: (uid) => ctx.telegram.sendPhoto(uid, fileId, { caption: caption || undefined }),
      });

      await ctx.reply(`✅ Broadcast selesai.\nBerhasil: ${result.ok}\nGagal: ${result.fail}`);
      return true;
    }
  }

  // video
  if (ctx.message?.video) {
    const fileId = ctx.message.video.file_id;

    if (st === "WELCOME_ANY") {
      const mediaValue = JSON.stringify({ file_id: fileId, caption });
      setSetting("admin_welcome_type", "video");
      setSetting("admin_welcome_value", mediaValue);
      ctx.session.adminState = null;
      await ctx.reply("✅ Welcome diubah (video).");
      return true;
    }

    if (st === "BROADCAST_ANY") {
      ctx.session.adminState = null;
      const ids = allUserIdsBroadcastable();
      const batch = Number(process.env.BROADCAST_BATCH || 20);
      const delay = Number(process.env.BROADCAST_DELAY_MS || 1200);

      const result = await broadcastSafe({
        telegram: ctx.telegram,
        userIds: ids,
        batchSize: batch,
        delayMs: delay,
        sendFn: (uid) => ctx.telegram.sendVideo(uid, fileId, { caption: caption || undefined }),
      });

      await ctx.reply(`✅ Broadcast selesai.\nBerhasil: ${result.ok}\nGagal: ${result.fail}`);
      return true;
    }
  }

  return false;
}