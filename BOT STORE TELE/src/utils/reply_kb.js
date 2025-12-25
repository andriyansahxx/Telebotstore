import { Markup } from "telegraf";

export function mainReplyKeyboard({ storeName, isAdmin, isTenantOwner }) {
  // Baris sesuai contoh screenshot: List Product, Saldo, Stock
  const rows = [
    ["📋 List Product", "💰 Saldo", "📦 Stock"],
    ["💳 Deposit Saldo", "🧾 Riwayat Transaksi", "🤝 SEWA BOT"],
    ["✨ Information", "❓ Cara Order"],
  ];

  // Panel toko (owner tenant)
  if (isTenantOwner) rows.push(["🏪 Panel Toko"]);

  // Admin panel
  if (isAdmin) rows.push(["🛠 Admin Panel"]);

  let kb = Markup.keyboard(rows).resize();
  if (typeof kb.persistent === "function") kb = kb.persistent();
  if (typeof kb.inputFieldPlaceholder === "function") kb = kb.inputFieldPlaceholder(storeName);
  return kb;
}

export function numberKeyboard(max = 11, storeName = "STORE") {
  const rows = [];
  let row = [];
  for (let i = 1; i <= max; i++) {
    row.push(String(i));
    if (row.length === 6) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);

  rows.push(["⬅️ Kembali"]);

  let kb = Markup.keyboard(rows).resize();
  if (typeof kb.inputFieldPlaceholder === "function") kb = kb.inputFieldPlaceholder(storeName);
  return kb;
}