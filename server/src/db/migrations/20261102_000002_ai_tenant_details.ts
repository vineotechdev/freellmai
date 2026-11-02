// Migration: Create ai_tenant_details table for central mother_id settings
// Created: 2026-11-02

import type { Db } from '../types.js';

export function up(db: Db): void {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ai_tenant_details (
        mother_id TEXT PRIMARY KEY,
        company_name TEXT,
        universal_keys INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_ai_tenant_details_mother_id ON ai_tenant_details(mother_id)').run();

    // Populate from existing tenant_api_keys
    db.prepare(`
      INSERT INTO ai_tenant_details (mother_id, company_name, universal_keys)
      SELECT mother_id, company_name, MAX(universal_keys)
      FROM tenant_api_keys
      WHERE mother_id IS NOT NULL AND mother_id != ''
      GROUP BY mother_id
      ON CONFLICT(mother_id) DO UPDATE SET
        company_name = COALESCE(excluded.company_name, ai_tenant_details.company_name),
        universal_keys = MAX(ai_tenant_details.universal_keys, excluded.universal_keys)
    `).run();
  } catch (err: any) {
    console.warn('[migration] Could not create ai_tenant_details table in SQLite:', err.message);
  }
}

export function down(db: Db): void {
  try {
    db.prepare('DROP TABLE IF EXISTS ai_tenant_details').run();
  } catch {}
}
