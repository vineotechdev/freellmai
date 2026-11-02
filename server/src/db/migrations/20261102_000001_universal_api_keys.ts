// Migration: Add is_universal to api_keys and universal_keys to tenant_api_keys
// Created: 2026-11-02

import type { Db } from '../types.js';

function tableExists(db: Db, table: string): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    return !!row;
  } catch {
    return false;
  }
}

function columnExists(db: Db, table: string, column: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return columns.some(c => c.name === column);
  } catch {
    return false;
  }
}

export function up(db: Db): void {
  // 1. Add is_universal to api_keys
  if (tableExists(db, 'api_keys')) {
    if (!columnExists(db, 'api_keys', 'is_universal')) {
      try {
        db.prepare('ALTER TABLE api_keys ADD COLUMN is_universal INTEGER NOT NULL DEFAULT 0').run();
      } catch (err: any) {
        console.warn('[migration] Could not add is_universal to api_keys:', err.message);
      }
    }
    try {
      db.prepare('CREATE INDEX IF NOT EXISTS idx_api_keys_is_universal ON api_keys(is_universal)').run();
    } catch {}
  }

  // 2. Add universal_keys to tenant_api_keys
  if (tableExists(db, 'tenant_api_keys')) {
    if (!columnExists(db, 'tenant_api_keys', 'universal_keys')) {
      try {
        db.prepare('ALTER TABLE tenant_api_keys ADD COLUMN universal_keys INTEGER NOT NULL DEFAULT 0').run();
      } catch (err: any) {
        console.warn('[migration] Could not add universal_keys to tenant_api_keys:', err.message);
      }
    }
    try {
      db.prepare('CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_universal_keys ON tenant_api_keys(universal_keys)').run();
    } catch {}
  }
}

export function down(db: Db): void {
  // SQLite does not easily support DROP COLUMN in older versions without table rebuild
}

