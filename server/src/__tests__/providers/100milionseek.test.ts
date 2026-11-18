import { describe, it, expect } from 'vitest';
import { getProvider } from '../../providers/index.js';
import { detectPlatform, parseKeysFromFile } from '../../lib/key-parser.js';

describe('100milionseek provider', () => {
  it('registers 100milionseek in provider registry', () => {
    const provider = getProvider('100milionseek');
    expect(provider).toBeDefined();
    expect(provider?.name).toBe('100milionseek');
    expect(provider?.platform).toBe('100milionseek');
  });

  it('detects platform from env prefixes', () => {
    expect(detectPlatform('HMS_')).toBe('100milionseek');
    expect(detectPlatform('100MILIONSEEK_')).toBe('100milionseek');
    expect(detectPlatform('HUNDREDMILIONSEEK_')).toBe('100milionseek');
  });

  it('parses .env lines containing HMS_KEY and 100MILIONSEEK_KEY', () => {
    const content = [
      'HMS_KEY=hms-samplekey1234567890',
      '100MILIONSEEK_KEY=hms-samplekey987654321',
    ].join('\n');
    const { keys, skipped } = parseKeysFromFile(content, '.env');
    expect(skipped).toHaveLength(0);
    expect(keys).toHaveLength(2);
    expect(keys[0].platform).toBe('100milionseek');
    expect(keys[1].platform).toBe('100milionseek');
  });
});
