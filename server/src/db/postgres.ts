import pg from 'pg';
import fs from 'fs';
import type { Db } from './types.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let isInitialized = false;

/**
 * Returns true if a PostgreSQL DATABASE_URL or POSTGRES_URL is configured.
 */
export function isPostgresConfigured(): boolean {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;
  return Boolean(url && url.trim().length > 0);
}

/**
 * Returns connection string from environment variables.
 */
export function getPostgresConnectionString(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL || 'postgres://postgres:secret@123%23DKDMS_ERP@localhost:5432/polarlistv1';
  return url.trim();
}

/**
 * Gets or initializes the PostgreSQL connection pool.
 * Compatible with ANY standalone PostgreSQL database (Neon, Supabase, RDS, Docker, local, etc.)
 */
export function getPostgresPool(): pg.Pool | null {
  if (pool) return pool;

  const connStr = getPostgresConnectionString();
  if (!connStr) return null;

  const isLocal = connStr.includes('localhost') || connStr.includes('127.0.0.1');
  const needsSsl = !isLocal || connStr.includes('sslmode=require') || connStr.includes('neon.tech') || connStr.includes('supabase');

  pool = new Pool({
    connectionString: connStr,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err) => {
    console.error('[PostgreSQL] Unexpected error on idle client:', err.message);
  });

  return pool;
}

/**
 * Initializes the PostgreSQL schema and creates all tables if they do not exist.
 * All AI-related tables are prefixed with 'ai_' (e.g. ai_users, ai_tenant_api_keys, ai_api_keys)
 * so they are easily recognizable and never conflict with the main ERP tables.
 */
export async function initPostgresSchema(): Promise<void> {
  let p = getPostgresPool();
  if (!p) return;

  const connStr = getPostgresConnectionString();

  try {
    let versionRes;
    try {
      versionRes = await p.query('SELECT version()');
    } catch (connErr: any) {
      if ((connErr.code === 'ECONNREFUSED' || connErr.message?.includes('ECONNREFUSED')) && connStr.includes(':5432')) {
        console.warn('[PostgreSQL] Connection refused on port 5432, attempting local port 6432 fallback...');
        const fallbackUrl = connStr.replace(':5432', ':6432').replace('secret@123%23DKDMS_ERP', 'postgres');
        await pool?.end().catch(() => {});
        pool = new Pool({
          connectionString: fallbackUrl,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
        p = pool;
        versionRes = await p.query('SELECT version()');
      } else {
        throw connErr;
      }
    }

    const versionStr = versionRes.rows[0]?.version?.split(' ')?.[1] || versionRes.rows[0]?.version || 'unknown';
    console.log(`[PostgreSQL] Connected successfully to PostgreSQL (Version: ${versionStr})`);

    // 1. Rename any legacy tables to use the 'ai_' prefix if they exist and ai_* does not exist yet
    await p.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenant_api_keys')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_tenant_api_keys') THEN
          ALTER TABLE tenant_api_keys RENAME TO ai_tenant_api_keys;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'api_keys')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_api_keys') THEN
          ALTER TABLE api_keys RENAME TO ai_api_keys;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'settings')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_settings') THEN
          ALTER TABLE settings RENAME TO ai_settings;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'requests')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_requests') THEN
          ALTER TABLE requests RENAME TO ai_requests;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_sessions') THEN
          ALTER TABLE sessions RENAME TO ai_sessions;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'models')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_models') THEN
          ALTER TABLE models RENAME TO ai_models;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'freellmai_snapshots')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_snapshots') THEN
          ALTER TABLE freellmai_snapshots RENAME TO ai_snapshots;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'password_reset_codes')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_password_reset_codes') THEN
          ALTER TABLE password_reset_codes RENAME TO ai_password_reset_codes;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);

    // 2. Create and verify all AI tables with 'ai_' prefix in PostgreSQL
    await p.query(`
      CREATE TABLE IF NOT EXISTS ai_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        mother_id TEXT,
        company_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE ai_users ADD COLUMN IF NOT EXISTS mother_id TEXT;
      ALTER TABLE ai_users ADD COLUMN IF NOT EXISTS company_name TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_users_email ON ai_users(email);
      DROP INDEX IF EXISTS idx_ai_users_mother_id;
      CREATE INDEX IF NOT EXISTS idx_ai_users_mother_id ON ai_users(mother_id) WHERE mother_id IS NOT NULL;

      -- If the ERP 'users' table exists, populate ai_users safely without interfering with ERP data
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
          INSERT INTO ai_users (id, email, password_hash, mother_id, company_name, created_at)
          SELECT id, email, password_hash, mother_id::text, 'PolarList User', created_at
          FROM users
          WHERE email IS NOT NULL AND email != ''
          ON CONFLICT (email) DO UPDATE SET
            id = EXCLUDED.id,
            password_hash = EXCLUDED.password_hash,
            mother_id = EXCLUDED.mother_id;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS ai_tenant_api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        mother_id TEXT NOT NULL,
        api_key TEXT NOT NULL UNIQUE,
        company_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE ai_tenant_api_keys ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE ai_tenant_api_keys DROP CONSTRAINT IF EXISTS ai_tenant_api_keys_mother_id_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_tenant_api_keys_user_id ON ai_tenant_api_keys(user_id) WHERE user_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ai_api_keys (
        id SERIAL PRIMARY KEY,
        platform TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        encrypted_key TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        enabled INTEGER NOT NULL DEFAULT 1,
        mother_id TEXT,
        user_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_checked_at TIMESTAMPTZ,
        last_healthy_at TIMESTAMPTZ,
        last_health_error TEXT
      );
      ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS mother_id TEXT;
      ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMPTZ;
      ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS last_health_error TEXT;
      CREATE INDEX IF NOT EXISTS idx_ai_api_keys_user_id ON ai_api_keys(user_id);

      CREATE TABLE IF NOT EXISTS ai_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_requests (
        id SERIAL PRIMARY KEY,
        platform TEXT NOT NULL,
        model_id TEXT NOT NULL,
        key_id INTEGER,
        status TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        mother_id TEXT,
        company_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ai_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES ai_users(id) ON DELETE CASCADE,
        expires_at_ms BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ai_models (
        id SERIAL PRIMARY KEY,
        platform TEXT NOT NULL,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        intelligence_rank INTEGER NOT NULL DEFAULT 0,
        speed_rank INTEGER NOT NULL DEFAULT 0,
        size_label TEXT NOT NULL DEFAULT '',
        rpm_limit INTEGER,
        rpd_limit INTEGER,
        tpm_limit INTEGER,
        tpd_limit INTEGER,
        monthly_token_budget TEXT NOT NULL DEFAULT '',
        context_window INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        supports_vision INTEGER NOT NULL DEFAULT 0,
        UNIQUE(platform, model_id)
      );

      CREATE TABLE IF NOT EXISTS ai_snapshots (
        id TEXT PRIMARY KEY,
        data BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ai_password_reset_codes (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_reset_codes_email ON ai_password_reset_codes(email);

      -- Data migration & cleanup: if old un-prefixed tables still exist alongside ai_* tables, migrate and drop
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenant_api_keys')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_tenant_api_keys') THEN
          INSERT INTO ai_tenant_api_keys (user_id, mother_id, api_key, company_name, created_at)
          SELECT user_id, mother_id, api_key, company_name, created_at FROM tenant_api_keys ON CONFLICT (api_key) DO NOTHING;
          DROP TABLE tenant_api_keys CASCADE;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'api_keys')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_api_keys') THEN
          INSERT INTO ai_api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id, created_at, last_checked_at, last_healthy_at, last_health_error)
          SELECT platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id, created_at, last_checked_at, last_healthy_at, last_health_error FROM api_keys;
          DROP TABLE api_keys CASCADE;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'settings')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_settings') THEN
          INSERT INTO ai_settings (key, value)
          SELECT key, value FROM settings ON CONFLICT (key) DO NOTHING;
          DROP TABLE settings CASCADE;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'requests')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_requests') THEN
          INSERT INTO ai_requests (platform, model_id, key_id, status, input_tokens, output_tokens, latency_ms, error, mother_id, company_name, created_at)
          SELECT platform, model_id, key_id, status, input_tokens, output_tokens, latency_ms, error, mother_id, company_name, created_at FROM requests;
          DROP TABLE requests CASCADE;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_sessions') THEN
          DROP TABLE sessions CASCADE;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'models')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_models') THEN
          INSERT INTO ai_models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, supports_vision)
          SELECT platform, model_id, display_name, intelligence_rank, speed_rank, size_label, rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, supports_vision FROM models
          ON CONFLICT (platform, model_id) DO NOTHING;
          DROP TABLE models CASCADE;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'freellmai_snapshots')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_snapshots') THEN
          INSERT INTO ai_snapshots (id, data, updated_at)
          SELECT id, data, updated_at FROM freellmai_snapshots ON CONFLICT (id) DO NOTHING;
          DROP TABLE freellmai_snapshots CASCADE;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'password_reset_codes')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_password_reset_codes') THEN
          INSERT INTO ai_password_reset_codes (email, code_hash, expires_at, used, created_at)
          SELECT email, code_hash, expires_at, used, created_at FROM password_reset_codes;
          DROP TABLE password_reset_codes CASCADE;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);

    isInitialized = true;
    console.log('[PostgreSQL] Database tables initialized and verified with ai_ prefix.');
  } catch (err: any) {
    console.error('[PostgreSQL] Initialization error:', err.message);
    throw err;
  }
}

/**
 * Loads data from PostgreSQL into the active local database on startup.
 */
export async function syncAllTablesFromPostgres(db: Db): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    // 1. Sync settings from PostgreSQL (ai_settings)
    const settingsRes = await p.query('SELECT key, value FROM ai_settings');
    for (const row of settingsRes.rows) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(row.key, row.value);
    }

    // 2. Sync users from PostgreSQL (ai_users)
    const usersRes = await p.query('SELECT id, email, password_hash, mother_id, company_name, created_at FROM ai_users');
    for (const row of usersRes.rows) {
      const createdAtStr = row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ? String(row.created_at) : null);
      db.prepare(`
        INSERT INTO users (id, email, password_hash, mother_id, company_name, created_at)
        VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          password_hash = excluded.password_hash,
          mother_id = excluded.mother_id,
          company_name = excluded.company_name
      `).run(Number(row.id), row.email, row.password_hash, row.mother_id || 'default', row.company_name || 'Default Company', createdAtStr);
    }

    // 3. Sync tenant_api_keys from PostgreSQL (ai_tenant_api_keys)
    const tenantRes = await p.query('SELECT user_id, mother_id, api_key, company_name, created_at FROM ai_tenant_api_keys');
    for (const row of tenantRes.rows) {
      const createdAtStr = row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ? String(row.created_at) : null);
      db.prepare(`
        INSERT INTO tenant_api_keys (user_id, mother_id, api_key, company_name, created_at)
        VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))
        ON CONFLICT(api_key) DO UPDATE SET
          user_id = excluded.user_id,
          mother_id = excluded.mother_id,
          company_name = excluded.company_name
      `).run(row.user_id ? Number(row.user_id) : null, row.mother_id, row.api_key, row.company_name || 'Default Company', createdAtStr);
    }

    // 4. Sync api_keys from PostgreSQL (ai_api_keys)
    const keysRes = await p.query('SELECT id, platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id, last_healthy_at, last_health_error, created_at FROM ai_api_keys');
    for (const row of keysRes.rows) {
      const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(row.id);
      const createdAtStr = row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ? String(row.created_at) : null);
      const lastHealthyStr = row.last_healthy_at instanceof Date ? row.last_healthy_at.toISOString() : (row.last_healthy_at ? String(row.last_healthy_at) : null);
      if (!existing) {
        db.prepare(`
          INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id, last_healthy_at, last_health_error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
        `).run(Number(row.id), row.platform, row.label, row.encrypted_key, row.iv, row.auth_tag, row.status, row.enabled, row.mother_id || 'default', row.user_id ? Number(row.user_id) : null, lastHealthyStr, row.last_health_error || null, createdAtStr);
      } else {
        db.prepare(`
          UPDATE api_keys SET
            platform = ?, label = ?, encrypted_key = ?, iv = ?, auth_tag = ?, status = ?, enabled = ?, mother_id = ?, user_id = ?, last_healthy_at = ?, last_health_error = ?
          WHERE id = ?
        `).run(row.platform, row.label, row.encrypted_key, row.iv, row.auth_tag, row.status, row.enabled, row.mother_id || 'default', row.user_id ? Number(row.user_id) : null, lastHealthyStr, row.last_health_error || null, Number(row.id));
      }
    }

    console.log(`[PostgreSQL] Pulled ${usersRes.rows.length} users and ${tenantRes.rows.length} tenant keys from PostgreSQL.`);
  } catch (err: any) {
    console.error('[PostgreSQL] Error syncing from PostgreSQL:', err.message);
  }
}

/**
 * Synchronizes API keys on-demand from PostgreSQL ai_api_keys table into local SQLite cache.
 * Essential for serverless (Vercel) multi-instance environments so any instance sees freshly added/updated keys.
 */
export async function syncApiKeysFromPostgres(db: Db, userId?: number | null, motherId?: string | null): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    let query = 'SELECT id, platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id, last_healthy_at, last_health_error, created_at FROM ai_api_keys';
    const params: any[] = [];
    if (userId) {
      query += ' WHERE user_id = $1';
      params.push(userId);
    } else if (motherId) {
      query += ' WHERE mother_id = $1 AND user_id IS NULL';
      params.push(motherId);
    }

    const keysRes = await p.query(query, params);
    const pgKeyIds = new Set(keysRes.rows.map(r => Number(r.id)));

    for (const row of keysRes.rows) {
      const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(row.id);
      const createdAtStr = row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ? String(row.created_at) : null);
      const lastHealthyStr = row.last_healthy_at instanceof Date ? row.last_healthy_at.toISOString() : (row.last_healthy_at ? String(row.last_healthy_at) : null);
      if (!existing) {
        db.prepare(`
          INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id, last_healthy_at, last_health_error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
        `).run(Number(row.id), row.platform, row.label, row.encrypted_key, row.iv, row.auth_tag, row.status, row.enabled, row.mother_id || 'default', row.user_id ? Number(row.user_id) : null, lastHealthyStr, row.last_health_error || null, createdAtStr);
      } else {
        db.prepare(`
          UPDATE api_keys SET
            platform = ?, label = ?, encrypted_key = ?, iv = ?, auth_tag = ?, status = ?, enabled = ?, mother_id = ?, user_id = ?, last_healthy_at = ?, last_health_error = ?
          WHERE id = ?
        `).run(row.platform, row.label, row.encrypted_key, row.iv, row.auth_tag, row.status, row.enabled, row.mother_id || 'default', row.user_id ? Number(row.user_id) : null, lastHealthyStr, row.last_health_error || null, Number(row.id));
      }
    }

    // Clean up local SQLite keys for this user/tenant that were removed from PostgreSQL
    if (userId) {
      const localKeys = db.prepare('SELECT id FROM api_keys WHERE user_id = ?').all(userId) as { id: number }[];
      for (const lk of localKeys) {
        if (!pgKeyIds.has(Number(lk.id))) {
          db.prepare('DELETE FROM api_keys WHERE id = ?').run(lk.id);
        }
      }
    }
  } catch (err: any) {
    console.error('[PostgreSQL] Error syncing api_keys on demand:', err.message);
  }
}

/**
 * Pushes all active tables from local DB to PostgreSQL.
 */
export async function syncAllTablesToPostgres(db: Db): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    // 1. Sync settings to ai_settings
    const settings = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    for (const s of settings) {
      await p.query(
        'INSERT INTO ai_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [s.key, s.value]
      );
    }

    // 2. Sync users to ai_users in batches
    const users = db.prepare('SELECT email, password_hash, mother_id, company_name FROM users').all() as any[];
    if (users.length > 0) {
      for (let i = 0; i < users.length; i += 50) {
        const batch = users.slice(i, i + 50);
        const valuePlaceholders: string[] = [];
        const params: any[] = [];
        batch.forEach((u, idx) => {
          const offset = idx * 4;
          valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
          params.push(u.email, u.password_hash, u.mother_id || null, u.company_name || null);
        });
        await p.query(
          `INSERT INTO ai_users (email, password_hash, mother_id, company_name)
           VALUES ${valuePlaceholders.join(', ')}
           ON CONFLICT (email) DO UPDATE SET
             password_hash = EXCLUDED.password_hash,
             mother_id = EXCLUDED.mother_id,
             company_name = EXCLUDED.company_name`,
          params
        );
      }
    }

    // 3. Sync tenant_api_keys to ai_tenant_api_keys in batches
    const tenantKeys = db.prepare('SELECT user_id, mother_id, api_key, company_name FROM tenant_api_keys').all() as any[];
    if (tenantKeys.length > 0) {
      for (let i = 0; i < tenantKeys.length; i += 50) {
        const batch = tenantKeys.slice(i, i + 50);
        const valuePlaceholders: string[] = [];
        const params: any[] = [];
        batch.forEach((tk, idx) => {
          const offset = idx * 4;
          valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
          params.push(tk.user_id ? Number(tk.user_id) : null, tk.mother_id, tk.api_key, tk.company_name || '');
        });
        await p.query(
          `INSERT INTO ai_tenant_api_keys (user_id, mother_id, api_key, company_name)
           VALUES ${valuePlaceholders.join(', ')}
           ON CONFLICT (api_key) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             mother_id = EXCLUDED.mother_id,
             company_name = EXCLUDED.company_name`,
          params
        );
      }
    }

    // 4. Sync api_keys to ai_api_keys
    const apiKeys = db.prepare('SELECT id, platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id FROM api_keys').all() as any[];
    for (const k of apiKeys) {
      const exists = await p.query('SELECT id, user_id FROM ai_api_keys WHERE id = $1', [k.id]);
      if (exists.rows.length === 0) {
        await p.query(
          `INSERT INTO ai_api_keys (id, platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             platform = EXCLUDED.platform,
             label = EXCLUDED.label,
             status = EXCLUDED.status,
             enabled = EXCLUDED.enabled`,
          [k.id, k.platform, k.label, k.encrypted_key, k.iv, k.auth_tag, k.status, k.enabled, k.mother_id || null, k.user_id ? Number(k.user_id) : null]
        );
      } else {
        const existingRow = exists.rows[0];
        // Only update if ownership matches; NEVER overwrite another user's key
        const isOwner = k.user_id
          ? Number(existingRow.user_id) === Number(k.user_id)
          : (existingRow.mother_id === k.mother_id && !existingRow.user_id);
        if (isOwner) {
          await p.query(
            `UPDATE ai_api_keys SET label = $1, status = $2, enabled = $3
             WHERE id = $4`,
            [k.label, k.status, k.enabled, k.id]
          );
        }
      }
    }

    // 5. Save database file snapshot for instant full-state restoration
    await saveSnapshotToPostgres(db);

    console.log('[PostgreSQL] Successfully synchronized tables to PostgreSQL with ai_ prefix.');
  } catch (err: any) {
    console.error('[PostgreSQL] Error syncing to PostgreSQL:', err.message);
  }
}

/**
 * Saves binary snapshot of local DB file to PostgreSQL ai_snapshots table.
 */
export async function saveSnapshotToPostgres(db: Db): Promise<void> {
  const p = getPostgresPool();
  if (!p || !db.name || db.name === ':memory:') return;

  try {
    if (fs.existsSync(db.name)) {
      const data = fs.readFileSync(db.name);
      await p.query(
        `INSERT INTO ai_snapshots (id, data, updated_at)
         VALUES ('latest', $1, NOW())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [data]
      );
    }
  } catch (err: any) {
    console.warn('[PostgreSQL] Could not save snapshot to PostgreSQL:', err.message);
  }
}

/**
 * Persists a user to PostgreSQL ai_users immediately.
 */
export async function persistUserToPostgres(user: { id?: number | null; email: string; password_hash: string; mother_id?: string; company_name?: string }): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    if (user.id) {
      await p.query(
        `INSERT INTO ai_users (id, email, password_hash, mother_id, company_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           id = EXCLUDED.id,
           password_hash = EXCLUDED.password_hash,
           mother_id = EXCLUDED.mother_id,
           company_name = EXCLUDED.company_name`,
        [user.id, user.email, user.password_hash, user.mother_id || null, user.company_name || null]
      );
    } else {
      await p.query(
        `INSERT INTO ai_users (email, password_hash, mother_id, company_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           mother_id = EXCLUDED.mother_id,
           company_name = EXCLUDED.company_name`,
        [user.email, user.password_hash, user.mother_id || null, user.company_name || null]
      );
    }
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist user to ai_users:', err.message);
  }
}

/**
 * Persists a tenant API key to PostgreSQL ai_tenant_api_keys immediately.
 */
export async function persistTenantKeyToPostgres(item: { user_id?: number | null; mother_id: string; api_key: string; company_name?: string }): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    await p.query(
      `INSERT INTO ai_tenant_api_keys (user_id, mother_id, api_key, company_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (api_key) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         mother_id = EXCLUDED.mother_id,
         company_name = EXCLUDED.company_name`,
      [item.user_id ? Number(item.user_id) : null, item.mother_id, item.api_key, item.company_name || '']
    );
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist tenant key:', err.message);
  }
}

/**
 * Persists an API key to PostgreSQL ai_api_keys immediately.
 * Returns the assigned PostgreSQL key ID.
 */
export async function persistApiKeyToPostgres(key: { id?: number; platform: string; label: string; encrypted_key: string; iv: string; auth_tag: string; status: string; enabled: number; mother_id?: string; user_id?: number | null }): Promise<number | null> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return null;

  try {
    const userIdNum = key.user_id ? Number(key.user_id) : null;
    const motherIdStr = key.mother_id || 'default';

    // If an existing PostgreSQL key ID is provided, ONLY update if it actually belongs to this user/tenant!
    if (key.id) {
      const exists = await p.query('SELECT id, user_id, mother_id FROM ai_api_keys WHERE id = $1', [key.id]);
      if (exists.rows.length > 0) {
        const row = exists.rows[0];
        const isOwner = userIdNum != null
          ? Number(row.user_id) === userIdNum
          : (row.mother_id === motherIdStr && row.user_id == null);

        if (isOwner) {
          await p.query(
            `UPDATE ai_api_keys SET label = $1, status = $2, enabled = $3, last_checked_at = NOW()
             WHERE id = $4`,
            [key.label, key.status, key.enabled, key.id]
          );
          return key.id;
        }
        // If key.id belongs to someone else, NEVER overwrite it! Treat as a new key insertion.
      }
    }

    // Check if THIS user already has the exact same key for this platform
    const duplicateQuery = userIdNum != null
      ? await p.query('SELECT id FROM ai_api_keys WHERE platform = $1 AND user_id = $2 AND encrypted_key = $3', [key.platform, userIdNum, key.encrypted_key])
      : await p.query('SELECT id FROM ai_api_keys WHERE platform = $1 AND mother_id = $2 AND user_id IS NULL AND encrypted_key = $3', [key.platform, motherIdStr, key.encrypted_key]);

    if (duplicateQuery.rows.length > 0) {
      const dupId = Number(duplicateQuery.rows[0].id);
      await p.query(
        `UPDATE ai_api_keys SET label = $1, status = $2, enabled = $3, last_checked_at = NOW()
         WHERE id = $4`,
        [key.label, key.status, key.enabled, dupId]
      );
      return dupId;
    }

    // Insert as a brand-new key in PostgreSQL, returning the real PostgreSQL ID
    const insertRes = await p.query(
      `INSERT INTO ai_api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [key.platform, key.label, key.encrypted_key, key.iv, key.auth_tag, key.status, key.enabled, motherIdStr, userIdNum]
    );

    return insertRes.rows.length > 0 ? Number(insertRes.rows[0].id) : null;
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist api key:', err.message);
    return null;
  }
}

/**
 * Updates an API key status in PostgreSQL ai_api_keys immediately.
 */
export async function persistApiKeyStatusToPostgres(keyId: number, status: string, lastError: string | null, isValid: boolean): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    if (isValid) {
      await p.query(
        `UPDATE ai_api_keys SET status = $1, last_health_error = $2, last_checked_at = NOW(), last_healthy_at = NOW() WHERE id = $3`,
        [status, lastError, keyId]
      );
    } else {
      await p.query(
        `UPDATE ai_api_keys SET status = $1, last_health_error = $2, last_checked_at = NOW() WHERE id = $3`,
        [status, lastError, keyId]
      );
    }
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist api key status:', err.message);
  }
}

/**
 * Updates an API key enabled toggle in PostgreSQL ai_api_keys immediately.
 */
export async function persistApiKeyEnabledToPostgres(keyId: number, enabled: number): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    await p.query('UPDATE ai_api_keys SET enabled = $1 WHERE id = $2', [enabled, keyId]);
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist api key enabled state:', err.message);
  }
}

/**
 * Deletes an API key from PostgreSQL ai_api_keys immediately.
 */
export async function deleteApiKeyFromPostgres(keyId: number): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    await p.query('DELETE FROM ai_api_keys WHERE id = $1', [keyId]);
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to delete api key from PostgreSQL:', err.message);
  }
}

/**
 * Persists a setting to PostgreSQL ai_settings immediately.
 */
export async function persistSettingToPostgres(key: string, value: string): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    await p.query(
      'INSERT INTO ai_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist setting:', err.message);
  }
}

/**
 * Starts periodic sync pump between local state and PostgreSQL.
 */
export function startPostgresSync(db: Db, intervalMs = 60000): void {
  if (!isPostgresConfigured()) return;

  const timer = setInterval(() => {
    void syncAllTablesToPostgres(db);
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();

  // On process exit, do one final sync
  const onExit = () => {
    void syncAllTablesToPostgres(db);
  };
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);
}

/**
 * Master initializer for PostgreSQL backend.
 */
export async function initPostgres(db: Db): Promise<void> {
  if (!isPostgresConfigured()) {
    console.log('[PostgreSQL] DATABASE_URL not set; running with local SQLite.');
    return;
  }

  await initPostgresSchema();
  await syncAllTablesFromPostgres(db);
  await syncAllTablesToPostgres(db);
  startPostgresSync(db);
}

