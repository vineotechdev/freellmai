// Migration: Multi-tenant support with mother_id, company_name, and tenant_api_keys
// Created: 2026-10-31

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return columns.some(col => col.name === column);
  } catch {
    return false;
  }
}

function tableExists(db: Db, table: string): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    return !!row;
  } catch {
    return false;
  }
}

export function up(db: Db): void {
  // 1. Add mother_id & company_name to users
  if (tableExists(db, 'users')) {
    if (!hasColumn(db, 'users', 'mother_id')) {
      db.prepare("ALTER TABLE users ADD COLUMN mother_id TEXT NOT NULL DEFAULT 'default'").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_users_mother_id ON users(mother_id)").run();
    }
    if (!hasColumn(db, 'users', 'company_name')) {
      db.prepare("ALTER TABLE users ADD COLUMN company_name TEXT NOT NULL DEFAULT 'Default Company'").run();
    }
  }

  // 2. Add mother_id to api_keys
  if (tableExists(db, 'api_keys')) {
    if (!hasColumn(db, 'api_keys', 'mother_id')) {
      db.prepare("ALTER TABLE api_keys ADD COLUMN mother_id TEXT NOT NULL DEFAULT 'default'").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_mother_id ON api_keys(mother_id)").run();
    }
  }

  // 3. Create tenant_api_keys table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tenant_api_keys (
      mother_id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_api_key ON tenant_api_keys(api_key)").run();

  // 4. Seed tenant_api_keys from legacy unified_api_key if available
  if (tableExists(db, 'settings')) {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get() as { value: string } | undefined;
      if (row && row.value) {
        db.prepare(`
          INSERT INTO tenant_api_keys (mother_id, api_key, company_name, created_at)
          VALUES ('default', ?, 'Default Company', '2026-10-31 00:00:00')
          ON CONFLICT(mother_id) DO NOTHING
        `).run(row.value);
      }
    } catch {}
  }

  // 5. Add mother_id to client_profiles
  if (tableExists(db, 'client_profiles') && !hasColumn(db, 'client_profiles', 'mother_id')) {
    try {
      db.prepare("ALTER TABLE client_profiles ADD COLUMN mother_id TEXT NOT NULL DEFAULT 'default'").run();
    } catch {}
  }

  // 6. Add mother_id to playground_conversations
  if (tableExists(db, 'playground_conversations') && !hasColumn(db, 'playground_conversations', 'mother_id')) {
    try {
      db.prepare("ALTER TABLE playground_conversations ADD COLUMN mother_id TEXT NOT NULL DEFAULT 'default'").run();
    } catch {}
  }

  // 7. Add mother_id to requests
  if (tableExists(db, 'requests') && !hasColumn(db, 'requests', 'mother_id')) {
    try {
      db.prepare("ALTER TABLE requests ADD COLUMN mother_id TEXT NOT NULL DEFAULT 'default'").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_requests_mother_id ON requests(mother_id)").run();
    } catch {}
  }
}

export function down(db: Db): void {
  // 1. Drop indexes first before dropping columns (SQLite requires index to be dropped before column)
  try { db.prepare("DROP INDEX IF EXISTS idx_users_mother_id").run(); } catch {}
  try { db.prepare("DROP INDEX IF EXISTS idx_api_keys_mother_id").run(); } catch {}
  try { db.prepare("DROP INDEX IF EXISTS idx_requests_mother_id").run(); } catch {}
  try { db.prepare("DROP INDEX IF EXISTS idx_tenant_api_keys_api_key").run(); } catch {}

  // 2. Drop tenant_api_keys table
  try { db.prepare("DROP TABLE IF EXISTS tenant_api_keys").run(); } catch {}

  // 3. Drop columns from tables
  if (tableExists(db, 'users') && hasColumn(db, 'users', 'mother_id')) {
    try { db.prepare("ALTER TABLE users DROP COLUMN mother_id").run(); } catch {}
  }
  if (tableExists(db, 'users') && hasColumn(db, 'users', 'company_name')) {
    try { db.prepare("ALTER TABLE users DROP COLUMN company_name").run(); } catch {}
  }
  if (tableExists(db, 'api_keys') && hasColumn(db, 'api_keys', 'mother_id')) {
    try { db.prepare("ALTER TABLE api_keys DROP COLUMN mother_id").run(); } catch {}
  }
  if (tableExists(db, 'client_profiles') && hasColumn(db, 'client_profiles', 'mother_id')) {
    try { db.prepare("ALTER TABLE client_profiles DROP COLUMN mother_id").run(); } catch {}
  }
  if (tableExists(db, 'playground_conversations') && hasColumn(db, 'playground_conversations', 'mother_id')) {
    try { db.prepare("ALTER TABLE playground_conversations DROP COLUMN mother_id").run(); } catch {}
  }
  if (tableExists(db, 'requests') && hasColumn(db, 'requests', 'mother_id')) {
    try { db.prepare("ALTER TABLE requests DROP COLUMN mother_id").run(); } catch {}
  }
}

