import { db } from "./index.js";

export function upsertUser(userId, username) {
  const now = new Date().toISOString();
  const row = db.prepare("SELECT user_id FROM users WHERE user_id=?").get(userId);
  if (!row) {
    db.prepare(`
      INSERT INTO users(user_id, username, saldo, created_at, bc_fail, bc_blocked)
      VALUES (?,?,0,?,0,0)
    `).run(userId, username || "", now);
  } else {
    db.prepare("UPDATE users SET username=? WHERE user_id=?").run(username || "", userId);
  }
}

export function getSaldo(userId) {
  const row = db.prepare("SELECT saldo FROM users WHERE user_id=?").get(userId);
  return row ? Number(row.saldo) : 0;
}

export function addSaldo(userId, amount) {
  db.prepare("UPDATE users SET saldo = saldo + ? WHERE user_id=?").run(amount, userId);
}

export function subSaldo(userId, amount) {
  db.prepare("UPDATE users SET saldo = saldo - ? WHERE user_id=?").run(amount, userId);
}

export function allUserIdsBroadcastable() {
  return db.prepare("SELECT user_id FROM users WHERE bc_blocked=0").all().map(r => Number(r.user_id));
}

/**
 * Get total number of users in the bot
 */
export function getTotalUsers() {
  const result = db.prepare("SELECT COUNT(*) as count FROM users").get();
  return result?.count || 0;
}

export function incBroadcastFail(userId) {
  db.prepare("UPDATE users SET bc_fail = bc_fail + 1 WHERE user_id=?").run(userId);
  const fail = db.prepare("SELECT bc_fail FROM users WHERE user_id=?").get(userId)?.bc_fail ?? 0;
  if (Number(fail) >= 3) {
    db.prepare("UPDATE users SET bc_blocked=1 WHERE user_id=?").run(userId);
  }
}

export function resetBroadcastFail(userId) {
  db.prepare("UPDATE users SET bc_fail=0 WHERE user_id=?").run(userId);
}