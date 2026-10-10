import { formatUk, fromUkDateTime, ukDateTime } from './uk-time';

describe('UK time', () => {
  it('reads summer times as BST and winter times as GMT', () => {
    expect(fromUkDateTime('2026-07-01', '09:00')?.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(fromUkDateTime('2026-12-01', '09:00')?.toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });

  it('refuses a time skipped when the clocks go forward, and malformed input', () => {
    expect(fromUkDateTime('2026-03-29', '01:30')).toBeNull();
    expect(fromUkDateTime('2026-03-29', '02:30')?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(fromUkDateTime('2026-02-30', '09:00')).toBeNull();
    expect(fromUkDateTime('', '09:00')).toBeNull();
    expect(fromUkDateTime('2026-07-01', '9am')).toBeNull();
  });

  it('takes the first of the hour that happens twice when the clocks go back', () => {
    expect(fromUkDateTime('2026-10-25', '01:30')?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('shows instants in UK time', () => {
    expect(ukDateTime(new Date('2026-07-01T23:30:00Z'))).toEqual({ date: '2026-07-02', time: '00:30' });
    expect(formatUk('2026-12-01T09:00:00Z')).toBe('1 Dec 2026, 09:00');
  });
});
