import { inject, Injectable } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_CONFIG } from './admin-config';

/**
 * The admin's only Supabase client (anon key). Used for auth here, and later for storage uploads
 * and realtime; all CMS data goes through the Novan API.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseClientService {
  private readonly config = inject(ADMIN_CONFIG);

  readonly client: SupabaseClient = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Invite, recovery and magic links return tokens in the URL fragment.
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  });
}
