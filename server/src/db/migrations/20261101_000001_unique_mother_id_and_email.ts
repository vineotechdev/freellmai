// Migration: Enforce unique constraints on mother_id and email in users table
// Created: 2026-11-01

import type { Db } from '../types.js';

function tableExists(db: Db, table: string): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    return !!row;
  } catch {
    return false;
  }
}

export function up(db: Db): void {
  if (tableExists(db, 'users')) {
    // 1. Enforce unique index on email
    try {
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)').run();
    } catch (err: any) {
      console.warn('[migration] Could not create unique index on users(email):', err.message);
    }

    // 2. Index on mother_id for fast lookup (multiple users can belong to the same company)
    try {
      db.prepare('DROP INDEX IF EXISTS idx_users_mother_id').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_users_mother_id ON users(mother_id)').run();
    } catch (err: any) {
      console.warn('[migration] Could not create index on users(mother_id):', err.message);
    }
  }
}

export function down(db: Db): void {
  if (tableExists(db, 'users')) {
    try {
      db.prepare('DROP INDEX IF EXISTS idx_users_mother_id').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_users_mother_id ON users(mother_id)').run();
    } catch {}
  }
}

