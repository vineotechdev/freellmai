import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { getJwtSecret, getTenantApiKey, getUserApiKey, normalizeMotherId } from './tenant.js';
import { persistUserToPostgres } from '../db/postgres.js';

// Dashboard authentication: email + password accounts with JWT & session
// tokens. Multi-tenant support with mother_id and company_name.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  userId: number;
  email: string;
  motherId: string;
  companyName: string;
  qrCode?: string | null;
}

export interface CreateUserInput {
  email: string;
  password: string;
  motherId?: string;
  companyName?: string;
  qrCode?: string;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** The one spelling of an address the DB is keyed on. Exported so callers that
 *  bucket by email (the login throttle in routes/auth.ts) key on exactly what
 *  verifyCredentials will look up — keying on anything else lets a padded
 *  address authenticate against the real row while landing in its own bucket. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function userCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  return row.c;
}

/** Create a user. Supports multi-tenant (motherId, companyName). Throws { code: 'email_taken' } if the email already exists for tenant. */
export function createUser(inputOrEmail: CreateUserInput | string, legacyPassword?: string): SessionUser {
  const db = getDb();
  let email = '';
  let password = '';
  let motherId = 'default';
  let companyName = 'Default Company';
  let qrCode: string | null = null;

  if (typeof inputOrEmail === 'string') {
    email = inputOrEmail;
    password = legacyPassword || '';
  } else {
    email = inputOrEmail.email;
    password = inputOrEmail.password;
    motherId = inputOrEmail.motherId ? normalizeMotherId(inputOrEmail.motherId) : 'default';
    companyName = inputOrEmail.companyName ? inputOrEmail.companyName.trim() : 'Default Company';
    qrCode = inputOrEmail.qrCode ? inputOrEmail.qrCode.trim() : null;
  }

  const normalized = normalizeEmail(email);
  const normalizedMotherId = normalizeMotherId(motherId);

  // 1. Enforce unique Email constraint: An email address can only belong to one user account
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existingEmail) {
    const err = new Error('An account with that email already exists') as any;
    err.code = 'email_taken';
    throw err;
  }

  // Ensure qr_code column exists if missing
  try {
    const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'qr_code')) {
      db.prepare('ALTER TABLE users ADD COLUMN qr_code TEXT').run();
    }
  } catch {}

  // Ensure unique email index and mother_id lookup index on users table
  try {
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)').run();
    db.prepare('DROP INDEX IF EXISTS idx_users_mother_id').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_users_mother_id ON users(mother_id)').run();
  } catch {}

  let result;
  const passHash = hashPassword(password);
  try {
    result = db.prepare('INSERT INTO users (mother_id, company_name, qr_code, email, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(normalizedMotherId, companyName, qrCode, normalized, passHash);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint failed: users.email') || err.message?.includes('idx_users_email')) {
      const e = new Error('An account with that email already exists') as any;
      e.code = 'email_taken';
      throw e;
    }
    try {
      result = db.prepare('INSERT INTO users (mother_id, company_name, email, password_hash) VALUES (?, ?, ?, ?)')
        .run(normalizedMotherId, companyName, normalized, passHash);
    } catch (err2: any) {
      if (err2.message?.includes('UNIQUE constraint failed: users.email') || err2.message?.includes('idx_users_email')) {
        const e = new Error('An account with that email already exists') as any;
        e.code = 'email_taken';
        throw e;
      }
      throw err2;
    }
  }

  const userId = Number(result.lastInsertRowid);
  // Ensure tenant API key exists
  getTenantApiKey(normalizedMotherId, companyName);

  // Persist user to PostgreSQL
  void persistUserToPostgres({ email: normalized, password_hash: passHash, mother_id: normalizedMotherId, company_name: companyName });

  return { userId, email: normalized, motherId: normalizedMotherId, companyName, qrCode };
}

/** Verify credentials. Returns the user on success, null on failure. Supports optional motherId. */
export function verifyCredentials(email: string, password: string, motherId?: string): SessionUser | null {
  const db = getDb();
  let row: { id: number; email: string; password_hash: string; mother_id?: string; company_name?: string } | undefined;

  if (motherId && motherId.trim()) {
    row = db.prepare('SELECT id, email, password_hash, mother_id, company_name FROM users WHERE email = ? AND mother_id = ?')
      .get(normalizeEmail(email), normalizeMotherId(motherId)) as any;
  } else {
    row = db.prepare('SELECT id, email, password_hash, mother_id, company_name FROM users WHERE email = ? ORDER BY id DESC LIMIT 1')
      .get(normalizeEmail(email)) as any;
  }

  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return {
    userId: row.id,
    email: row.email,
    motherId: row.mother_id || 'default',
    companyName: row.company_name || 'Default Company',
  };
}

/** Desktop app only: a session for the install's account, creating the hidden
 *  machine account (`desktop@localhost`, random password nobody knows) on first
 *  run. The desktop window gets this over IPC; a browser tab on the same
 *  machine gets it from POST /api/auth/desktop-session (routes/auth.ts). */
export function desktopSessionToken(): string {
  if (userCount() === 0) {
    createUser('desktop@localhost', crypto.randomBytes(24).toString('hex'));
  }
  const first = getDb().prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get() as { id: number };
  return createSession(first.id);
}

/** Mint a session and return the raw token (only the hash is persisted). */
export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  getDb().prepare('INSERT INTO sessions (token_hash, user_id, expires_at_ms) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

/** Resolve a session or JWT token to its user, or null if missing/expired. */
export function validateSession(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const trimmed = token.trim();
  const db = getDb();
  const tokenHash = sha256(trimmed);

  // Check if token was explicitly revoked / logged out
  try {
    const revoked = db.prepare('SELECT user_id, expires_at_ms FROM sessions WHERE token_hash = ?').get(tokenHash) as { user_id: number; expires_at_ms: number } | undefined;
    if (revoked && (revoked.user_id === -1 || revoked.expires_at_ms <= Date.now())) {
      return null;
    }
  } catch {
    // ignore
  }

  // 1. JWT verification (stateless for serverless multi-instance support)
  if (trimmed.split('.').length === 3) {
    try {
      const decoded = jwt.verify(trimmed, getJwtSecret()) as {
        sub?: string;
        userId?: number;
        email?: string;
        mother_id?: number | string;
        motherId?: string;
        companyName?: string;
        company_name?: string;
      };
      if (decoded && decoded.email) {
        const normEmail = normalizeEmail(decoded.email);
        let user: { id: number; email: string; mother_id?: string; company_name?: string } | undefined;
        try {
          user = db.prepare('SELECT id, email, mother_id, company_name FROM users WHERE email = ?')
            .get(normEmail) as { id: number; email: string; mother_id?: string; company_name?: string } | undefined;
        } catch {
          // ignore
        }

        // Auto-provision user record if token originated from PolarList backend
        if (!user) {
          const rawMotherId = decoded.mother_id || decoded.motherId || 'default';
          const motherId = normalizeMotherId(String(rawMotherId));
          const companyName = (decoded.companyName || decoded.company_name || 'PolarList User').trim();
          let parsedUserId = decoded.sub ? parseInt(decoded.sub, 10) : (decoded.userId ? Number(decoded.userId) : null);
          try {
            if (parsedUserId && !isNaN(parsedUserId)) {
              db.prepare('INSERT INTO users (id, mother_id, company_name, email, password_hash) VALUES (?, ?, ?, ?, ?)').run(
                parsedUserId,
                motherId,
                companyName,
                normEmail,
                'external_jwt_auth'
              );
            } else {
              const res = db.prepare('INSERT INTO users (mother_id, company_name, email, password_hash) VALUES (?, ?, ?, ?)').run(
                motherId,
                companyName,
                normEmail,
                'external_jwt_auth'
              );
              parsedUserId = Number(res.lastInsertRowid);
            }
            user = { id: parsedUserId, email: normEmail, mother_id: motherId, company_name: companyName };
          } catch {
            user = db.prepare('SELECT id, email, mother_id, company_name FROM users WHERE email = ?').get(normEmail) as any;
          }
        }

        const effectiveUserId = user ? user.id : (decoded.sub ? parseInt(decoded.sub, 10) : (decoded.userId || 1));
        const effectiveMotherId = (user && user.mother_id) || normalizeMotherId(String(decoded.mother_id || decoded.motherId || 'default'));
        const effectiveCompanyName = (user && user.company_name) || decoded.companyName || decoded.company_name || 'Default Company';

        try { getTenantApiKey(effectiveMotherId, effectiveCompanyName); } catch {}
        try { getUserApiKey(effectiveUserId, effectiveMotherId, effectiveCompanyName); } catch {}
        void persistUserToPostgres({ email: normEmail, password_hash: 'external_jwt_auth', mother_id: effectiveMotherId, company_name: effectiveCompanyName });

        return {
          userId: effectiveUserId,
          email: normEmail,
          motherId: effectiveMotherId,
          companyName: effectiveCompanyName,
        };
      }
    } catch {
      // invalid or expired jwt, proceed to session check
    }
  }

  // 2. Legacy session token check
  try {
    const row = db.prepare(`
      SELECT s.user_id, s.expires_at_ms, u.email, u.mother_id, u.company_name
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash) as { user_id: number; expires_at_ms: number; email: string; mother_id?: string; company_name?: string } | undefined;
    if (!row) return null;
    if (row.expires_at_ms < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return {
      userId: row.user_id,
      email: row.email,
      motherId: row.mother_id || 'default',
      companyName: row.company_name || 'Default Company',
    };
  } catch {
    return null;
  }
}

export function deleteSession(token: string | undefined | null): void {
  if (!token) return;
  const db = getDb();
  const tokenHash = sha256(token.trim());
  try {
    const defaultUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: number } | undefined;
    if (defaultUser) {
      db.prepare(`
        INSERT INTO sessions (token_hash, user_id, expires_at_ms)
        VALUES (?, ?, 0)
        ON CONFLICT(token_hash) DO UPDATE SET expires_at_ms = 0
      `).run(tokenHash, defaultUser.id);
    }
  } catch {
    // ignore
  }
}

/** Update the email of the authenticated user after verifying the current password. Throws { code: 'email_taken' } on conflict. */
export function updateEmail(userId: number, currentPassword: string, newEmail: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(userId) as { password_hash: string } | undefined;
  if (!row) return false;
  if (!verifyPassword(currentPassword, row.password_hash)) return false;

  const normalized = normalizeEmail(newEmail);
  const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalized, userId);
  if (existing) {
    const err = new Error('An account with that email already exists') as any;
    err.code = 'email_taken';
    throw err;
  }
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(normalized, userId);
  // Keep sessions alive; the new email will be reflected on the next validateSession call.
  return true;
}

/** Update the password of the authenticated user after verifying the current one. Invalidates all sessions on success. */
export function updatePassword(userId: number, currentPassword: string, newPassword: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(userId) as { password_hash: string } | undefined;
  if (!row) return false;
  if (!verifyPassword(currentPassword, row.password_hash)) return false;
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return true;
}

/** The single account's email, or null before first-run setup. */
export function accountEmail(): string | null {
  const row = getDb().prepare('SELECT email FROM users LIMIT 1').get() as { email: string } | undefined;
  return row?.email ?? null;
}

/**
 * Reset the password for a user (by email, or the single existing user) and invalidate all
 * sessions.
 * Returns the user, or null if no user exists.
 */
export function resetUserPassword(newPassword: string, targetEmail?: string): SessionUser | null {
  const db = getDb();
  let row: { id: number; email: string; mother_id?: string; company_name?: string } | undefined;

  if (targetEmail && targetEmail.trim()) {
    const norm = normalizeEmail(targetEmail);
    row = db.prepare('SELECT id, email, mother_id, company_name FROM users WHERE email = ?').get(norm) as any;
  } else {
    row = db.prepare('SELECT id, email, mother_id, company_name FROM users ORDER BY id DESC LIMIT 1').get() as any;
  }

  if (!row) return null;
  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, row.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);

  // Persist updated password to PostgreSQL
  void persistUserToPostgres({
    email: row.email,
    password_hash: newHash,
    mother_id: row.mother_id,
    company_name: row.company_name,
  });

  return {
    userId: row.id,
    email: row.email,
    motherId: row.mother_id || 'default',
    companyName: row.company_name || 'Default Company',
  };
}
