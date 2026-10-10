/**
 * Scheduling is entered and shown in UK time (Europe/London, GMT or BST); the API stores UTC
 * (docs/build/17-scheduling-releases-webhooks.md).
 */
const ZONE = 'Europe/London';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const shown = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, dateStyle: 'medium', timeStyle: 'short' });

/** The UK wall-clock date (`YYYY-MM-DD`) and time (`HH:MM`) of an instant, as date and time inputs take them. */
export function ukDateTime(instant: Date): { date: string; time: string } {
  const p = Object.fromEntries(parts.formatToParts(instant).map((part) => [part.type, part.value]));
  return { date: `${p['year']}-${p['month']}-${p['day']}`, time: `${p['hour']}:${p['minute']}` };
}

/**
 * The instant a UK wall-clock date and time names, or null when it is malformed or does not exist (the hour skipped
 * when the clocks go forward). In the hour that happens twice in October, the first (BST) one.
 */
export function fromUkDateTime(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  // London is UTC or UTC+1: try the later offset first, so a repeated hour resolves to BST.
  for (const offsetHours of [1, 0]) {
    const instant = new Date(wall - offsetHours * 3_600_000);
    const back = ukDateTime(instant);
    if (back.date === date && back.time === time) return instant;
  }
  return null;
}

/** An instant in words, in UK time, e.g. "12 Oct 2026, 09:00". */
export function formatUk(iso: string): string {
  return shown.format(new Date(iso));
}
