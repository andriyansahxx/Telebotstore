import { getTenantByOwner, setTenantPakasir, setTenantWelcome, setTenantLogo } from "../db/tenant.js";
import { Markup } from "telegraf";
import { createProduct, listProductsPaged, getProduct, updateProductName, deleteProduct, updateProduct, deactivateProduct } from "../db/product.js";
import { createVariant, listVariants, updateVariant, deactivateVariant } from "../db/variant.js";
import { addStock } from "../db/stock.js";
import { getTenantStats } from "../db/order.js";
import { splitStockItems, rupiah } from "../utils/ui.js";
import { getOwnerTenant, tenantHasPakasir } from "../utils/tenant_guard.js";
import { listTenantUserIds, getTenantUserCount } from "../db/tenant_users.js";
import { broadcastSafe } from "../services/broadcast.js";
import { getActiveRentByUser } from "../db/rent.js";
import { fmtWIB, remainingWIB } from "../utils/times.js";
import { makeWelcomeValueMedia, parseWelcomeValueMedia } from "../utils/welcome.js";
import { getBotUsername } from "../bot.js";
import { editOrReply } from "../utils/edit_or_reply.js";

const PAGE_SIZE = 10;

// Exportable factory so hears can reuse tenant home handler
export function makeTenantHomeHandler() {
  return async function tenantHome(ctx) {
    const t = mustOwner(ctx);
    if (!t) return ctx.answerCbQuery("Kamu belum punya toko.");

    ctx.session = ctx.session || {};
    ctx.session.tenantState = null;
    ctx.session.tenantProductId = null;
    ctx.session.tenantVariantId = null;

    const pakasirStatus = tenantHasPakasir(t) ? "✅ Sudah diset" : "⚠️ BELUM diset";
    const rent = getActiveRentByUser(ctx.from.id);
    const sewaText = rent
      ? `⏳ Sisa sewa: ${remainingWIB(rent.ends_at)}\n📅 Berakhir: ${fmtWIB(rent.ends_at)}`
      : "⏳ Sisa sewa: -";

    const homeText = `🏪 PANEL TOKO\n\nNama: ${t.name}\nID: ${t.id}\n\n${sewaText}\n\nConfig Pakasir: ${pakasirStatus}`;

    // Get tenant stats
    const tenantUsers = getTenantUserCount(t.id);
    const stats = getTenantStats(t.id);
    const currentDate = fmtWIB(new Date());
    
    const homeTextWithStats = `🏪 PANEL TOKO\n\nNama: ${t.name}\nID: ${t.id}\n\n${sewaText}\n\nConfig Pakasir: ${pakasirStatus}\n\n📊 Info Toko:\n👥 User: ${tenantUsers}\n📦 Transaksi: ${stats.total_orders}\n💰 Revenue: Rp${stats.total_revenue.toLocaleString('id-ID')}\n📅 ${currentDate}`;

    const kb = [
      [{ text: "📦 Produk Toko", callback_data: "T_PRODUCTS:1" }],
      [{ text: "➕ Tambah Produk", callback_data: "T_ADD_PRODUCT" }],
      [{ text: "📊 Statistik", callback_data: "T_STATS" }],
      [{ text: "🔗 Link Toko", callback_data: "T_VIEW_LINK" }],
      [{ text: "📣 Broadcast", callback_data: "T_BC" }],
      [{ text: "👋 Set Welcome", callback_data: "T_WELCOME" }],
      [{ text: "🖼 Set Logo Invoice", callback_data: "T_SET_LOGO" }],
      [{ text: "🔍 Info Pakasir", callback_data: "T_VIEW_PAKASIR" }, { text: "🔑 Set Pakasir", callback_data: "T_SET_PAKASIR" }],
      [{ text: "⬅️ Menu", callback_data: "BACK_MENU" }],
    ];
    try {
      if (ctx.updateType === 'callback_query') {
        try { await safeEdit(ctx, homeTextWithStats); } catch {}
        await ctx.reply(homeTextWithStats, Markup.inlineKeyboard(kb));
      } else {
        await ctx.reply(homeTextWithStats, Markup.inlineKeyboard(kb));
      }
    } catch {
      await ctx.reply(homeTextWithStats);
    }
  };
}

function mustOwner(ctx) {
  const t = getOwnerTenant(ctx);
  return t;
}

async function safeEdit(ctx, text, opts) {
  try {
    // Check if message has text (not just photo/document)
    if (ctx.callbackQuery?.message?.photo || ctx.callbackQuery?.message?.document) {
      // Use editMessageCaption for photo/document messages
      await ctx.editMessageCaption(text, opts);
    } else {
      // Use editMessageText for text messages
      await ctx.editMessageText(text, opts);
    }
  } catch (e) {
    const desc = e?.response?.description || e?.description || "";
    if (String(desc).includes("message is not modified")) {
      try { await ctx.answerCbQuery(); } catch {}
      return;
    }
    throw e;
  }
}

async function requirePakasirOrWarn(ctx, t) {
  // hanya untuk penyewa (tenantId > 0). Toko utama/admin tidak pakai panel ini.
  if (tenantHasPakasir(t)) return true;

  const text =
`⚠️ Payment gateway belum diset.

Agar toko bisa dipakai jualan, kamu WAJIB set Pakasir dulu:
• slug
• api key
• mode QRIS

Klik tombol di bawah untuk set sekarang.`;

  // kalau datang dari callback -> edit; kalau dari text -> reply
  try {
    const rows = [["🔑 Set Pakasir Sekarang"], ["⬅️ Panel Toko"]];
    if (ctx.updateType === "callback_query") {
      try { await safeEdit(ctx, text); } catch {}
      await ctx.reply(text, Markup.keyboard(rows).resize());
    } else {
      await ctx.reply(text, Markup.keyboard(rows).resize());
    }
  } catch {
    await ctx.reply(text);
  }

  return false;
}

export function registerTenantActions(bot) {
  // HOME
  // HOME (uses exported `makeTenantHomeHandler` factory above)

  // register action using factory
  bot.action("T_HOME", makeTenantHomeHandler());

  // BROADCAST TENANT (menu)
  bot.action("T_BC", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = null;

    const rows2 = [["📝 Broadcast Text"], ["🖼/🎥/📄 Broadcast Media"], ["⬅️ Panel Toko"]];
    try {
      if (ctx.updateType === 'callback_query') {
        try { await safeEdit(ctx, "📣 BROADCAST TENANT\n\nPilih tipe:"); } catch {}
        await ctx.reply("📣 BROADCAST TENANT\n\nPilih tipe:", Markup.keyboard(rows2).resize());
      } else {
        await ctx.reply("📣 BROADCAST TENANT\n\nPilih tipe:", Markup.keyboard(rows2).resize());
      }
    } catch {
      await ctx.reply("📣 BROADCAST TENANT\n\nPilih tipe:");
    }
  });

  // STATISTIK TOKO (tenant)
  bot.action("T_STATS", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    try {
      const stats = getTenantStats(t.id);
      
      const statsText = `📊 STATISTIK TOKO ${t.name}\n\n` +
        `📦 Total Pesanan: ${stats.total_orders}\n` +
        `✅ Pesanan Terbayar: ${stats.total_paid}\n` +
        `⏳ Pesanan Pending: ${stats.pending_count}\n` +
        `💰 Total Revenue: Rp${stats.total_revenue.toLocaleString("id-ID")}`;

        const buttons = [
          [{ text: "🔄 Refresh", callback_data: "T_STATS" }],
          [{ text: "⬅️ Panel Toko", callback_data: "T_HOME" }]
        ];
        try {
          if (ctx.updateType === 'callback_query') {
            try { await safeEdit(ctx, statsText); } catch {}
            await ctx.reply(statsText, Markup.inlineKeyboard(buttons));
          } else {
            await ctx.reply(statsText, Markup.inlineKeyboard(buttons));
          }
        } catch {
          await ctx.reply(statsText);
        }
    } catch (e) {
      console.error("T_STATS_ERR:", e?.message);
        try { await safeEdit(ctx, "⚠️ Error mengambil statistik"); } catch {}
        const buttons = [[{ text: "⬅️ Panel Toko", callback_data: "T_HOME" }]];
        await ctx.reply("⚠️ Error mengambil statistik", Markup.inlineKeyboard(buttons));
    }
  });

  // VIEW LINK TOKO (tenant)
  bot.action("T_VIEW_LINK", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const botUsername = getBotUsername();
    if (!botUsername) {
      try { await safeEdit(ctx, "⚠️ Bot username belum siap. Coba lagi beberapa detik."); } catch {}
      await ctx.reply("⚠️ Bot username belum siap. Coba lagi beberapa detik.", Markup.keyboard([["⬅️ Panel Toko"]]).resize());
      return;
    }

    const storeLink = `https://t.me/${botUsername}?start=store_${t.id}`;
    const linkText = `🔗 LINK TOKO\n\n` +
      `Nama: ${t.name}\n` +
      `ID: ${t.id}\n\n` +
      `Link: ${storeLink}\n\n` +
      `Bagikan link ini ke customer untuk membuka toko Anda!`;

    const buttons = [
      [{ text: "📋 Salin Link", callback_data: "T_COPY_LINK" }],
      [{ text: "🔄 Refresh", callback_data: "T_VIEW_LINK" }],
      [{ text: "⬅️ Panel Toko", callback_data: "T_HOME" }]
    ];
    try {
      if (ctx.updateType === 'callback_query') {
        try { await safeEdit(ctx, linkText); } catch {}
        await ctx.reply(linkText, Markup.inlineKeyboard(buttons));
      } else {
        await ctx.reply(linkText, Markup.inlineKeyboard(buttons));
      }
    } catch {
      await ctx.reply(linkText);
    }
  });

  // BROADCAST TENANT (menu)

  // WELCOME MENU (tenant)
  bot.action("T_WELCOME", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const rows5 = [["📝 Text"], ["🖼 Photo"], ["🎥 Video"], ["📄 Document"], ["⬅️ Panel Toko"]];
    try {
      if (ctx.updateType === 'callback_query') {
        try { await safeEdit(ctx, "👋 SET WELCOME TOKO\nPilih tipe:"); } catch {}
        await ctx.reply("👋 SET WELCOME TOKO\nPilih tipe:", Markup.keyboard(rows5).resize());
      } else {
        await ctx.reply("👋 SET WELCOME TOKO\nPilih tipe:", Markup.keyboard(rows5).resize());
      }
    } catch {
      await ctx.reply("👋 SET WELCOME TOKO\nPilih tipe:");
    }
  });

  bot.action("T_W_TEXT", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_WELCOME_TEXT";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_VIEW_WELCOME" }]];
    await editOrReply(ctx, "📝 Kirim teks welcome toko:", Markup.inlineKeyboard(buttons));
  });

  bot.action("T_W_PHOTO", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_WELCOME_PHOTO";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_VIEW_WELCOME" }]];
    await editOrReply(ctx, "🖼 Kirim foto welcome (caption boleh):", Markup.inlineKeyboard(buttons));
  });

  bot.action("T_W_VIDEO", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_WELCOME_VIDEO";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_VIEW_WELCOME" }]];
    await editOrReply(ctx, "🎥 Kirim video welcome (caption boleh):", Markup.inlineKeyboard(buttons));
  });

  bot.action("T_W_DOC", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_WELCOME_DOC";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_VIEW_WELCOME" }]];
    await editOrReply(ctx, "📄 Kirim document welcome (caption boleh):", Markup.inlineKeyboard(buttons));
  });

  bot.action("T_BC_TEXT", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_BC_TEXT";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_HOME" }]];
    await editOrReply(ctx, "📝 Kirim teks broadcast:", Markup.inlineKeyboard(buttons));
  });

  bot.action("T_BC_MEDIA", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_BC_MEDIA";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_HOME" }]];
    await editOrReply(ctx, "🖼/🎥/📄 Kirim media untuk broadcast (photo/video/document).\nCaption boleh.\n\nCatatan: cukup kirim 1 pesan media.", Markup.inlineKeyboard(buttons));
  });

  // LIST PRODUK
  bot.action(/T_PRODUCTS:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const page = Number(ctx.match[1]) || 1;
    const { rows, pages, total } = listProductsPaged(t.id, page, PAGE_SIZE);

    let text = `📦 PRODUK TOKO\nToko: ${t.name}\nTotal: ${total}\n\n`;
    const buttons = [];

    if (!rows.length) {
      text += "Belum ada produk.";
    } else {
      for (const p of rows) {
        buttons.push([{ text: p.name, callback_data: `T_PRODUCT:${p.id}` }]);
      }
    }

    const nav = [];
    if (page > 1) nav.push({ text: "⬅️", callback_data: `T_PRODUCTS:${page - 1}` });
    nav.push({ text: `${page}/${pages}`, callback_data: "NOP" });
    if (page < pages) nav.push({ text: "➡️", callback_data: `T_PRODUCTS:${page + 1}` });
    buttons.push(nav);

    buttons.push([{ text: "⬅️ Panel Toko", callback_data: "T_HOME" }]);

    try { await safeEdit(ctx, text); } catch {}
    await ctx.reply(text, Markup.inlineKeyboard(buttons));
  });

  // TAMBAH PRODUK
  bot.action("T_ADD_PRODUCT", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    if (!(await requirePakasirOrWarn(ctx, t))) return;

    ctx.session.tenantState = "T_WAIT_PRODUCT_NAME";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_HOME" }]];
    await editOrReply(ctx, "➕ Kirim nama produk:", Markup.inlineKeyboard(buttons));
  });

  // DETAIL PRODUK -> VARIAN
  bot.action(/T_PRODUCT:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const productId = Number(ctx.match[1]);
    const prod = getProduct(t.id, productId);
    if (!prod) {
      try { await safeEdit(ctx, "Produk tidak ditemukan."); } catch {}
      await ctx.reply("Produk tidak ditemukan.", Markup.keyboard([["⬅️"]]).resize());
      return;
    }

    ctx.session.tenantProductId = productId;

    const vars = listVariants(productId, t.id);

    let text = `🧾 VARIAN\nProduk: ${prod.name}\n\n`;
    const buttons = [];

    if (!vars.length) {
      text += "Belum ada varian.";
    } else {
      for (const v of vars) {
        text += `• ${v.name} — ${rupiah(v.price)} (stok: ${v.stock})\n`;
        buttons.push([
          { text: `📥 Stok`, callback_data: `T_UPLOAD:${v.id}` },
          { text: `✏️ Edit`, callback_data: `T_EDIT_VARIANT:${v.id}` },
          { text: `🗑 Hapus`, callback_data: `T_DEL_VARIANT:${v.id}` },
        ]);
      }
    }

    buttons.push([{ text: "➕ Tambah Varian", callback_data: "T_ADD_VARIANT" }]);
    buttons.unshift([
      { text: "✏️ Edit Produk", callback_data: `T_EDIT_PRODUCT:${productId}` },
      { text: "🗑 Hapus Produk", callback_data: `T_DEL_PRODUCT:${productId}` }
    ]);
    buttons.push([{ text: "⬅️ Produk Toko", callback_data: "T_PRODUCTS:1" }]);

    await editOrReply(ctx, text, Markup.inlineKeyboard(buttons));
  });

  // TAMBAH VARIAN
  bot.action("T_ADD_VARIANT", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    if (!(await requirePakasirOrWarn(ctx, t))) return;

    if (!ctx.session.tenantProductId) {
      return ctx.answerCbQuery("Pilih produk dulu.");
    }

    ctx.session.tenantState = "T_WAIT_VARIANT";
    const buttons = [[{ text: "❌ Batal", callback_data: `T_PRODUCT:${ctx.session.tenantProductId}` }]];
    await editOrReply(ctx, "➕ Kirim format:\nNama Varian | Harga\nContoh:\nPremium | 15000", Markup.inlineKeyboard(buttons));
  });

  // UPLOAD STOK
  bot.action(/T_UPLOAD:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    if (!(await requirePakasirOrWarn(ctx, t))) return;

    ctx.session.tenantVariantId = Number(ctx.match[1]);
    ctx.session.tenantState = "T_WAIT_STOCK_TXT";
    const buttons = [[{ text: "❌ Batal", callback_data: `T_PRODUCT:${ctx.session.tenantProductId}` }]];
    await editOrReply(ctx, "📥 Kirim file .txt stok (Document)\n• dipisah spasi/enter/tab\n• maks 1MB", Markup.inlineKeyboard(buttons));
  });

  // SET PAKASIR
  bot.action("T_SET_PAKASIR", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_PAKASIR";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_VIEW_PAKASIR" }]];
    await editOrReply(ctx, "🔑 Set Pakasir Toko\n\nKirim format:\nslug | api_key | qris_only(1/0)\n\nContoh:\nmyslug | myapikey | 1", Markup.inlineKeyboard(buttons));
  });

  // SET LOGO INVOICE
  bot.action("T_SET_LOGO", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_LOGO";
    const buttons = [[{ text: "❌ Batal", callback_data: "T_VIEW_PAKASIR" }]];
    await editOrReply(ctx, "🖼 Kirim logo invoice (foto). Disarankan 512x512.\n\nKirim 1 foto saja.", Markup.inlineKeyboard(buttons));
  });

  // EDIT / DELETE PRODUCT
  bot.action(/T_EDIT_PRODUCT:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const pid = Number(ctx.match[1]);
    ctx.session.tenantEditProductId = pid;
    ctx.session.tenantState = "T_WAIT_EDIT_PRODUCT_NAME";
    const buttons = [[{ text: "❌ Batal", callback_data: `T_PRODUCT:${pid}` }]];
    await editOrReply(ctx, "✏️ Kirim nama produk baru:", Markup.inlineKeyboard(buttons));
  });

  bot.action(/T_DEL_PRODUCT:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const pid = Number(ctx.match[1]);
    const buttons = [
      [{ text: "✅ Ya, Hapus", callback_data: `T_DEL_PRODUCT_OK:${pid}` }],
      [{ text: "❌ Batal", callback_data: `T_PRODUCT:${pid}` }],
    ];
    await editOrReply(ctx, "⚠️ Yakin hapus produk ini? (soft delete)", Markup.inlineKeyboard(buttons));
  });

  bot.action(/T_DEL_PRODUCT_OK:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const pid = Number(ctx.match[1]);
    deactivateProduct(t.id, pid);
    const buttons = [[{ text: "📦 Produk Toko", callback_data: "T_PRODUCTS:1" }]];
    await editOrReply(ctx, "✅ Produk berhasil dihapus (nonaktif).", Markup.inlineKeyboard(buttons));
  });

  // EDIT / DELETE VARIANT
  bot.action(/T_EDIT_VARIANT:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const vid = Number(ctx.match[1]);
    ctx.session.tenantEditVariantId = vid;
    ctx.session.tenantState = "T_WAIT_EDIT_VARIANT";
    const buttons = [[{ text: "❌ Batal", callback_data: `T_PRODUCT:${ctx.session.tenantProductId}` }]];
    await editOrReply(ctx, "✏️ Kirim format edit varian:\nNama Varian | Harga\nContoh:\nPremium | 15000", Markup.inlineKeyboard(buttons));
  });

  bot.action(/T_DEL_VARIANT:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const vid = Number(ctx.match[1]);
    const buttons = [
      [{ text: "✅ Ya, Hapus", callback_data: `T_DEL_VARIANT_OK:${vid}` }],
      [{ text: "❌ Batal", callback_data: `T_PRODUCT:${ctx.session.tenantProductId}` }],
    ];
    await editOrReply(ctx, "⚠️ Yakin hapus varian ini? (soft delete)", Markup.inlineKeyboard(buttons));
  });

  bot.action(/T_DEL_VARIANT_OK:(\d+)/, async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    const vid = Number(ctx.match[1]);
    deactivateVariant(t.id, vid);
    const buttons = [[{ text: "🏪 Panel Toko", callback_data: "T_HOME" }]];
    await editOrReply(ctx, "✅ Varian berhasil dihapus (nonaktif).", Markup.inlineKeyboard(buttons));
  });

  // VIEW PAKASIR CONFIG
  bot.action("T_VIEW_PAKASIR", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    if (!tenantHasPakasir(t)) {
      try { await safeEdit(ctx, "⚠️ Pakasir belum diset."); } catch {}
      const buttons = [
        [{ text: "🔑 Set Pakasir", callback_data: "T_SET_PAKASIR" }],
        [{ text: "⬅️ Panel Toko", callback_data: "T_HOME" }]
      ];
      await ctx.reply("⚠️ Pakasir belum diset.", Markup.inlineKeyboard(buttons));
      return;
    }

    // Censor API key: show only first 5 and last 3 characters
    const apiKey = t.pakasir_api_key || "";
    const censoredKey = apiKey.length > 8
      ? `${apiKey.substring(0, 5)}${"*".repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 3)}`
      : "*".repeat(apiKey.length);

    const text = `👁️ CONFIG PAKASIR TOKO

Slug: ${t.pakasir_slug}
API Key: ${censoredKey}
Mode: ${t.qris_only ? "QRIS Only" : "Semua Mode"}`;

    const buttons = [
      [{ text: "🔑 Ubah Pakasir", callback_data: "T_SET_PAKASIR" }],
      [{ text: "⬅️ Panel Toko", callback_data: "T_HOME" }]
    ];
    try { await safeEdit(ctx, text); } catch {}
    await ctx.reply(text, Markup.inlineKeyboard(buttons));
  });

  // SET WELCOME TOKO (text)
  bot.action("T_SET_WELCOME", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = null;
    try { await safeEdit(ctx, "👋 Pilih cara set welcome toko (media bisa ditambah caption):"); } catch {}
    await ctx.reply("👋 Pilih cara set welcome toko (media bisa ditambah caption):", Markup.keyboard([["📝 Teks"], ["🖼️ Foto + Caption"], ["🎥 Video + Caption"], ["⬅️ Panel Toko"]]).resize());
  });

  bot.action("T_WELCOME_TEXT", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_WELCOME_TEXT";
    try { await safeEdit(ctx, "📝 Kirim teks welcome toko:\n\n(Kosongkan caption, atau kirim 'skip' untuk tanpa caption)"); } catch {}
    await ctx.reply("📝 Kirim teks welcome toko:\n\n(Kosongkan caption, atau kirim 'skip' untuk tanpa caption)", Markup.keyboard([["❌ Batal"]]).resize());
  });

  bot.action("T_WELCOME_PHOTO", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_WELCOME_PHOTO";
    try { await safeEdit(ctx, "🖼️ Kirim foto welcome toko:\n\n(Caption akan diminta setelahnya)"); } catch {}
    await ctx.reply("🖼️ Kirim foto welcome toko:\n\n(Caption akan diminta setelahnya)", Markup.keyboard([["❌ Batal"]]).resize());
  });

  bot.action("T_WELCOME_VIDEO", async (ctx) => {
    const t = mustOwner(ctx);
    if (!t) return;

    ctx.session.tenantState = "T_WAIT_WELCOME_VIDEO";
    try { await safeEdit(ctx, "🎥 Kirim video welcome toko:\n\n(Caption akan diminta setelahnya)"); } catch {}
    await ctx.reply("🎥 Kirim video welcome toko:\n\n(Caption akan diminta setelahnya)", Markup.keyboard([["❌ Batal"]]).resize());
  });

  bot.action("NOP", async (ctx) => ctx.answerCbQuery());
  bot.action(/T_WELCOME_ADD_CAPTION:(.+)/, async (ctx) => {
    const action = ctx.match[1];
    const t = mustOwner(ctx);
    if (!t) return;

    if (action === "skip") {
      // Langsung simpan tanpa caption
      const fileId = ctx.session?.welcomeMediaFileId;
      const mediaType = ctx.session?.welcomeMediaType;

      if (!fileId || !mediaType) {
        await ctx.answerCbQuery("❌ Error: media tidak ditemukan");
        return;
      }

      setTenantWelcome(t.id, mediaType, fileId);
      ctx.session.welcomeMediaFileId = null;
      ctx.session.welcomeMediaType = null;
      ctx.session.tenantState = null;

      await ctx.answerCbQuery("✅ Welcome toko berhasil diubah (tanpa caption)");
      await ctx.reply("✅ Welcome toko berhasil diubah (tanpa caption).");
      return;
    }
  });
}

// dipanggil dari handler text pusat
export async function handleTenantText(ctx) {
  const t = mustOwner(ctx);
  if (!t) return false;

  const st = ctx.session?.tenantState;
  if (!st) return false;

  const text = String(ctx.message?.text || "").trim();
  if (!text) return true;

  // jika sedang proses tambah produk/varian tapi pakasir belum diset, hentikan + ingatkan
  if (
    (ctx.session?.tenantState === "T_WAIT_PRODUCT_NAME" ||
     ctx.session?.tenantState === "T_WAIT_VARIANT") &&
    !tenantHasPakasir(t)
  ) {
    ctx.session.tenantState = null;
    await ctx.reply("⚠️ Kamu harus set Pakasir dulu sebelum menambah produk/varian.", Markup.keyboard([["🔑 Set Pakasir Sekarang"]]).resize());
    return true;
  }

  // tambah produk
  if (st === "T_WAIT_PRODUCT_NAME") {
    createProduct(text, t.id);
    ctx.session.tenantState = null;
    await ctx.reply("✅ Produk berhasil ditambahkan.");
    return true;
  }

  // tambah varian
  if (st === "T_WAIT_VARIANT") {
    const [name, priceS] = text.split("|").map((x) => x.trim());
    const price = Number(String(priceS || "").replaceAll(".", "").replaceAll(",", ""));
    if (!name || !Number.isFinite(price) || price <= 0) {
      await ctx.reply("❌ Format salah.\nContoh: Premium | 15000");
      return true;
    }

    createVariant(Number(ctx.session.tenantProductId), name, Math.trunc(price), t.id);
    ctx.session.tenantState = null;
    await ctx.reply("✅ Varian berhasil ditambahkan.");
    return true;
  }

  // broadcast text
  if (st === "T_WAIT_BC_TEXT") {
    const ids = listTenantUserIds(t.id);
    if (!ids.length) {
      ctx.session.tenantState = null;
      await ctx.reply("⚠️ Belum ada user di toko ini (belum ada yang /start lewat link toko).");
      return true;
    }

    const msgText = text;
    ctx.session.tenantState = null;

    await ctx.reply(`📣 Mengirim broadcast ke ${ids.length} user...`);

    const result = await broadcastSafe({
      telegram: ctx.telegram,
      userIds: ids,
      batchSize: Number(process.env.BC_BATCH || 20),
      delayMs: Number(process.env.BC_DELAY || 800),
      sendFn: async (uid) => ctx.telegram.sendMessage(uid, msgText),
    });

    await ctx.reply(`✅ Broadcast selesai.\nSukses: ${result.ok}\nGagal: ${result.fail}`);
    return true;
  }

  // edit product name
  if (st === "T_WAIT_EDIT_PRODUCT_NAME") {
    const pid = Number(ctx.session.tenantEditProductId || ctx.session.tenantEditingProductId);
    if (pid) {
      try {
        updateProduct(ctx.session?.tenant?.id || t.id, pid, text);
      } catch (e) {
        // fallback to legacy update
        try { updateProductName(pid, text); } catch(e){}
      }
    }
    ctx.session.tenantState = null;
    ctx.session.tenantEditProductId = null;
    ctx.session.tenantEditingProductId = null;
    await ctx.reply("✅ Nama produk berhasil diubah.");
    return true;
  }

  // edit variant
  if (st === "T_WAIT_EDIT_VARIANT") {
    const vid = Number(ctx.session.tenantEditVariantId || ctx.session.tenantEditingVariantId);
    const [name, priceS] = text.split("|").map((x) => x.trim());
    const price = Number(String(priceS || "").replaceAll(".", "").replaceAll(",", ""));
    if (!name || !Number.isFinite(price) || price <= 0) {
      await ctx.reply("❌ Format salah. Contoh: Premium | 15000");
      return true;
    }
    if (vid) {
      try {
        updateVariant(t.id, vid, name, Math.trunc(price));
      } catch (e) {
        // fallback to legacy signature
        try { updateVariant(vid, name, Math.trunc(price)); } catch(e){}
      }
    }
    ctx.session.tenantState = null;
    ctx.session.tenantEditVariantId = null;
    ctx.session.tenantEditingVariantId = null;
    await ctx.reply("✅ Varian berhasil diubah.");
    return true;
  }

  // set pakasir
  if (st === "T_WAIT_PAKASIR") {
    const [slug, key, q] = text.split("|").map((x) => x.trim());
    if (!slug || !key) {
      await ctx.reply("❌ Format salah.\nContoh: myslug | myapikey | 1");
      return true;
    }
    setTenantPakasir(t.id, slug, key, q === "1");
    ctx.session.tenantState = null;
    await ctx.reply("✅ Pakasir toko tersimpan.");
    return true;
  }

  // welcome toko
  if (st === "T_WAIT_WELCOME_TEXT") {
    setTenantWelcome(t.id, "text", text);
    ctx.session.tenantState = null;
    await ctx.reply("✅ Welcome toko diubah.");
    return true;
  }

  // welcome caption untuk media (photo/video)
  if (ctx.session?.welcomeMediaFileId && ctx.session?.welcomeMediaType) {
    const fileId = ctx.session.welcomeMediaFileId;
    const mediaType = ctx.session.welcomeMediaType;
    const caption = text === "skip" ? "" : text;

    // Untuk mendukung caption, kita simpan dalam format terpisah
    // Atau kita bisa update DB schema untuk menambah welcome_caption field
    // Untuk sekarang, kita simpan caption dalam welcome_value sebagai JSON
    const value = JSON.stringify({ file_id: fileId, caption });

    setTenantWelcome(t.id, mediaType, value);
    ctx.session.welcomeMediaFileId = null;
    ctx.session.welcomeMediaType = null;
    ctx.session.tenantState = null;

    await ctx.reply(`✅ Welcome toko berhasil diubah dengan caption.`);
    return true;
  }

  return false;
}

// dipanggil dari handler document pusat
export async function handleTenantDocument(ctx) {
  const t = mustOwner(ctx);
  if (!t) return false;

  const st = ctx.session?.tenantState;
  if (st !== "T_WAIT_STOCK_TXT") return false;

  const doc = ctx.message?.document;
  if (!doc) return false;

  const maxBytes = Number(process.env.MAX_TXT_BYTES || 1_000_000);
  const fileName = String(doc.file_name || "").toLowerCase();

  if (!fileName.endsWith(".txt")) {
    await ctx.reply("❌ Harus file .txt");
    return true;
  }
  if (Number(doc.file_size || 0) > maxBytes) {
    await ctx.reply("❌ File terlalu besar (maks 1MB).");
    return true;
  }

  try {
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const res = await fetch(link.href);
    if (!res.ok) throw new Error("download_failed");
    const content = await res.text();

    const items = splitStockItems(content);
    if (!items.length) {
      await ctx.reply("❌ File kosong.");
      return true;
    }

    addStock(Number(ctx.session.tenantVariantId), items, t.id);

    ctx.session.tenantState = null;
    ctx.session.tenantVariantId = null;

    await ctx.reply(`✅ Stok berhasil ditambahkan: ${items.length} item`);
    return true;
  } catch (e) {
    console.error("TENANT_UPLOAD_ERR:", e);
    await ctx.reply("⚠️ Gagal memproses TXT.");
    return true;
  }
}

// dipanggil dari handler media pusat
export async function handleTenantMedia(ctx) {
  const t = mustOwner(ctx);
  if (!t) return false;

  const st = ctx.session?.tenantState;
  if (!st) return false;

  // SET WELCOME MEDIA (photo/video/document)
  if (st === "T_WAIT_LOGO") {
    const t = mustOwner(ctx);
    if (!t) return true;

    if (!ctx.message?.photo?.length) {
      await ctx.reply("❌ Kirim dalam bentuk FOTO.");
      return true;
    }

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    setTenantLogo(t.id, fileId);

    ctx.session.tenantState = null;
    await ctx.reply("✅ Logo invoice toko berhasil disimpan.");
    return true;
  }

  if (st === "T_WAIT_WELCOME_PHOTO" || st === "T_WAIT_WELCOME_VIDEO" || st === "T_WAIT_WELCOME_DOC") {
    const caption = ctx.message?.caption || "";

    let type = null;
    let fileId = null;

    if (st === "T_WAIT_WELCOME_PHOTO" && ctx.message?.photo?.length) {
      type = "photo";
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (st === "T_WAIT_WELCOME_VIDEO" && ctx.message?.video) {
      type = "video";
      fileId = ctx.message.video.file_id;
    } else if (st === "T_WAIT_WELCOME_DOC" && ctx.message?.document) {
      type = "document";
      fileId = ctx.message.document.file_id;
    } else {
      await ctx.reply("❌ Media tidak sesuai tipe yang dipilih.");
      return true;
    }

    setTenantWelcome(t.id, type, makeWelcomeValueMedia(fileId, caption));
    ctx.session.tenantState = null;

    await ctx.reply("✅ Welcome media disimpan.");
    return true;
  }

  // BROADCAST MEDIA (tenant)
  if (st === "T_WAIT_BC_MEDIA") {
    let type = null;
    let fileId = null;
    const caption = ctx.message?.caption || "";

    if (ctx.message?.photo?.length) {
      type = "photo";
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message?.video) {
      type = "video";
      fileId = ctx.message.video.file_id;
    } else if (ctx.message?.document) {
      type = "document";
      fileId = ctx.message.document.file_id;
    } else {
      await ctx.reply("❌ Media tidak sesuai. Kirim photo/video/document untuk broadcast.");
      return true;
    }

    const ids = listTenantUserIds(t.id);
    if (!ids.length) {
      ctx.session.tenantState = null;
      await ctx.reply("⚠️ Belum ada user di toko ini (belum ada yang /start lewat link toko).");
      return true;
    }

    ctx.session.tenantState = null;
    await ctx.reply(`📣 Mengirim broadcast media ke ${ids.length} user...`);

    const result = await broadcastSafe({
      telegram: ctx.telegram,
      userIds: ids,
      batchSize: Number(process.env.BC_BATCH || 20),
      delayMs: Number(process.env.BC_DELAY || 800),
      sendFn: async (uid) => {
        if (type === "photo") return ctx.telegram.sendPhoto(uid, fileId, { caption });
        if (type === "video") return ctx.telegram.sendVideo(uid, fileId, { caption });
        return ctx.telegram.sendDocument(uid, fileId, { caption });
      },
    });

    await ctx.reply(`✅ Broadcast selesai.\nSukses: ${result.ok}\nGagal: ${result.fail}`);
    return true;
  }

  return false;
}

