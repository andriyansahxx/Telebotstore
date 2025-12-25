export function rupiah(n) {
  const v = Number(n) || 0;
  return `Rp ${v.toLocaleString("id-ID")}`;
}

export function mainMenuKeyboard(isAdmin, isTenantOwner) {
  // Return a reply keyboard (compat with older callers expecting keyboard object)
  const rows = [
    ["🛍 LIST PRODUK"],
    ["💰 SALDO", "🧾 RIWAYAT"],
    ["💳 Deposit Saldo"],
    ["🤝 SEWA BOT"],
  ];

  if (isTenantOwner) rows.push(["🏪 PANEL TOKO"]);
  if (isAdmin) rows.push(["🛠 ADMIN PANEL"]);

  return { keyboard: rows, resize_keyboard: true };
}

export function mainMenuReplyKeyboard(isAdmin, isTenantOwner) {
  const rows = [
    ["🛍 LIST PRODUK"],
    ["💰 SALDO", "🧾 RIWAYAT"],
    ["💳 Deposit Saldo"],
    ["🤝 SEWA BOT"],
  ];

  if (isTenantOwner) rows.push(["🏪 PANEL TOKO"]);
  if (isAdmin) rows.push(["🛠 ADMIN PANEL"]);

  return { keyboard: rows, resize_keyboard: true };
}

export function splitStockItems(text) {
  return String(text)
    .split(/\s+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}