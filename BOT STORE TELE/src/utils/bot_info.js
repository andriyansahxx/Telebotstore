import { countUsersByTenant, countTransactionsByTenant, sumQtySoldByTenant } from "../db/stats.js";

export function nowWIBText() {
  const s = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
  return `${s} WIB`;
}

export function buildBotInfoBlock({ tenantId }) {
  const users = countUsersByTenant(tenantId);
  const trx = countTransactionsByTenant(tenantId);
  const qty = sumQtySoldByTenant(tenantId);

  return (
    `\n\n` +
    `📊 *Info Bot*\n` +
    `👥 User: *${users}*\n` +
    `🧾 Total Transaksi: *${trx}*\n` +
    `📦 Qty Terjual: *${qty}*\n` +
    `🕒 Tanggal: *${nowWIBText()}*`
  );
}