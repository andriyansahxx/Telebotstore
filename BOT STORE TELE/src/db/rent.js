import { db } from "./index.js";

export function createRent({ userId, plan, months, price, orderId }) {
  db.prepare(`
    INSERT INTO rents(user_id, plan, months, price, order_id, status, ends_at, created_at)
    VALUES (?,?,?,?,?,'PENDING',NULL,?)
  `).run(userId, plan, months, price, orderId, new Date().toISOString());
}

export function activateRent(orderId, months) {
  const ends = new Date();
  ends.setMonth(ends.getMonth() + Number(months));
  db.prepare("UPDATE rents SET status='ACTIVE', ends_at=? WHERE order_id=?").run(ends.toISOString(), orderId);
}

export function getRent(orderId) {
  return db.prepare("SELECT * FROM rents WHERE order_id=?").get(orderId) || null;
}

export function getActiveRentByUser(userId) {
  return db.prepare("SELECT * FROM rents WHERE user_id=? AND status='ACTIVE' ORDER BY ends_at DESC LIMIT 1").get(userId) || null;
}