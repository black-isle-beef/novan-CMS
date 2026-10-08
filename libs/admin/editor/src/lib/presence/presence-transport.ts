import { inject, Injectable, InjectionToken } from '@angular/core';
import { ADMIN_CONFIG, AuthService } from '@novan/admin-auth';
import type { RealtimeClient } from '@supabase/realtime-js';
import { isPresenceState, type PresenceState } from './presence';

/** A joined presence channel. */
export interface PresenceChannel {
  /** Says (again) what this tab is doing; sent once the channel is joined. */
  track(state: PresenceState): void;
  leave(): void;
}

/** How the editor joins a page's presence channel. */
export interface PresenceTransport {
  /** Joins `topic`; `onSync` gets everyone there (this tab included) whenever that changes. */
  join(topic: string, key: string, onSync: (states: PresenceState[]) => void): PresenceChannel;
}

/**
 * Presence over Supabase Realtime, on private channels that only members of the page's space can join
 * (RLS on `realtime.messages`). The Realtime client is loaded when the visual editor first needs it, so other
 * admin screens never download it, and it uses the signed-in person's access token.
 */
@Injectable({ providedIn: 'root' })
export class RealtimePresenceTransport implements PresenceTransport {
  private readonly config = inject(ADMIN_CONFIG);
  private readonly auth = inject(AuthService);
  private client: Promise<RealtimeClient> | null = null;

  join(topic: string, key: string, onSync: (states: PresenceState[]) => void): PresenceChannel {
    let latest: PresenceState | null = null;
    let joined = false;
    let left = false;
    let channel: ReturnType<RealtimeClient['channel']> | null = null;

    void this.realtime().then(async (client) => {
      // The join must carry the person's token, not the anon key, or RLS refuses the private channel.
      await client.setAuth();
      if (left) return;
      channel = client.channel(topic, { config: { private: true, presence: { key } } });
      channel.on('presence', { event: 'sync' }, () => {
        const state = channel?.presenceState() ?? {};
        onSync((Object.values(state).flat() as unknown[]).filter(isPresenceState));
      });
      // audit-ignore Manual RxJS subscription: joins a Supabase Realtime channel, not RxJS
      channel.subscribe((status) => {
        joined = status === 'SUBSCRIBED';
        if (joined && latest) void channel?.track({ ...latest });
      });
    });

    return {
      track: (state) => {
        latest = state;
        if (joined) void channel?.track({ ...state });
      },
      leave: () => {
        left = true;
        if (channel) void channel.unsubscribe();
      },
    };
  }

  private realtime(): Promise<RealtimeClient> {
    this.client ??= import('@supabase/realtime-js').then(({ RealtimeClient }) => {
      const url = `${this.config.supabaseUrl.replace(/\/+$/, '')}/realtime/v1`;
      return new RealtimeClient(url, {
        params: { apikey: this.config.supabaseAnonKey },
        accessToken: async () => this.auth.accessToken(),
      });
    });
    return this.client;
  }
}

/** The presence transport: Supabase Realtime, unless a test provides another. */
export const PRESENCE_TRANSPORT = new InjectionToken<PresenceTransport>('PRESENCE_TRANSPORT', {
  providedIn: 'root',
  factory: () => inject(RealtimePresenceTransport),
});
