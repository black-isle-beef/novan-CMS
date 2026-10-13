import { deviceTokenRequestSchema, formatUserCode, USER_CODE_ALPHABET, userCodeSchema } from '@novan/shared-schemas';
import { hashDeviceCode, MinuteLimiter, newDeviceCode, newUserCode } from './device-codes';

describe('device codes', () => {
  it('makes a 43-character device code the token route accepts', () => {
    const code = newDeviceCode();

    expect(code).toHaveLength(43);
    expect(deviceTokenRequestSchema.safeParse({ deviceCode: code }).success).toBe(true);
    expect(newDeviceCode()).not.toBe(code);
  });

  it('makes user codes of eight consonants that parse once formatted', () => {
    for (let i = 0; i < 50; i++) {
      const code = newUserCode();
      expect(code).toMatch(new RegExp(`^[${USER_CODE_ALPHABET}]{8}$`));
      expect(userCodeSchema.parse(formatUserCode(code).toLowerCase())).toBe(code);
    }
  });

  it('stores device codes only as a SHA-256 in hex', () => {
    const hash = hashDeviceCode('abc');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashDeviceCode('abc'));
    expect(hash).not.toBe(hashDeviceCode('abd'));
  });

  it('refuses a user code with vowels or the wrong length', () => {
    expect(userCodeSchema.safeParse('ABCD-EFGH').success).toBe(false);
    expect(userCodeSchema.safeParse('BCDF-GHJ').success).toBe(false);
  });
});

describe('MinuteLimiter', () => {
  it('allows the limit per key and minute, then starts again', () => {
    let now = 0;
    const limiter = new MinuteLimiter(2, () => now);

    expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([true, true, false]);
    expect(limiter.allow('b')).toBe(true);
    now = 60_000;
    expect(limiter.allow('a')).toBe(true);
  });
});
