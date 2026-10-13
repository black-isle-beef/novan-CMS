import type { AdminConfig } from '@novan/admin-auth';

/** What a deployed admin's `config.js` sets (apps/admin/docker/entrypoint.sh). Public values only. */
export interface RuntimeConfig extends Partial<AdminConfig> {
  sentryDsn?: string;
  /** `staging` or `production`. */
  environment?: string;
  /** The commit SHA the image was built from. */
  release?: string;
}

declare global {
  // Set by config.js, which index.html loads before the app.
  var novanAdminConfig: RuntimeConfig | undefined;
}

/** The runtime settings config.js set; none in development. */
export function runtimeConfig(): RuntimeConfig {
  return globalThis.novanAdminConfig ?? {};
}

/** The build's settings, each overridden by its runtime value when that is not empty. */
export function adminConfig(defaults: AdminConfig, runtime: RuntimeConfig = runtimeConfig()): AdminConfig {
  return {
    supabaseUrl: runtime.supabaseUrl || defaults.supabaseUrl,
    supabaseAnonKey: runtime.supabaseAnonKey || defaults.supabaseAnonKey,
    apiUrl: runtime.apiUrl || defaults.apiUrl,
  };
}
