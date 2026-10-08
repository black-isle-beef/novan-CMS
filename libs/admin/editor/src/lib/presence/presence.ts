/** What one open copy of the visual editor says about itself on the page's presence channel. */
export interface PresenceState {
  /** One per browser tab, so two tabs of the same person are told apart. */
  session: string;
  userId: string;
  name: string;
  /** Changing the page: unsaved changes, or a change within the last {@link LOCK_TTL_MS}. */
  editing: boolean;
  /** When this tab started editing (ISO), the tie-break between two who start at once. */
  since: string | null;
  /** The last heartbeat (ISO). */
  at: string;
}

/** A lock is held this long after the holder's last heartbeat or change. */
export const LOCK_TTL_MS = 60_000;
/** Each tab says it is still there this often. */
export const HEARTBEAT_MS = 20_000;

/** The private channel of one page (supabase/migrations/0010_editor_presence.sql). */
export function presenceTopic(spaceId: string, entryId: string): string {
  return `editor:${spaceId}:${entryId}`;
}

/** Whether `state` is editing and was heard from recently enough to hold the page. */
function holding(state: PresenceState, now: number): boolean {
  return state.editing && now - Date.parse(state.at) < LOCK_TTL_MS;
}

/**
 * Who holds the soft lock on the page, when it is not `me`: another tab that is editing and still there. When
 * both are editing, the one that started first keeps the page (then the lower session id), so two people who
 * start together do not both carry on.
 */
export function lockHolder(states: readonly PresenceState[], me: PresenceState | null, now: number): PresenceState | null {
  const contenders = states.filter((state) => state.session !== me?.session && holding(state, now));
  if (me && holding(me, now)) contenders.push(me);
  contenders.sort(
    (a, b) => Date.parse(a.since ?? a.at) - Date.parse(b.since ?? b.at) || (a.session < b.session ? -1 : a.session > b.session ? 1 : 0),
  );
  const holder = contenders[0];
  return holder && holder.session !== me?.session ? holder : null;
}

/** The other people on the page, once each (a person with two tabs is one), editors first. */
export function otherPeople(states: readonly PresenceState[], me: PresenceState | null, now: number): { userId: string; name: string; editing: boolean }[] {
  const people = new Map<string, { userId: string; name: string; editing: boolean }>();
  for (const state of states) {
    if (state.session === me?.session || state.userId === me?.userId) continue;
    const known = people.get(state.userId);
    const editing = holding(state, now) || (known?.editing ?? false);
    people.set(state.userId, { userId: state.userId, name: state.name, editing });
  }
  return [...people.values()].sort((a, b) => Number(b.editing) - Number(a.editing) || a.name.localeCompare(b.name));
}

/** Up to two initials: "Ada Lovelace" gives AL, "client@novan.test" gives C. */
export function initials(name: string): string {
  const words = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/** Whether a value read from the channel is a {@link PresenceState}; anything else is ignored. */
export function isPresenceState(value: unknown): value is PresenceState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state['session'] === 'string' &&
    typeof state['userId'] === 'string' &&
    typeof state['name'] === 'string' &&
    typeof state['editing'] === 'boolean' &&
    (state['since'] === null || typeof state['since'] === 'string') &&
    typeof state['at'] === 'string' &&
    !Number.isNaN(Date.parse(state['at']))
  );
}
