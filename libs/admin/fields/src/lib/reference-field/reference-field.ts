import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

/** Another page or entry (or several), chosen from those of the allowed content types. */
@Component({
  selector: 'nv-reference-field',
  imports: [FieldMessages],
  templateUrl: './reference-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferenceField extends FieldControl<FieldDefOf<'reference'>> {
  protected readonly options = computed(() => {
    const allowed = this.field().contentTypes;
    return this.context.entries().filter((entry) => !allowed.length || allowed.includes(entry.contentType));
  });

  protected readonly selected = computed(() => (typeof this.value() === 'string' ? (this.value() as string) : ''));
  protected readonly chosen = computed(() =>
    Array.isArray(this.value()) ? (this.value() as unknown[]).filter((v): v is string => typeof v === 'string') : [],
  );

  protected choose(event: Event): void {
    this.value.set((event.target as HTMLSelectElement).value || null);
  }

  protected toggle(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.value.set(checked ? [...this.chosen(), id] : this.chosen().filter((chosen) => chosen !== id));
  }
}
