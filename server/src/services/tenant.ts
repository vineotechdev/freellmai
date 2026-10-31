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
  return 'polarlist_freellmapi_jwt_secret_token_secure_key_2026';
}

export function signJwtToken(payload: { userId: number; email: string; motherId: string; companyName: string }): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });
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

  db.prepare(`
    INSERT INTO tenant_api_keys (mother_id, api_key, company_name)
    VALUES (?, ?, ?)
    ON CONFLICT(mother_id) DO UPDATE SET api_key = excluded.api_key
  `).run(normId, generatedKey, companyName.trim());

  void persistTenantKeyToPostgres({ mother_id: normId, api_key: generatedKey, company_name: companyName.trim() });

  return generatedKey;
}

export function regenerateTenantApiKey(motherId: string, companyName: string = 'Default Company'): string {
  const normId = normalizeMotherId(motherId);
  const db = getDb();

  const safePrefix = normId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const generatedKey = `polar_${safePrefix}_${crypto.randomBytes(20).toString('hex')}`;

  db.prepare(`
    INSERT INTO tenant_api_keys (mother_id, api_key, company_name)
    VALUES (?, ?, ?)
    ON CONFLICT(mother_id) DO UPDATE SET api_key = excluded.api_key, company_name = excluded.company_name
  `).run(normId, generatedKey, companyName.trim());

  void persistTenantKeyToPostgres({ mother_id: normId, api_key: generatedKey, company_name: companyName.trim() });

  return generatedKey;
}

export function resolveTenantFromApiKey(token: string | undefined): { motherId: string; companyName: string } | null {
  if (!token) return null;
  const trimmed = token.trim();

  // 1. JWT Token Check
  if (trimmed.split('.').length === 3) {
    try {
      const decoded = jwt.verify(trimmed, getJwtSecret()) as {
        userId: number;
        email: string;
        motherId?: string;
        companyName?: string;
      };
      if (decoded && (decoded.motherId || decoded.userId)) {
        return {
          motherId: decoded.motherId ? normalizeMotherId(decoded.motherId) : 'default',
          companyName: decoded.companyName || 'Default Company',
        };
      }
    } catch {
      // not a valid JWT or expired
    }
  }

  const db = getDb();

  // 2. Exact match in tenant_api_keys
  try {
    const row = db.prepare('SELECT mother_id, company_name FROM tenant_api_keys WHERE api_key = ?')
      .get(trimmed) as { mother_id: string; company_name: string } | undefined;
    if (row) {
      return {
        motherId: normalizeMotherId(row.mother_id),
        companyName: row.company_name || 'Default Company',
      };
    }
  } catch {}

  // 3. Prefix polar_<motherid>_<secret> or legacy flm_<motherid>_<secret> match
  if (trimmed.startsWith('polar_') || trimmed.startsWith('flm_')) {
    const match = trimmed.match(/^(?:polar|flm)_([a-zA-Z0-9_-]+)_[a-f0-9]+$/);
    if (match) {
      const candidateMotherId = normalizeMotherId(match[1]);
      try {
        const row = db.prepare('SELECT mother_id, company_name FROM tenant_api_keys WHERE mother_id = ?')
          .get(candidateMotherId) as { mother_id: string; company_name: string } | undefined;
        if (row) {
          return {
            motherId: normalizeMotherId(row.mother_id),
            companyName: row.company_name || 'Default Company',
          };
        }
      } catch {}
      // If valid format, accept tenant ID
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

