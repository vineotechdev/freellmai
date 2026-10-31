// Migration: User-scoped unified API keys and provider API keys
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
  // 1. Add user_id column to api_keys
  if (tableExists(db, 'api_keys')) {
    if (!hasColumn(db, 'api_keys', 'user_id')) {
      db.prepare('ALTER TABLE api_keys ADD COLUMN user_id INTEGER').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_api_keys_user_platform ON api_keys(user_id, platform)').run();

      // Backfill user_id on existing api_keys if single user exists per mother_id
      try {
        if (tableExists(db, 'users')) {
          const users = db.prepare('SELECT id, mother_id FROM users').all() as { id: number; mother_id: string }[];
          for (const u of users) {
            // If only one user has this mother_id, attribute any existing unassigned keys to that user
            const count = db.prepare('SELECT COUNT(*) as c FROM users WHERE mother_id = ?').get(u.mother_id) as { c: number };
            if (count && count.c === 1) {
              db.prepare('UPDATE api_keys SET user_id = ? WHERE mother_id = ? AND user_id IS NULL').run(u.id, u.mother_id);
            }
          }
        }
      } catch {}
    }
  }

  // 2. Update tenant_api_keys table to allow user_id and multiple keys per mother_id
  if (tableExists(db, 'tenant_api_keys')) {
    const columns = db.prepare('PRAGMA table_info(tenant_api_keys)').all() as { name: string; pk: number }[];
    const hasUserId = columns.some(col => col.name === 'user_id');
    const motherIdIsPk = columns.some(col => col.name === 'mother_id' && col.pk > 0);

    // If mother_id was PRIMARY KEY, rebuild the table so mother_id is not unique and user_id is supported
    if (motherIdIsPk || !hasUserId) {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS tenant_api_keys_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          mother_id TEXT NOT NULL,
          api_key TEXT NOT NULL UNIQUE,
          company_name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();

      if (hasUserId) {
        db.prepare(`
          INSERT INTO tenant_api_keys_v2 (user_id, mother_id, api_key, company_name, created_at)
          SELECT user_id, mother_id, api_key, company_name, created_at FROM tenant_api_keys
        `).run();
      } else {
        db.prepare(`
          INSERT INTO tenant_api_keys_v2 (user_id, mother_id, api_key, company_name, created_at)
          SELECT NULL, mother_id, api_key, company_name, created_at FROM tenant_api_keys
        `).run();
      }

      // Backfill user_id in tenant_api_keys from users table if possible
      try {
        if (tableExists(db, 'users')) {
          const users = db.prepare('SELECT id, mother_id FROM users').all() as { id: number; mother_id: string }[];
          for (const u of users) {
            db.prepare('UPDATE tenant_api_keys_v2 SET user_id = ? WHERE mother_id = ? AND user_id IS NULL').run(u.id, u.mother_id);
          }
        }
      } catch {}

      db.prepare('DROP TABLE tenant_api_keys').run();
      db.prepare('ALTER TABLE tenant_api_keys_v2 RENAME TO tenant_api_keys').run();

      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_api_keys_user_id ON tenant_api_keys(user_id) WHERE user_id IS NOT NULL').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_mother_id ON tenant_api_keys(mother_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_api_key ON tenant_api_keys(api_key)').run();
    }
  } else {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS tenant_api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        mother_id TEXT NOT NULL,
        api_key TEXT NOT NULL UNIQUE,
        company_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_api_keys_user_id ON tenant_api_keys(user_id) WHERE user_id IS NOT NULL').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_mother_id ON tenant_api_keys(mother_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_api_key ON tenant_api_keys(api_key)').run();
  }
}

export function down(db: Db): void {
  try { db.prepare('DROP INDEX IF EXISTS idx_api_keys_user_platform').run(); } catch {}
  try { db.prepare('DROP INDEX IF EXISTS idx_api_keys_user_id').run(); } catch {}
  if (tableExists(db, 'api_keys') && hasColumn(db, 'api_keys', 'user_id')) {
    try { db.prepare('ALTER TABLE api_keys DROP COLUMN user_id').run(); } catch {}
  }
}

