import { provideErrorReporting } from '../app/error-reporting';
import { adminConfig, runtimeConfig } from './runtime-config';

const defaults = {
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'local-anon',
  apiUrl: 'http://localhost:3000',
};

describe('adminConfig', () => {
  it("keeps the build's settings when config.js sets nothing (development)", () => {
    expect(adminConfig(defaults, {})).toEqual(defaults);
  });

  it("takes a deployed container's settings over the build's", () => {
    const runtime = {
      supabaseUrl: 'https://ref.supabase.co',
      supabaseAnonKey: 'prod-anon',
      apiUrl: 'https://api.example.com',
    };

    expect(adminConfig(defaults, runtime)).toEqual(runtime);
  });

  it('ignores empty runtime values', () => {
    expect(adminConfig(defaults, { supabaseUrl: '', apiUrl: 'https://api.example.com' })).toEqual({
      ...defaults,
      apiUrl: 'https://api.example.com',
    });
  });

  it('reads what config.js set on the global object', () => {
    globalThis.novanAdminConfig = { apiUrl: 'https://api.example.com' };
    try {
      expect(runtimeConfig()).toEqual({ apiUrl: 'https://api.example.com' });
    } finally {
      delete globalThis.novanAdminConfig;
    }
    expect(runtimeConfig()).toEqual({});
  });
});

describe('provideErrorReporting', () => {
  it('provides nothing without a Sentry DSN', () => {
    expect(provideErrorReporting({})).toEqual([]);
    expect(provideErrorReporting({ sentryDsn: '' })).toEqual([]);
  });
});
