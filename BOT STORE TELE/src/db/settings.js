import { db } from "./index.js";

export function getSetting(key) {
  const r = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  return r?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key, value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, value);
}