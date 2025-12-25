import { db } from "./index.js";

export function createOrder({ tenantId, userId, kind, variantId, qty, orderId, amount, total, payUrl }) {
  // IDEMPOTENCY CHECK: prevent duplicate orders
  const existing = db.prepare("SELECT order_id FROM orders WHERE order_id=?").get(orderId);
  if (existing) {
    console.warn(`ORDER_DUPLICATE_ATTEMPT: ${orderId}`);
    return existing.order_id;
  }

  try {
    db.prepare(`
      INSERT INTO orders(tenant_id, user_id, kind, variant_id, qty, order_id, amount, total, status, created_at, delivered_at, delivered_qty, pay_url)
      VALUES (?,?,?,?,?,?,?,?, 'PENDING', ?, NULL, 0, ?)
    `).run(
      tenantId ?? 0,
      userId,
      kind,
      variantId ?? null,
      qty,
      orderId,
      amount,
      total,
      new Date().toISOString(),
      payUrl || null
    );
    return orderId;
  } catch (e) {
    console.error("CREATE_ORDER_ERR:", e);
    throw e;
  }
}

export function getOrder(orderId) {
  return db.prepare("SELECT * FROM orders WHERE order_id=?").get(orderId) || null;
}

export function setPaid(orderId) {
  db.prepare("UPDATE orders SET status='PAID' WHERE order_id=?").run(orderId);
}

export function markDelivered(orderId, qty) {
  db.prepare("UPDATE orders SET delivered_at=?, delivered_qty=? WHERE order_id=?")
    .run(new Date().toISOString(), Number(qty) || 0, orderId);
}

export function listOrdersPaged(userId, page, pageSize) {
  const total = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE user_id=?").get(userId).c;
  const pages = Math.max(1, Math.ceil(Number(total) / pageSize));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT o.*, v.name AS variant_name
    FROM orders o
    LEFT JOIN variants v ON v.id=o.variant_id
    WHERE o.user_id=?
    ORDER BY o.id DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset);
  return { rows, pages, total: Number(total) };
}

export function listRecentPending(limit = 20, maxAgeMinutes = 30) {
  // ambil PENDING yang masih fresh (anti cek invoice lama)
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  return db.prepare(`
    SELECT * FROM orders
    WHERE status='PENDING' AND created_at >= ?
    ORDER BY id DESC
    LIMIT ?
  `).all(cutoff, limit);
}

export function setPaymentMessage(orderId, chatId, msgId, expiresAtISO, payUrl = null) {
  db.prepare(`
    UPDATE orders SET pay_msg_chat_id=?, pay_msg_id=?, expires_at=?, last_refresh_at=?, pay_url=?
    WHERE order_id=?
  `).run(chatId, msgId, expiresAtISO, new Date().toISOString(), payUrl, orderId);
}

export function touchRefresh(orderId) {
  db.prepare(`UPDATE orders SET last_refresh_at=? WHERE order_id=?`)
    .run(new Date().toISOString(), orderId);
}

export function setExpired(orderId) {
  db.prepare(`UPDATE orders SET status='EXPIRED' WHERE order_id=?`).run(orderId);
}

export function listPendingWithExpiry(limit = 30) {
  return db.prepare(`
    SELECT * FROM orders
    WHERE status='PENDING' AND expires_at IS NOT NULL
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get tenant sales statistics
 * Returns: total_orders, total_paid, total_revenue, pending_count
 */
export function getTenantStats(tenantId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      SUM(CASE WHEN status='PAID' THEN 1 ELSE 0 END) as total_paid,
      SUM(CASE WHEN status='PAID' THEN total ELSE 0 END) as total_revenue,
      SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) as pending_count
    FROM orders
    WHERE tenant_id=?
  `).get(tenantId);
  
  return {
    total_orders: stats?.total_orders || 0,
    total_paid: stats?.total_paid || 0,
    total_revenue: stats?.total_revenue || 0,
    pending_count: stats?.pending_count || 0
  };
}