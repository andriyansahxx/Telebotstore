import { db } from "./index.js";

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      saldo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,

      -- broadcast safety
      bc_fail INTEGER NOT NULL DEFAULT 0,
      bc_blocked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL,
      item TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      used_order_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,         -- PRODUCT / RENT
      variant_id INTEGER,         -- nullable for RENT
      qty INTEGER NOT NULL,
      order_id TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL,       -- PENDING / PAID
      created_at TEXT NOT NULL,

      -- delivery safety
      delivered_at TEXT,
      delivered_qty INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status_created
      ON orders(status, created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      months INTEGER NOT NULL,
      price INTEGER NOT NULL,
      order_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,       -- PENDING / ACTIVE
      ends_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Create balances table separately to ensure it works
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS balances (
        tenant_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, user_id)
      )
    `).run();
  } catch (e) {
    console.error("balances table creation failed:", e.message);
  }

  // Create deposits table separately to ensure it works
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS deposits (
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
  } catch (e) {
    console.error("deposits table creation failed:", e.message);
  }

  // welcome default
  const w = db.prepare("SELECT key FROM settings WHERE key='welcome'").get();
  if (!w) {
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run(
      "welcome",
      JSON.stringify({ type: "text", text: "👋 Selamat datang!\nSilakan pilih menu." })
    );
  }

  // admin welcome default (media+text support)
  const aw = db.prepare("SELECT key FROM settings WHERE key='admin_welcome_type'").get();
  if (!aw) {
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run("admin_welcome_type", "text");
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run("admin_welcome_value", "👋 Selamat datang di Gwei Store!");
  }

  // store name & owner info
  const sn = db.prepare("SELECT key FROM settings WHERE key='store_name'").get();
  if (!sn) {
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run("store_name", "Gwei Store");
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run("owner_info", "Info Owner");
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run("transaction_help", "Jika ada kendala pada Transaksi BOT silahkan hubungi Admin/Owner");
  }

  // migration (kalau dulu users belum punya kolom bc_fail/bc_blocked)
  // SQLite tidak punya IF NOT EXISTS untuk ADD COLUMN, jadi try/catch aman
  try { db.exec(`ALTER TABLE users ADD COLUMN bc_fail INTEGER NOT NULL DEFAULT 0;`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN bc_blocked INTEGER NOT NULL DEFAULT 0;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN delivered_at TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN delivered_qty INTEGER NOT NULL DEFAULT 0;`); } catch {}
  // migrations for payment message tracking + expiry (safe, no-op on old DB)
  try { db.exec(`ALTER TABLE orders ADD COLUMN pay_msg_chat_id INTEGER;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN pay_msg_id INTEGER;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN expires_at TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN last_refresh_at TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN pay_url TEXT;`); } catch {}
  try { db.exec(`CREATE INDEX idx_orders_status_created ON orders(status, created_at);`); } catch {}

  // migrations for deposits payment message tracking (safe, no-op on old DB)
  try { db.exec(`ALTER TABLE deposits ADD COLUMN pay_msg_chat_id INTEGER;`); } catch {}
  try { db.exec(`ALTER TABLE deposits ADD COLUMN pay_msg_id INTEGER;`); } catch {}
  try { db.exec(`ALTER TABLE deposits ADD COLUMN expires_at TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE deposits ADD COLUMN last_refresh_at TEXT;`); } catch {}
  try { db.exec(`CREATE INDEX idx_deposits_status_created ON deposits(status, created_at);`); } catch {}

  // ===== multi-tenant tables =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      pakasir_slug TEXT,
      pakasir_api_key TEXT,
      qris_only INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_tenant (
      user_id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // ===== migration kolom tenant_id ke tabel existing (safe) =====
  try { db.exec(`ALTER TABLE products ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 0;`); } catch {}
  try { db.exec(`ALTER TABLE variants ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 0;`); } catch {}
  try { db.exec(`ALTER TABLE stock_items ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 0;`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 0;`); } catch {}

  // ===== settings untuk store utama (tenant_id=0) =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // add updated_at columns for audit (safe, no-op if already present)
  try { db.exec(`ALTER TABLE products ADD COLUMN updated_at TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE variants ADD COLUMN updated_at TEXT;`); } catch {}

  // ===== migration: tenant branding & invoice logo (safe) =====
  // welcome_type -> 'text' | 'photo' | 'video' | 'document'
  // welcome_value -> teks atau file_id
  // logo_file_id -> file_id untuk logo yang dipakai di invoice PNG
  try { db.exec(`ALTER TABLE tenants ADD COLUMN welcome_type TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE tenants ADD COLUMN welcome_value TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE tenants ADD COLUMN logo_file_id TEXT;`); } catch {}

  // index biar cepat
  try { db.exec(`CREATE INDEX idx_products_tenant ON products(tenant_id, active);`); } catch {}
  try { db.exec(`CREATE INDEX idx_variants_tenant ON variants(tenant_id, product_id, active);`); } catch {}
  try { db.exec(`CREATE INDEX idx_stock_tenant ON stock_items(tenant_id, variant_id, used);`); } catch {}
  try { db.exec(`CREATE INDEX idx_orders_tenant ON orders(tenant_id, status, created_at);`); } catch {}

  // backfill tenant_id untuk data lama (idempotent)
  db.exec(`UPDATE products SET tenant_id=0 WHERE tenant_id IS NULL;`);
  db.exec(`UPDATE variants SET tenant_id=0 WHERE tenant_id IS NULL;`);
  db.exec(`UPDATE stock_items SET tenant_id=0 WHERE tenant_id IS NULL;`);
  db.exec(`UPDATE orders SET tenant_id=0 WHERE tenant_id IS NULL;`);
  // backfill branding columns for existing tenants (idempotent)
  try { db.exec(`UPDATE tenants SET welcome_type='text' WHERE welcome_type IS NULL;`); } catch {}
  try { db.exec(`UPDATE tenants SET welcome_value='' WHERE welcome_value IS NULL;`); } catch {}
  try { db.exec(`UPDATE tenants SET logo_file_id=NULL WHERE logo_file_id IS NULL;`); } catch {}
}