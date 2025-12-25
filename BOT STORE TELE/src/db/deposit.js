import { db } from "./index.js";

// Ensure deposits table exists (safety check)
function ensureDepositsTable() {
  try {
    // Check if table exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='deposits'"
    ).get();
    
    if (!tableExists) {
      // Table doesn't exist, create it
      db.prepare(`
        CREATE TABLE deposits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          order_id TEXT NOT NULL UNIQUE,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          pay_url TEXT,
          created_at TEXT NOT NULL
        )
      `).run();
      console.log("✅ deposits table created");
    }
  } catch (e) {
    console.error("DEPOSITS_TABLE_CREATION_ERR:", e);
    throw new Error(`Failed to ensure deposits table: ${e.message}`);
  }
}

export function createDeposit({ userId, tenantId, orderId, amount, payUrl }) {
  ensureDepositsTable();
  db.prepare(`
    INSERT INTO deposits
    (user_id, tenant_id, order_id, amount, status, pay_url, created_at)
    VALUES (?,?,?,?,'PENDING',?,?)
  `).run(userId, tenantId, orderId, amount, payUrl, new Date().toISOString());
}

export function markDepositPaid(orderId) {
  ensureDepositsTable();
  db.prepare(`
    UPDATE deposits SET status='PAID'
    WHERE order_id=?
  `).run(orderId);
}

export function getDeposit(orderId) {
  ensureDepositsTable();
  return db.prepare(`
    SELECT * FROM deposits WHERE order_id=?
  `).get(orderId);
}

export function setPaymentMessage(orderId, chatId, msgId, expiresAtISO) {
  ensureDepositsTable();
  db.prepare(`
    UPDATE deposits SET pay_msg_chat_id=?, pay_msg_id=?, expires_at=?, last_refresh_at=?
    WHERE order_id=?
  `).run(chatId, msgId, expiresAtISO, new Date().toISOString(), orderId);
}

export function listRecentPendingDeposits(limit = 20, maxAgeMinutes = 45) {
  // ambil PENDING deposits yang masih fresh (anti cek invoice lama)
  ensureDepositsTable();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  return db.prepare(`
    SELECT * FROM deposits
    WHERE status='PENDING' AND created_at >= ?
    ORDER BY id DESC
    LIMIT ?
  `).all(cutoff, limit);
}