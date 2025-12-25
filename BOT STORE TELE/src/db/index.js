import Database from "better-sqlite3";
export const db = new Database("bot.db", { timeout: 5000 });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");