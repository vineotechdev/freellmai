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
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL || '';
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
    connectionTimeoutMillis: 10000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err) => {
    console.error('[PostgreSQL] Unexpected error on idle client:', err.message);
  });

  return pool;
}

/**
 * Initializes the PostgreSQL schema and creates all tables if they do not exist.
 */
export async function initPostgresSchema(): Promise<void> {
  const p = getPostgresPool();
  if (!p) return;

  try {
    const versionRes = await p.query('SELECT version()');
    const versionStr = versionRes.rows[0]?.version?.split(' ')?.[1] || versionRes.rows[0]?.version || 'unknown';
    console.log(`[PostgreSQL] Connected successfully to PostgreSQL (Version: ${versionStr})`);

    // Create necessary relational tables in PostgreSQL
    await p.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        mother_id TEXT,
        company_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS mother_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
      DROP INDEX IF EXISTS idx_users_mother_id;
      CREATE INDEX IF NOT EXISTS idx_users_mother_id ON users(mother_id) WHERE mother_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS tenant_api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        mother_id TEXT NOT NULL,
        api_key TEXT NOT NULL UNIQUE,
        company_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE tenant_api_keys DROP CONSTRAINT IF EXISTS tenant_api_keys_mother_id_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_api_keys_user_id ON tenant_api_keys(user_id) WHERE user_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS api_keys (
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
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS mother_id TEXT;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMPTZ;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_health_error TEXT;
      CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS requests (
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

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at_ms BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS models (
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

      CREATE TABLE IF NOT EXISTS freellmai_snapshots (
        id TEXT PRIMARY KEY,
        data BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_reset_codes_email ON password_reset_codes(email);
    `);

    isInitialized = true;
    console.log('[PostgreSQL] Database tables initialized and verified.');
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
    // 1. Sync settings from PostgreSQL
    const settingsRes = await p.query('SELECT key, value FROM settings');
    for (const row of settingsRes.rows) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(row.key, row.value);
    }

    // 2. Sync users from PostgreSQL
    const usersRes = await p.query('SELECT id, email, password_hash, mother_id, company_name, created_at FROM users');
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

    // 3. Sync tenant_api_keys from PostgreSQL
    const tenantRes = await p.query('SELECT user_id, mother_id, api_key, company_name, created_at FROM tenant_api_keys');
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

    // 4. Sync api_keys from PostgreSQL
    const keysRes = await p.query('SELECT id, platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id, last_healthy_at, last_health_error, created_at FROM api_keys');
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
 * Pushes all active tables from local DB to PostgreSQL.
 */
export async function syncAllTablesToPostgres(db: Db): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    // 1. Sync settings
    const settings = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    for (const s of settings) {
      await p.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [s.key, s.value]
      );
    }

    // 2. Sync users
    const users = db.prepare('SELECT email, password_hash, mother_id, company_name FROM users').all() as any[];
    for (const u of users) {
      await p.query(
        `INSERT INTO users (email, password_hash, mother_id, company_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           mother_id = EXCLUDED.mother_id,
           company_name = EXCLUDED.company_name`,
        [u.email, u.password_hash, u.mother_id || null, u.company_name || null]
      );
    }

    // 3. Sync tenant_api_keys
    const tenantKeys = db.prepare('SELECT user_id, mother_id, api_key, company_name FROM tenant_api_keys').all() as any[];
    for (const tk of tenantKeys) {
      await p.query(
        `INSERT INTO tenant_api_keys (user_id, mother_id, api_key, company_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (api_key) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           mother_id = EXCLUDED.mother_id,
           company_name = EXCLUDED.company_name`,
        [tk.user_id ? Number(tk.user_id) : null, tk.mother_id, tk.api_key, tk.company_name || '']
      );
    }

    // 4. Sync api_keys
    const apiKeys = db.prepare('SELECT platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id FROM api_keys').all() as any[];
    for (const k of apiKeys) {
      const exists = await p.query('SELECT id FROM api_keys WHERE platform = $1 AND encrypted_key = $2', [k.platform, k.encrypted_key]);
      if (exists.rows.length === 0) {
        await p.query(
          `INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [k.platform, k.label, k.encrypted_key, k.iv, k.auth_tag, k.status, k.enabled, k.mother_id || null, k.user_id ? Number(k.user_id) : null]
        );
      } else {
        await p.query(
          `UPDATE api_keys SET label = $1, status = $2, enabled = $3, mother_id = $4, user_id = $5
           WHERE platform = $6 AND encrypted_key = $7`,
          [k.label, k.status, k.enabled, k.mother_id || null, k.user_id ? Number(k.user_id) : null, k.platform, k.encrypted_key]
        );
      }
    }

    // 5. Save database file snapshot for instant full-state restoration
    await saveSnapshotToPostgres(db);

    console.log('[PostgreSQL] Successfully synchronized tables to PostgreSQL.');
  } catch (err: any) {
    console.error('[PostgreSQL] Error syncing to PostgreSQL:', err.message);
  }
}

/**
 * Saves binary snapshot of local DB file to PostgreSQL freellmai_snapshots table.
 */
export async function saveSnapshotToPostgres(db: Db): Promise<void> {
  const p = getPostgresPool();
  if (!p || !db.name || db.name === ':memory:') return;

  try {
    if (fs.existsSync(db.name)) {
      const data = fs.readFileSync(db.name);
      await p.query(
        `INSERT INTO freellmai_snapshots (id, data, updated_at)
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
 * Persists a user to PostgreSQL immediately.
 */
export async function persistUserToPostgres(user: { id?: number | null; email: string; password_hash: string; mother_id?: string; company_name?: string }): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    if (user.id) {
      await p.query(
        `INSERT INTO users (id, email, password_hash, mother_id, company_name)
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
        `INSERT INTO users (email, password_hash, mother_id, company_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           mother_id = EXCLUDED.mother_id,
           company_name = EXCLUDED.company_name`,
        [user.email, user.password_hash, user.mother_id || null, user.company_name || null]
      );
    }
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist user:', err.message);
  }
}

/**
 * Persists a tenant API key to PostgreSQL immediately.
 */
export async function persistTenantKeyToPostgres(item: { user_id?: number | null; mother_id: string; api_key: string; company_name?: string }): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    await p.query(
      `INSERT INTO tenant_api_keys (user_id, mother_id, api_key, company_name)
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
 * Persists an API key to PostgreSQL immediately.
 */
export async function persistApiKeyToPostgres(key: { id?: number; platform: string; label: string; encrypted_key: string; iv: string; auth_tag: string; status: string; enabled: number; mother_id?: string; user_id?: number | null }): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    const exists = key.id
      ? await p.query('SELECT id FROM api_keys WHERE id = $1', [key.id])
      : await p.query('SELECT id FROM api_keys WHERE platform = $1 AND encrypted_key = $2', [key.platform, key.encrypted_key]);

    if (exists.rows.length === 0) {
      if (key.id) {
        await p.query(
          `INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             platform = EXCLUDED.platform,
             label = EXCLUDED.label,
             encrypted_key = EXCLUDED.encrypted_key,
             iv = EXCLUDED.iv,
             auth_tag = EXCLUDED.auth_tag,
             status = EXCLUDED.status,
             enabled = EXCLUDED.enabled,
             mother_id = EXCLUDED.mother_id,
             user_id = EXCLUDED.user_id`,
          [key.id, key.platform, key.label, key.encrypted_key, key.iv, key.auth_tag, key.status, key.enabled, key.mother_id || null, key.user_id ? Number(key.user_id) : null]
        );
      } else {
        await p.query(
          `INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled, mother_id, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [key.platform, key.label, key.encrypted_key, key.iv, key.auth_tag, key.status, key.enabled, key.mother_id || null, key.user_id ? Number(key.user_id) : null]
        );
      }
    } else {
      const targetId = exists.rows[0].id;
      await p.query(
        `UPDATE api_keys SET label = $1, status = $2, enabled = $3, mother_id = $4, user_id = $5
         WHERE id = $6`,
        [key.label, key.status, key.enabled, key.mother_id || null, key.user_id ? Number(key.user_id) : null, targetId]
      );
    }
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist api key:', err.message);
  }
}

/**
 * Updates an API key status in PostgreSQL immediately.
 */
export async function persistApiKeyStatusToPostgres(keyId: number, status: string, lastError: string | null, isValid: boolean): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    if (isValid) {
      await p.query(
        `UPDATE api_keys SET status = $1, last_health_error = $2, last_checked_at = NOW(), last_healthy_at = NOW() WHERE id = $3`,
        [status, lastError, keyId]
      );
    } else {
      await p.query(
        `UPDATE api_keys SET status = $1, last_health_error = $2, last_checked_at = NOW() WHERE id = $3`,
        [status, lastError, keyId]
      );
    }
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist api key status:', err.message);
  }
}

/**
 * Updates an API key enabled toggle in PostgreSQL immediately.
 */
export async function persistApiKeyEnabledToPostgres(keyId: number, enabled: number): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    await p.query('UPDATE api_keys SET enabled = $1 WHERE id = $2', [enabled, keyId]);
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to persist api key enabled state:', err.message);
  }
}

/**
 * Deletes an API key from PostgreSQL immediately.
 */
export async function deleteApiKeyFromPostgres(keyId: number): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    await p.query('DELETE FROM api_keys WHERE id = $1', [keyId]);
  } catch (err: any) {
    console.error('[PostgreSQL] Failed to delete api key from PostgreSQL:', err.message);
  }
}

/**
 * Persists a setting to PostgreSQL immediately.
 */
export async function persistSettingToPostgres(key: string, value: string): Promise<void> {
  const p = getPostgresPool();
  if (!p || !isInitialized) return;

  try {
    await p.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
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

