import { inject, Injectable } from '@angular/core';
import { AuthClient } from '@supabase/auth-js';
import { ADMIN_CONFIG } from './admin-config';

/**
 * The admin's Supabase Auth client (anon key). It is the Auth part of `supabase-js` on its own, so the
 * initial bundle carries no database, storage or realtime client; the media library creates its own storage
 * client when it loads. All CMS data goes through the Novan API.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseClientService {
  private readonly config = inject(ADMIN_CONFIG);

  readonly auth = new AuthClient({
    url: `${this.config.supabaseUrl.replace(/\/+$/, '')}/auth/v1`,
    headers: { apikey: this.config.supabaseAnonKey, Authorization: `Bearer ${this.config.supabaseAnonKey}` },
    // The key `supabase-js` uses, so sessions saved before this change still sign people in.
    storageKey: `sb-${new URL(this.config.supabaseUrl).hostname.split('.')[0]}-auth-token`,
    persistSession: true,
    autoRefreshToken: true,
    // Invite, recovery and magic links return tokens in the URL fragment.
    detectSessionInUrl: true,
    flowType: 'implicit',
  });
}
