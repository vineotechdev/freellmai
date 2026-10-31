import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { timingSafeStringEqual } from '../lib/system-prompt.js';
import { LLMAI_CONSTANTS } from '../constants/llmai_constant.js';
import { persistTenantKeyToPostgres } from '../db/postgres.js';

export interface PolarQrValidationResult {
  valid: boolean;
  motherId?: string | number | null;
  companyName?: string | null;
  qrCode?: string;
  registrationUrl?: string | null;
  isActive?: boolean | null;
  message?: string;
}

/**
 * Extracts clean QR code if user pasted a full URL or raw code.
 * e.g. "https://my.polarlist.in/register?qrCode=PLQR-c0bc463a-88a3-4cc0-a83b-3f9cd6ab873b"
 * -> "PLQR-c0bc463a-88a3-4cc0-a83b-3f9cd6ab873b"
 */
export function extractQrCode(rawInput: string): string {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return '';

  if (trimmed.includes('qrCode=') || trimmed.includes('code=')) {
    try {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://dummy.com/${trimmed}`);
      const code = url.searchParams.get('qrCode') || url.searchParams.get('code');
      if (code) return code.trim();
    } catch {
      // fallback regex
    }
    const match = trimmed.match(/(?:qrCode|code)=([^&\s]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]).trim();
  }

  return trimmed;
}

/**
 * Call Polar backend internally in Node.js to validate the QR / Scan code
 * and obtain motherId, companyName, etc.
 */
export async function validatePolarQrCode(rawCode: string): Promise<PolarQrValidationResult> {
  const code = extractQrCode(rawCode);
  if (!code) {
    return {
      valid: false,
      message: 'Polar QR code or Scan Key is required',
    };
  }

  const endpointUrl = LLMAI_CONSTANTS.POLAR_QR_VALIDATE_URL;
  const url = new URL(endpointUrl);
  url.searchParams.set('code', code);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: LLMAI_CONSTANTS.POLAR_API_HEADERS,
    });

    if (!response.ok) {
      return {
        valid: false,
        message: `Polar verification service responded with status ${response.status}`,
      };
    }

    const data = await response.json() as any;
    const isValid = Boolean(data.valid);

    return {
      valid: isValid,
      motherId: data.motherId != null ? String(data.motherId) : null,
      companyName: data.companyName ? String(data.companyName).trim() : null,
      qrCode: data.qrCode || code,
      registrationUrl: data.registrationUrl || data.registration_url || null,
      isActive: data.isActive != null ? Boolean(data.isActive) : null,
      message: data.message || (isValid ? `Valid scan code for ${data.companyName || 'Company'}` : 'Invalid scan code'),
    };
  } catch (err: any) {
    return {
      valid: false,
      message: `Failed to contact Polar verification service: ${err.message || 'Network error'}`,
    };
  }
}

/**
 * Secondary security check executed strictly in Node.js backend:
 * Verifies code format, prevents injections, checks company active status,
 * and ensures only legitimate PolarList verified company tenants can proceed with registration.
 */
export function verifyPolarQrSecurityCheck(
  rawCode: string,
  qrResult: PolarQrValidationResult
): { ok: boolean; reason?: string; motherId?: string; companyName?: string } {
  const code = extractQrCode(rawCode);

  if (!code || typeof code !== 'string') {
    return { ok: false, reason: 'PolarList QR code or scan token is required.' };
  }

  // 1. Length and character boundaries to prevent malicious injection
  if (code.length < 6 || code.length > 128) {
    return { ok: false, reason: 'Invalid PolarList QR code length.' };
  }

  // Disallow suspicious injection patterns
  if (/[\r\n\t<>"';`\0]/.test(code)) {
    return { ok: false, reason: 'Suspicious characters detected in QR code payload.' };
  }

  // 2. Upstream Polar verification result check
  if (!qrResult.valid) {
    return {
      ok: false,
      reason: qrResult.message || 'PolarList QR code verification failed. Access denied.',
    };
  }

  // 3. Polar tenant active status check
  if (qrResult.isActive === false) {
    return {
      ok: false,
      reason: 'This company tenant account or QR code has been deactivated in PolarList.',
    };
  }

  // 4. Mother ID integrity check
  const rawMotherId = qrResult.motherId != null ? String(qrResult.motherId).trim() : '';
  if (!rawMotherId || rawMotherId.length < 1 || rawMotherId === '0') {
    return {
      ok: false,
      reason: 'No valid PolarList Mother ID associated with this QR code.',
    };
  }

  // Must only contain alphanumeric and safe characters
  if (!/^[a-zA-Z0-9_-]+$/.test(rawMotherId)) {
    return {
      ok: false,
      reason: 'PolarList Mother ID format is invalid or contains prohibited characters.',
    };
  }

  // 5. Company Name integrity check
  const rawCompanyName = qrResult.companyName ? qrResult.companyName.trim() : '';
  if (!rawCompanyName || rawCompanyName.length < 2) {
    return {
      ok: false,
      reason: 'No valid PolarList Company Name associated with this QR code.',
    };
  }

  return {
    ok: true,
    motherId: normalizeMotherId(rawMotherId),
    companyName: rawCompanyName,
  };
}

export function normalizeMotherId(id: string): string {
  return id.trim().toUpperCase();
}

export function getJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
  if (envSecret && envSecret.trim().length > 0) return envSecret.trim();
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get() as { value: string } | undefined;
    if (row && row.value) return row.value;
  } catch {
    // ignore
  }
  return 'a8f3c9d2b7e14f6a9c3e5d8f1a2b4c6d7e9f0a1b3c5d7e8f9a0b2c4d6e8f1a3';
}

export function signJwtToken(payload: {
  userId: number;
  email: string;
  motherId: string;
  companyName: string;
  roles?: string;
  designation?: string;
}): string {
  const normMotherId = normalizeMotherId(payload.motherId);
  const normalizedEmail = payload.email.trim().toLowerCase();
  const motherIdVal = isNaN(Number(normMotherId)) ? normMotherId : Number(normMotherId);

  // Exact claim structure matching PolarList backend JwtTokenProvider.java
  const claims: Record<string, any> = {
    sub: String(payload.userId),
    userId: payload.userId,
    mother_id: motherIdVal,
    motherId: normMotherId,
    email: normalizedEmail,
    companyName: payload.companyName || 'Default Company',
    company_name: payload.companyName || 'Default Company',
    type: 'access',
    tv: 0,
    base_url: 'https://polardata.polarlist.in',
    roles: payload.roles || 'ROLE_USER,ROLE_ADMIN',
  };
  if (payload.designation) {
    claims.designation = payload.designation;
  }

  return jwt.sign(claims, getJwtSecret(), { expiresIn: '30d' });
}

export interface ResolvedTenant {
  motherId: string;
  companyName: string;
  userId?: number;
  apiKey?: string;
}

/**
 * Retrieves or generates a user-specific unified API key.
 * Format: polar_<safeMotherId>_u<userId>_<randomHex>
 */
export function getUserApiKey(userId: number, motherId: string = 'default', companyName: string = 'Default Company'): string {
  const normId = normalizeMotherId(motherId);
  const db = getDb();

  const existing = db.prepare('SELECT api_key FROM tenant_api_keys WHERE user_id = ?').get(userId) as { api_key: string } | undefined;
  if (existing?.api_key) {
    if (existing.api_key.startsWith('flm_')) {
      const migratedKey = existing.api_key.replace(/^flm_/, 'polar_');
      try {
        db.prepare('UPDATE tenant_api_keys SET api_key = ? WHERE user_id = ?').run(migratedKey, userId);
        void persistTenantKeyToPostgres({ user_id: userId, mother_id: normId, api_key: migratedKey, company_name: companyName.trim() });
      } catch (err: any) {
        console.error('[Tenant] Failed to migrate flm_ key to polar_:', err.message);
      }
      return migratedKey;
    }
    return existing.api_key;
  }

  const safePrefix = normId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const generatedKey = `polar_${safePrefix}_u${userId}_${crypto.randomBytes(20).toString('hex')}`;

  try {
    db.prepare(`
      INSERT INTO tenant_api_keys (user_id, mother_id, api_key, company_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(api_key) DO NOTHING
    `).run(userId, normId, generatedKey, companyName.trim());
  } catch {
    // If tenant_api_keys still has old schema without user_id column
    try {
      db.prepare(`
        INSERT INTO tenant_api_keys (mother_id, api_key, company_name)
        VALUES (?, ?, ?)
        ON CONFLICT(mother_id) DO UPDATE SET api_key = excluded.api_key
      `).run(normId, generatedKey, companyName.trim());
    } catch {}
  }

  void persistTenantKeyToPostgres({ user_id: userId, mother_id: normId, api_key: generatedKey, company_name: companyName.trim() });

  return generatedKey;
}

/**
 * Regenerates a user-specific unified API key.
 */
export function regenerateUserApiKey(userId: number, motherId: string = 'default', companyName: string = 'Default Company'): string {
  const normId = normalizeMotherId(motherId);
  const db = getDb();

  const safePrefix = normId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const generatedKey = `polar_${safePrefix}_u${userId}_${crypto.randomBytes(20).toString('hex')}`;

  try {
    const existing = db.prepare('SELECT id FROM tenant_api_keys WHERE user_id = ?').get(userId);
    if (existing) {
      db.prepare('UPDATE tenant_api_keys SET api_key = ?, mother_id = ?, company_name = ? WHERE user_id = ?')
        .run(generatedKey, normId, companyName.trim(), userId);
    } else {
      db.prepare(`
        INSERT INTO tenant_api_keys (user_id, mother_id, api_key, company_name)
        VALUES (?, ?, ?, ?)
      `).run(userId, normId, generatedKey, companyName.trim());
    }
  } catch {
    // Legacy fallback
    try {
      db.prepare(`
        INSERT INTO tenant_api_keys (mother_id, api_key, company_name)
        VALUES (?, ?, ?)
        ON CONFLICT(mother_id) DO UPDATE SET api_key = excluded.api_key, company_name = excluded.company_name
      `).run(normId, generatedKey, companyName.trim());
    } catch {}
  }

  void persistTenantKeyToPostgres({ user_id: userId, mother_id: normId, api_key: generatedKey, company_name: companyName.trim() });

  return generatedKey;
}

export function getTenantApiKey(motherId: string, companyName: string = 'Default Company'): string {
  const normId = normalizeMotherId(motherId);
  const db = getDb();

  const existing = db.prepare('SELECT api_key FROM tenant_api_keys WHERE mother_id = ?').get(normId) as { api_key: string } | undefined;
  if (existing?.api_key) {
    if (existing.api_key.startsWith('flm_')) {
      // Migrate legacy flm_ prefix to polar_
      const migratedKey = existing.api_key.replace(/^flm_/, 'polar_');
      try {
        db.prepare('UPDATE tenant_api_keys SET api_key = ? WHERE mother_id = ?').run(migratedKey, normId);
        void persistTenantKeyToPostgres({ mother_id: normId, api_key: migratedKey, company_name: companyName.trim() });
      } catch (err: any) {
        console.error('[Tenant] Failed to migrate flm_ key to polar_:', err.message);
      }
      return migratedKey;
    }
    return existing.api_key;
  }

  const safePrefix = normId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const generatedKey = `polar_${safePrefix}_${crypto.randomBytes(20).toString('hex')}`;

  try {
    db.prepare(`
      INSERT INTO tenant_api_keys (mother_id, api_key, company_name)
      VALUES (?, ?, ?)
      ON CONFLICT(mother_id) DO UPDATE SET api_key = excluded.api_key
    `).run(normId, generatedKey, companyName.trim());
  } catch {
    try {
      db.prepare(`
        INSERT INTO tenant_api_keys (mother_id, api_key, company_name)
        VALUES (?, ?, ?)
      `).run(normId, generatedKey, companyName.trim());
    } catch {}
  }

  void persistTenantKeyToPostgres({ mother_id: normId, api_key: generatedKey, company_name: companyName.trim() });

  return generatedKey;
}

export function regenerateTenantApiKey(motherId: string, companyName: string = 'Default Company'): string {
  const normId = normalizeMotherId(motherId);
  const db = getDb();

  const safePrefix = normId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const generatedKey = `polar_${safePrefix}_${crypto.randomBytes(20).toString('hex')}`;

  try {
    db.prepare(`
      INSERT INTO tenant_api_keys (mother_id, api_key, company_name)
      VALUES (?, ?, ?)
      ON CONFLICT(mother_id) DO UPDATE SET api_key = excluded.api_key, company_name = excluded.company_name
    `).run(normId, generatedKey, companyName.trim());
  } catch {
    try {
      db.prepare(`
        UPDATE tenant_api_keys SET api_key = ?, company_name = ? WHERE mother_id = ?
      `).run(generatedKey, companyName.trim(), normId);
    } catch {}
  }

  void persistTenantKeyToPostgres({ mother_id: normId, api_key: generatedKey, company_name: companyName.trim() });

  return generatedKey;
}

export function resolveTenantFromApiKey(token: string | undefined): ResolvedTenant | null {
  if (!token) return null;
  const trimmed = token.trim();
  const db = getDb();

  // 1. JWT Token Check: extract user details, auto-lookup user by email, and extract user unified key
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
      if (decoded && (decoded.email || decoded.mother_id || decoded.motherId || decoded.sub || decoded.userId)) {
        let user: { id: number; email: string; mother_id?: string; company_name?: string } | undefined;
        const normEmail = decoded.email ? decoded.email.trim().toLowerCase() : null;

        if (normEmail) {
          try {
            user = db.prepare('SELECT id, email, mother_id, company_name FROM users WHERE email = ?')
              .get(normEmail) as { id: number; email: string; mother_id?: string; company_name?: string } | undefined;
          } catch {}

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
        }

        const effectiveUserId = user ? user.id : (decoded.sub ? parseInt(decoded.sub, 10) : (decoded.userId ? Number(decoded.userId) : undefined));
        const effectiveMotherId = normalizeMotherId(String((user && user.mother_id) || decoded.mother_id || decoded.motherId || 'default'));
        const effectiveCompanyName = (user && user.company_name) || decoded.companyName || decoded.company_name || 'Default Company';

        // Extract the user's unified key from email / user record
        const apiKey = effectiveUserId
          ? getUserApiKey(effectiveUserId, effectiveMotherId, effectiveCompanyName)
          : getTenantApiKey(effectiveMotherId, effectiveCompanyName);

        return {
          motherId: effectiveMotherId,
          companyName: effectiveCompanyName,
          userId: effectiveUserId,
          apiKey,
        };
      }
    } catch {
      // not a valid JWT or expired
    }
  }

  // 2. Exact match in tenant_api_keys
  try {
    const row = db.prepare('SELECT user_id, mother_id, company_name FROM tenant_api_keys WHERE api_key = ?')
      .get(trimmed) as { user_id?: number | null; mother_id: string; company_name: string } | undefined;
    if (row) {
      return {
        motherId: normalizeMotherId(row.mother_id),
        companyName: row.company_name || 'Default Company',
        userId: row.user_id != null ? Number(row.user_id) : undefined,
        apiKey: trimmed,
      };
    }
  } catch {}

  // 3. User-specific prefix: polar_<motherid>_u<userId>_<secret> or legacy flm_<motherid>_u<userId>_<secret>
  if (trimmed.startsWith('polar_') || trimmed.startsWith('flm_')) {
    const userMatch = trimmed.match(/^(?:polar|flm)_([a-zA-Z0-9_-]+)_u(\d+)_[a-f0-9]+$/);
    if (userMatch) {
      const candidateMotherId = normalizeMotherId(userMatch[1]);
      const candidateUserId = parseInt(userMatch[2], 10);
      try {
        const row = db.prepare('SELECT user_id, mother_id, company_name FROM tenant_api_keys WHERE user_id = ?')
          .get(candidateUserId) as { user_id?: number | null; mother_id: string; company_name: string } | undefined;
        if (row) {
          return {
            motherId: normalizeMotherId(row.mother_id),
            companyName: row.company_name || candidateMotherId,
            userId: candidateUserId,
          };
        }
      } catch {}
      return {
        motherId: candidateMotherId,
        companyName: candidateMotherId,
        userId: candidateUserId,
      };
    }

    // Legacy tenant prefix match: polar_<motherid>_<secret>
    const match = trimmed.match(/^(?:polar|flm)_([a-zA-Z0-9_-]+)_[a-f0-9]+$/);
    if (match) {
      const candidateMotherId = normalizeMotherId(match[1]);
      try {
        const row = db.prepare('SELECT user_id, mother_id, company_name FROM tenant_api_keys WHERE mother_id = ? LIMIT 1')
          .get(candidateMotherId) as { user_id?: number | null; mother_id: string; company_name: string } | undefined;
        if (row) {
          return {
            motherId: normalizeMotherId(row.mother_id),
            companyName: row.company_name || 'Default Company',
            userId: row.user_id != null ? Number(row.user_id) : undefined,
          };
        }
      } catch {}
      return {
        motherId: candidateMotherId,
        companyName: candidateMotherId,
      };
    }
  }

  // 4. Legacy Global Unified Key fallback
  try {
    const globalKey = getUnifiedApiKey();
    if (globalKey && timingSafeStringEqual(trimmed, globalKey)) {
      return {
        motherId: 'default',
        companyName: 'Default Company',
      };
    }
  } catch {}

  return null;
}

