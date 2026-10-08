import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { AuthService } from '@novan/admin-auth';
import { ManagementApi } from '@novan/admin-spaces';
import { firstValueFrom } from 'rxjs';
import { HEARTBEAT_MS, lockHolder, otherPeople, type PresenceState, presenceTopic } from './presence';
import { type PresenceChannel, PRESENCE_TRANSPORT } from './presence-transport';

/** How often lock expiry is checked, so a page frees up soon after a holder goes quiet. */
const TICK_MS = 5000;

/**
 * Presence and soft locks for one page in the visual editor (docs/build/12-visual-editor.md, 12c): who else
 * has it open, and whether one of them is changing it. While someone else is editing, this tab is read-only
 * until they leave or their lock expires ({@link LOCK_TTL_MS} after their last heartbeat or change). Provide one
 * per editor page.
 */
@Injectable()
export class EditorPresence {
  private readonly transport = inject(PRESENCE_TRANSPORT);
  private readonly auth = inject(AuthService);
  private readonly management = inject(ManagementApi);
  private readonly session = crypto.randomUUID();
  private channel: PresenceChannel | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;

  private readonly states = signal<PresenceState[]>([]);
  private readonly me = signal<PresenceState | null>(null);
  private readonly clock = signal(Date.now());

  /** The time, refreshed every few seconds, so expiring locks are noticed. */
  readonly now = this.clock.asReadonly();
  /** The other people on the page, once each, those editing first. */
  readonly others = computed(() => otherPeople(this.states(), this.me(), this.now()));
  /** Someone else changing the page; null when this tab may edit. */
  readonly lockedBy = computed(() => lockHolder(this.states(), this.me(), this.now()));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Joins the page's channel; `start` again for another page. */
  async start(spaceId: string, entryId: string): Promise<void> {
    this.stop();
    const userId = this.auth.claims()?.sub ?? '';
    const name = await this.displayName();
    const topic = presenceTopic(spaceId, entryId);
    this.me.set({ session: this.session, userId, name, editing: false, since: null, at: new Date().toISOString() });
    this.channel = this.transport.join(topic, this.session, (states) => this.states.set(states));
    this.send();
    this.heartbeat = setInterval(() => this.send(), HEARTBEAT_MS);
    this.tick = setInterval(() => this.clock.set(Date.now()), TICK_MS);
  }

  /** Says whether this tab is changing the page; each change renews the lock. */
  editing(editing: boolean): void {
    const me = this.me();
    if (!me) return;
    const since = editing ? (me.since ?? new Date().toISOString()) : null;
    this.me.set({ ...me, editing, since });
    this.send();
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.tick) clearInterval(this.tick);
    this.heartbeat = this.tick = null;
    this.channel?.leave();
    this.channel = null;
    this.states.set([]);
  }

  private send(): void {
    const me = this.me();
    if (!me || !this.channel) return;
    const now = Date.now();
    const current = { ...me, at: new Date(now).toISOString() };
    this.me.set(current);
    this.clock.set(now);
    this.channel.track(current);
  }

  /** The name others see: the profile's display name, else the email address. */
  private async displayName(): Promise<string> {
    try {
      const me = await firstValueFrom(this.management.me());
      return me.displayName?.trim() || me.email || 'Someone';
    } catch {
      return this.auth.email() ?? 'Someone';
    }
  }
}
