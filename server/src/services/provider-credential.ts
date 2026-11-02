import { getDb } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';
import { reserveMonthlyBudget } from './key-budget.js';
import { isCompanyUniversalKeys } from './tenant.js';

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
    keys = db.prepare(`
      SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
      WHERE id = ? AND enabled = 1 AND status IN ('healthy', 'unknown')
    `).all(row.key_id) as KeyRow[];
  } else {
    if (userId && (!motherId || motherId === 'default' || motherId === 'all')) {
      try {
        const tRow = db.prepare('SELECT mother_id FROM tenant_api_keys WHERE user_id = ? AND mother_id IS NOT NULL AND mother_id != \'default\' LIMIT 1').get(userId) as { mother_id: string } | undefined;
        if (tRow?.mother_id) motherId = tRow.mother_id;
      } catch {}
    }
    const isUniversal = motherId ? isCompanyUniversalKeys(motherId) : false;

    if (isUniversal && motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      try {
        keys = db.prepare(`
          SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
          WHERE platform = ? AND LOWER(mother_id) = LOWER(?) AND enabled = 1 AND status IN ('healthy', 'unknown')
          ORDER BY RANDOM()
        `).all(row.platform, motherId) as KeyRow[];
      } catch {}
    } else if (userId && motherId && motherId !== 'all' && motherId.toLowerCase() !== 'default') {
      try {
        keys = db.prepare(`
          SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
          WHERE platform = ? AND (user_id = ? OR (LOWER(mother_id) = LOWER(?) AND is_universal = 1)) AND enabled = 1 AND status IN ('healthy', 'unknown')
          ORDER BY (CASE WHEN user_id = ? THEN 0 ELSE 1 END), RANDOM()
        `).all(row.platform, userId, motherId, userId) as KeyRow[];
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
          WHERE platform = ? AND LOWER(mother_id) = LOWER(?) AND (user_id IS NULL OR is_universal = 1) AND enabled = 1 AND status IN ('healthy', 'unknown')
          ORDER BY RANDOM()
        `).all(row.platform, motherId) as KeyRow[];
      } catch {}
    }

    // 3. Fallback
    if (keys.length === 0) {
      keys = db.prepare(`
        SELECT id, encrypted_key, iv, auth_tag, base_url FROM api_keys
        WHERE platform = ? AND enabled = 1 AND status IN ('healthy', 'unknown')
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
