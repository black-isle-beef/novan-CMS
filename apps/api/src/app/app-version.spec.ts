import { DEV_VERSION, resolveAppVersion } from './app-version';

describe('resolveAppVersion', () => {
  it('prefers APP_VERSION when set', () => {
    expect(resolveAppVersion({ APP_VERSION: '2026.10.1' })).toBe('2026.10.1');
  });

  it('falls back to the dev version locally', () => {
    expect(resolveAppVersion({})).toBe(DEV_VERSION);
  });
});
