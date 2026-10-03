import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

/** One option from a list, or several as checkboxes. */
@Component({
  selector: 'nv-select-field',
  imports: [FieldMessages],
  templateUrl: './select-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectField extends FieldControl<FieldDefOf<'select'>> {
  protected readonly selected = computed(() => (typeof this.value() === 'string' ? (this.value() as string) : ''));
  protected readonly chosen = computed(() =>
    Array.isArray(this.value()) ? (this.value() as unknown[]).filter((v): v is string => typeof v === 'string') : [],
  );

  protected choose(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.value.set(value || null);
  }

  protected toggle(option: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const chosen = new Set(this.chosen());
    if (checked) chosen.add(option);
    else chosen.delete(option);
    // Keep the options' order.
    this.value.set(this.field().options.map((o) => o.value).filter((value) => chosen.has(value)));
  }
}
