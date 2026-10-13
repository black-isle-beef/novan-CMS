import { USER_CODE_ALPHABET } from '@novan/shared-schemas';
import { createHash, randomBytes, randomInt } from 'node:crypto';

/** 32 random bytes, base64url: 43 characters the CLI keeps secret. */
export function newDeviceCode(): string {
  return randomBytes(32).toString('base64url');
}

/** Eight consonants, picked without bias. */
export function newUserCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return code;
}

/** Device codes are stored only as their SHA-256, so a leaked table cannot be polled with. */
export function hashDeviceCode(deviceCode: string): string {
  return createHash('sha256').update(deviceCode).digest('hex');
}

/**
 * Counts calls per key in fixed one-minute windows, in memory (each API instance allows the limit on its own, as the
 * Delivery API's limits do). Answers false once a key has used its allowance.
 */
export class MinuteLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= 60_000) {
      if (this.windows.size > 10_000) this.prune(now);
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count++;
    return window.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) if (now - window.start >= 60_000) this.windows.delete(key);
  }
}
