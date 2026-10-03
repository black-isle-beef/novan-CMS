import { InjectionToken } from '@angular/core';

/** Public runtime settings for the admin. Never holds the service-role key. */
export interface AdminConfig {
  supabaseUrl: string;
  /** Public anon key: safe in the browser, RLS decides what it can reach. */
  supabaseAnonKey: string;
  /** Novan API origin, e.g. `http://localhost:3000`. Requests to it carry the access token. */
  apiUrl: string;
}

export const ADMIN_CONFIG = new InjectionToken<AdminConfig>('ADMIN_CONFIG');
