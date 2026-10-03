import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

/** A number; an empty box stores nothing. */
@Component({
  selector: 'nv-number-field',
  imports: [FieldMessages],
  templateUrl: './number-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NumberField extends FieldControl<FieldDefOf<'number'>> {
  protected readonly text = computed(() => (typeof this.value() === 'number' ? String(this.value()) : ''));

  protected override readonly hint = computed(() => {
    const { min, max, integer } = this.field();
    const kind = integer ? 'a whole number' : 'a number';
    if (min !== undefined && max !== undefined) return `Use ${kind} from ${min} to ${max}.`;
    if (min !== undefined) return `Use ${kind}, ${min} or more.`;
    if (max !== undefined) return `Use ${kind}, ${max} or less.`;
    return integer ? 'Use a whole number.' : null;
  });

  protected set(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.value.set(input.value === '' || Number.isNaN(input.valueAsNumber) ? null : input.valueAsNumber);
  }
}
