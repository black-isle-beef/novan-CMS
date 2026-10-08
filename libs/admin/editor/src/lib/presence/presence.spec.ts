import { initials, isPresenceState, LOCK_TTL_MS, lockHolder, otherPeople, type PresenceState, presenceTopic } from './presence';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const state = (session: string, extra: Partial<PresenceState> = {}): PresenceState => ({
  session,
  userId: `user-${session}`,
  name: `Person ${session}`,
  editing: false,
  since: null,
  at: ago(1000),
  ...extra,
});

describe('presence', () => {
  it('names private topics by space and page', () => {
    expect(presenceTopic('s', 'e')).toBe('editor:s:e');
  });

  describe('lockHolder', () => {
    const me = state('me');

    it('is nobody when no one else is editing', () => {
      expect(lockHolder([state('a'), me], me, NOW)).toBeNull();
    });

    it('is someone else who is editing and still there', () => {
      const a = state('a', { editing: true, since: ago(5000) });
      expect(lockHolder([a, me], me, NOW)).toBe(a);
    });

    it('lets a lock lapse a minute after its last heartbeat', () => {
      const quiet = state('a', { editing: true, since: ago(LOCK_TTL_MS * 2), at: ago(LOCK_TTL_MS + 1) });
      expect(lockHolder([quiet, me], me, NOW)).toBeNull();
    });

    it('keeps the page for whoever started editing first, then the lower session', () => {
      const mine = state('me', { editing: true, since: ago(1000) });
      const earlier = state('a', { editing: true, since: ago(2000) });
      const later = state('b', { editing: true, since: ago(500) });
      expect(lockHolder([earlier, later, mine], mine, NOW)).toBe(earlier);
      expect(lockHolder([later, mine], mine, NOW)).toBeNull();
      const same = state('zz', { editing: true, since: mine.since });
      expect(lockHolder([same, mine], mine, NOW)).toBeNull();
    });
  });

  it('lists other people once each, editors first, leaving out my own other tabs', () => {
    const me = state('me', { userId: 'me' });
    const people = otherPeople(
      [me, state('my-other-tab', { userId: 'me' }), state('a1', { userId: 'ada', name: 'Ada' }), state('a2', { userId: 'ada', name: 'Ada', editing: true }), state('b', { userId: 'bo', name: 'Bo' })],
      me,
      NOW,
    );
    expect(people).toEqual([
      { userId: 'ada', name: 'Ada', editing: true },
      { userId: 'bo', name: 'Bo', editing: false },
    ]);
  });

  it.each([
    ['Ada Lovelace', 'AL'],
    ['client@novan.test', 'C'],
    ['mary-jane watson', 'MJ'],
    ['', ''],
  ])('initials of %s are %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it('ignores presence of the wrong shape', () => {
    expect(isPresenceState(state('a'))).toBe(true);
    expect(isPresenceState({ ...state('a'), at: 'yesterday' })).toBe(false);
    expect(isPresenceState({ presence_ref: 'x' })).toBe(false);
    expect(isPresenceState(null)).toBe(false);
  });
});
