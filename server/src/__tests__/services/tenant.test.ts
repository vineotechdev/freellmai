import { beforeAll, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import {
  getTenantApiKey,
  regenerateTenantApiKey,
  resolveTenantFromApiKey,
} from '../../services/tenant.js';

describe('Tenant API Key Service', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('generates an API key starting with polar_ prefix', () => {
    const key = getTenantApiKey('4141:9490', 'Test Company');
    expect(key).toMatch(/^polar_4141_9490_[a-f0-9]{40}$/);
  });

  it('regenerates an API key starting with polar_ prefix', () => {
    const oldKey = getTenantApiKey('4141:9490', 'Test Company');
    const newKey = regenerateTenantApiKey('4141:9490', 'Test Company');
    expect(newKey).toMatch(/^polar_4141_9490_[a-f0-9]{40}$/);
    expect(newKey).not.toBe(oldKey);
  });

  it('resolves tenant from a polar_ API key', () => {
    const key = getTenantApiKey('company_abc', 'Company ABC');
    const resolved = resolveTenantFromApiKey(key);
    expect(resolved).not.toBeNull();
    expect(resolved?.motherId).toBe('COMPANY_ABC');
  });

  it('automatically migrates an existing flm_ key to polar_', () => {
    const db = getDb();
    const legacyKey = 'flm_legacy_tenant_0123456789abcdef0123456789abcdef01234567';
    db.prepare(`
      INSERT INTO tenant_api_keys (mother_id, api_key, company_name)
      VALUES ('LEGACY_TENANT', ?, 'Legacy Company')
      ON CONFLICT(mother_id) DO UPDATE SET api_key = excluded.api_key
    `).run(legacyKey);

    const migrated = getTenantApiKey('legacy_tenant', 'Legacy Company');
    expect(migrated).toBe('polar_legacy_tenant_0123456789abcdef0123456789abcdef01234567');
    expect(migrated.startsWith('polar_')).toBe(true);

    // Verify it was updated in the DB
    const row = db.prepare('SELECT api_key FROM tenant_api_keys WHERE mother_id = ?').get('LEGACY_TENANT') as { api_key: string };
    expect(row.api_key).toBe(migrated);
  });

  it('still resolves a legacy flm_ key for backward compatibility', () => {
    const legacyKey = 'flm_some_mother_0123456789abcdef0123456789abcdef01234567';
    const resolved = resolveTenantFromApiKey(legacyKey);
    expect(resolved).not.toBeNull();
    expect(resolved?.motherId).toBe('SOME_MOTHER');
  });
});
