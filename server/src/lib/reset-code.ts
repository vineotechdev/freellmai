import crypto from 'crypto';
import { createOneTimeCode } from './one-time-code.js';
import { getDb } from '../db/index.js';
import { getPostgresPool, isPostgresConfigured } from '../db/postgres.js';
import { sendPasswordResetEmail } from '../services/email.js';

// Legacy single-user one-time code for backward compatibility
const _legacyCode = createOneTimeCode();
const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_REQUEST_INTERVAL_MS = 30 * 1000; // 30 seconds rate-limit per email
let legacyMintedAtMs = 0;

function ensureResetTable(): void {
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reset_codes_email ON password_reset_codes(email);
    `);
  } catch (err: any) {
    console.warn('[ResetCode] Could not ensure password_reset_codes table:', err.message);
  }
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

/**
 * Creates a unique, secure 6-digit password reset code for a specific user email,
 * records it with a 15-minute expiration, and dispatches it via email.
 */
export async function createPasswordResetCode(email: string): Promise<{ success: boolean; code: string; message?: string }> {
  ensureResetTable();
  const normalized = email.trim().toLowerCase();
  const db = getDb();

  // Check rate limit: ensure at least MIN_REQUEST_INTERVAL_MS between requests
  try {
    const recent = db.prepare(`
      SELECT expires_at FROM password_reset_codes
      WHERE email = ? AND used = 0
      ORDER BY id DESC LIMIT 1
    `).get(normalized) as { expires_at: number } | undefined;

    if (recent) {
      const remainingTime = recent.expires_at - Date.now();
      const elapsedSinceCreation = RESET_CODE_TTL_MS - remainingTime;
      if (elapsedSinceCreation >= 0 && elapsedSinceCreation < MIN_REQUEST_INTERVAL_MS) {
        const waitSeconds = Math.ceil((MIN_REQUEST_INTERVAL_MS - elapsedSinceCreation) / 1000);
        return {
          success: false,
          code: '',
          message: `Please wait ${waitSeconds}s before requesting another reset code.`,
        };
      }
    }
  } catch {}

  // Generate a random 6-digit verification code
  const code = crypto.randomInt(100000, 999999).toString();
  const hashed = hashCode(code);
  const expiresAt = Date.now() + RESET_CODE_TTL_MS;

  // Invalidate any older unused codes for this email
  try {
    db.prepare('UPDATE password_reset_codes SET used = 1 WHERE email = ? AND used = 0').run(normalized);
    db.prepare(`
      INSERT INTO password_reset_codes (email, code_hash, expires_at, used)
      VALUES (?, ?, ?, 0)
    `).run(normalized, hashed, expiresAt);
  } catch (err: any) {
    console.error('[ResetCode] Failed to record reset code in local DB:', err.message);
  }

  // Also persist to PostgreSQL if configured
  if (isPostgresConfigured()) {
    try {
      const pool = getPostgresPool();
      if (pool) {
        await pool.query('UPDATE password_reset_codes SET used = 1 WHERE email = $1 AND used = 0', [normalized]);
        await pool.query(
          'INSERT INTO password_reset_codes (email, code_hash, expires_at, used) VALUES ($1, $2, $3, 0)',
          [normalized, hashed, expiresAt]
        );
      }
    } catch (pgErr: any) {
      console.warn('[ResetCode] Could not persist reset code to PostgreSQL:', pgErr.message);
    }
  }

  // Dispatch email to user
  await sendPasswordResetEmail(normalized, code);

  return { success: true, code };
}

/**
 * Validates a submitted reset code for a given user email.
 * If valid, marks the code as used so it cannot be replayed.
 */
export async function verifyPasswordResetCode(
  email: string,
  providedCode: string
): Promise<{ valid: boolean; error?: string }> {
  ensureResetTable();
  const normalized = email.trim().toLowerCase();
  const cleanCode = (providedCode || '').trim();

  if (!cleanCode) {
    return { valid: false, error: 'Reset code is required' };
  }

  const db = getDb();
  const hashed = hashCode(cleanCode);

  let record: { id: number; expires_at: number; used: number } | undefined;

  try {
    record = db.prepare(`
      SELECT id, expires_at, used FROM password_reset_codes
      WHERE email = ? AND code_hash = ? AND used = 0
      ORDER BY id DESC LIMIT 1
    `).get(normalized, hashed) as any;
  } catch (err: any) {
    console.error('[ResetCode] Query failed:', err.message);
  }

  // Fallback check against PostgreSQL if record not found in local DB
  if (!record && isPostgresConfigured()) {
    try {
      const pool = getPostgresPool();
      if (pool) {
        const pgRes = await pool.query(
          'SELECT id, expires_at, used FROM password_reset_codes WHERE email = $1 AND code_hash = $2 AND used = 0 ORDER BY id DESC LIMIT 1',
          [normalized, hashed]
        );
        if (pgRes.rows.length > 0) {
          record = pgRes.rows[0];
        }
      }
    } catch {}
  }

  if (!record) {
    return { valid: false, error: 'Invalid or expired reset code' };
  }

  if (Date.now() > Number(record.expires_at)) {
    return { valid: false, error: 'Reset code has expired. Please request a new code.' };
  }

  // Mark as used
  try {
    db.prepare('UPDATE password_reset_codes SET used = 1 WHERE id = ?').run(record.id);
  } catch {}

  if (isPostgresConfigured()) {
    try {
      const pool = getPostgresPool();
      if (pool) {
        await pool.query('UPDATE password_reset_codes SET used = 1 WHERE email = $1 AND code_hash = $2', [normalized, hashed]);
      }
    } catch {}
  }

  return { valid: true };
}

// -------------------------------------------------------------
// Backward Compatibility for Single-User Legacy CLI / Tests
// -------------------------------------------------------------

export function generateResetCode(accountEmail?: string | null): string {
  const code = _legacyCode.generate();
  legacyMintedAtMs = Date.now();
  console.log('');
  console.log('  Password-reset code: ' + code);
  if (accountEmail) console.log('  Account email: ' + accountEmail);
  console.log('  Enter this code on the reset form to set a new password.');
  console.log('');
  return code;
}

export function getResetCode(): string | null {
  return _legacyCode.get();
}

export function clearResetCode(): void {
  _legacyCode.clear();
  legacyMintedAtMs = 0;
}

export function resetCodeMatches(provided: unknown): boolean {
  if (!legacyMintedAtMs) return false;
  if (Date.now() - legacyMintedAtMs > RESET_CODE_TTL_MS) {
    clearResetCode();
    return false;
  }
  return _legacyCode.matches(provided);
}
