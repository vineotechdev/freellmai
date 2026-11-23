import { getDb } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';
import { reserveMonthlyBudget } from './key-budget.js';
import { isCompanyUniversalKeys, isCompanyPrivateMode, resolveMotherIdForUser } from './tenant.js';

export interface ReservedProviderCredential {
  id: number;
  key: string;
  baseUrl: string | null;
  release: () => void;
}

interface KeyRow {
  id: number;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  base_url: string | null;
}

/** Select and reserve a credential for the independent embeddings/media routers.
 * Bound custom models stay on their own key; ordinary providers may use any
 * healthy key with room in its budget. Callers release after logging the result.
 */
export function reserveProviderCredential(
  row: { platform: string; key_id: number | null },
  estimatedTokens: number,
  skip: (keyId: number) => boolean = () => false,
  userId?: number | null,
  motherId?: string | null,
): { credential: ReservedProviderCredential | null; budgetBlocked: boolean } {
  if (row.platform === 'custom' && row.key_id == null) return { credential: null, budgetBlocked: false };
  const bound = row.key_id != null;
  const db = getDb();
  let keys: KeyRow[] = [];

  if (bound) {
    if (userId && (!motherId || motherId === 'default' || motherId === 'all')) {
      motherId = resolveMotherIdForUser(userId, motherId);
    }
    const isPrivate = motherId ? isCompanyPrivateMode(motherId) : false;
    let boundQuery = 'SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys WHERE id = ? AND enabled = 1 AND status IN (\'healthy\', \'unknown\')';
    const boundParams: any[] = [row.key_id];
    if (isPrivate && motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      boundQuery += ' AND LOWER(mother_id) = LOWER(?) AND is_universal = 1';
      boundParams.push(motherId);
    } else if (motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      boundQuery += ' AND (LOWER(mother_id) = LOWER(?) OR mother_id IS NULL OR mother_id = \'default\')';
      boundParams.push(motherId);
    }
    keys = db.prepare(boundQuery).all(...boundParams) as KeyRow[];
    // If bound key was personal or not universal, fall back to universal keys of company in Private Mode
    if (keys.length === 0 && isPrivate && motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      try {
        keys = db.prepare(`
          SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
          WHERE platform = ? AND LOWER(mother_id) = LOWER(?) AND is_universal = 1 AND enabled = 1 AND status IN ('healthy', 'unknown')
          ORDER BY RANDOM()
        `).all(row.platform, motherId) as KeyRow[];
      } catch {}
    }
  } else {
    if (userId && (!motherId || motherId === 'default' || motherId === 'all')) {
      motherId = resolveMotherIdForUser(userId, motherId);
    }
    const isPrivate = motherId ? isCompanyPrivateMode(motherId) : false;
    const isUniversal = isPrivate || (motherId ? isCompanyUniversalKeys(motherId) : false);

    if (isPrivate && motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      // In Private Mode, strictly pool ONLY Universal keys (is_universal = 1)
      try {
        keys = db.prepare(`
          SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
          WHERE platform = ? AND LOWER(mother_id) = LOWER(?) AND is_universal = 1 AND enabled = 1 AND status IN ('healthy', 'unknown')
          ORDER BY RANDOM()
        `).all(row.platform, motherId) as KeyRow[];
      } catch {}
    } else if (isUniversal && motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      try {
        if (userId) {
          keys = db.prepare(`
            SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
            WHERE platform = ? AND LOWER(mother_id) = LOWER(?) AND (user_id = ? OR is_universal = 1) AND enabled = 1 AND status IN ('healthy', 'unknown')
            ORDER BY (CASE WHEN user_id = ? THEN 0 ELSE 1 END), RANDOM()
          `).all(row.platform, motherId, userId, userId) as KeyRow[];
        } else {
          keys = db.prepare(`
            SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
            WHERE platform = ? AND LOWER(mother_id) = LOWER(?) AND enabled = 1 AND status IN ('healthy', 'unknown')
            ORDER BY is_universal DESC, RANDOM()
          `).all(row.platform, motherId) as KeyRow[];
        }
      } catch {}
    } else if (userId && motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      // Universal Mode is deactivated: user gets ONLY their own keys
      try {
        keys = db.prepare(`
          SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
          WHERE platform = ? AND LOWER(mother_id) = LOWER(?) AND user_id = ? AND enabled = 1 AND status IN ('healthy', 'unknown')
          ORDER BY RANDOM()
        `).all(row.platform, motherId, userId) as KeyRow[];
      } catch {}
    } else if (userId) {
      try {
        keys = db.prepare(`
          SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
          WHERE platform = ? AND user_id = ? AND enabled = 1 AND status IN ('healthy', 'unknown')
          ORDER BY RANDOM()
        `).all(row.platform, userId) as KeyRow[];
      } catch {}
    } else if (motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      try {
        keys = db.prepare(`
          SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
          WHERE platform = ? AND LOWER(mother_id) = LOWER(?) AND user_id IS NULL AND is_universal = 0 AND enabled = 1 AND status IN ('healthy', 'unknown')
          ORDER BY RANDOM()
        `).all(row.platform, motherId) as KeyRow[];
      } catch {}
    }

    // 3. Fallback only if no specific tenant was requested and NOT in private mode
    if (keys.length === 0 && !isPrivate && (!motherId || motherId === 'default' || motherId === 'all') && !userId) {
      keys = db.prepare(`
        SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
        WHERE platform = ? AND (mother_id IS NULL OR mother_id = 'default') AND enabled = 1 AND status IN ('healthy', 'unknown')
        ORDER BY RANDOM()
      `).all(row.platform) as KeyRow[];
    }
  }
  let budgetBlocked = false;
  for (const keyRow of keys) {
    if (skip(keyRow.id)) continue;
    let key: string;
    try {
      key = decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag);
    } catch {
      continue;
    }
    const reservation = reserveMonthlyBudget(keyRow.id, estimatedTokens);
    if (!reservation.allowed) { budgetBlocked = true; continue; }
    return {
      credential: {
        id: keyRow.id, key,
        baseUrl: keyRow.base_url?.trim().replace(/\/+$/, '') ?? null,
        release: reservation.release,
      },
      budgetBlocked,
    };
  }
  return { credential: null, budgetBlocked };
}
