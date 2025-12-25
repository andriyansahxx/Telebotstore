import { db } from "./index.js";

export function getBotStats() {
  const users = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  const saldo = db.prepare("SELECT COALESCE(SUM(saldo),0) AS s FROM users").get().s;

  const totalOrder = db.prepare("SELECT COUNT(*) AS c FROM orders").get().c;
  const paidOrder = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status='PAID'").get().c;

  const qty = db.prepare(
    "SELECT COALESCE(SUM(delivered_qty),0) AS q FROM orders WHERE status='PAID'"
  ).get().q;

  const omzet = db.prepare(
    "SELECT COALESCE(SUM(total),0) AS t FROM orders WHERE status='PAID'"
  ).get().t;

  return {
    users,
    saldo,
    totalOrder,
    paidOrder,
    qty,
    omzet
  };
}