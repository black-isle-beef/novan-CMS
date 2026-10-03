import { Injectable } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client with the service-role key, for Auth admin calls (invites). API server only:
 * the key must never reach the admin app, the SDK or a client site.
 */
@Injectable()
export class SupabaseAdmin {
  private client?: SupabaseClient;

  get auth(): SupabaseClient['auth']['admin'] {
    return this.getClient().auth.admin;
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      const url = process.env['SUPABASE_URL'];
      const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
      if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)');
      this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    return this.client;
  }
}
