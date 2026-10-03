import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

/**
 * A date (`2026-10-03`), or a date and time. Times are entered in the editor's own time zone and
 * stored in UTC (`2026-10-03T08:30:00.000Z`).
 */
@Component({
  selector: 'nv-date-field',
  imports: [FieldMessages],
  templateUrl: './date-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateField extends FieldControl<FieldDefOf<'date'>> {
  protected readonly text = computed(() => {
    const value = this.value();
    if (typeof value !== 'string' || !value) return '';
    return this.field().withTime ? toLocalInput(value) : value.slice(0, 10);
  });

  protected override readonly hint = computed(() => (this.field().withTime ? 'Use your local time.' : null));

  protected set(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    if (!text) {
      this.value.set(null);
      return;
    }
    if (!this.field().withTime) {
      this.value.set(text);
      return;
    }
    const date = new Date(text);
    this.value.set(Number.isNaN(date.getTime()) ? null : date.toISOString());
  }
}

/** A UTC timestamp as the `YYYY-MM-DDTHH:mm` local time a datetime-local input shows. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
