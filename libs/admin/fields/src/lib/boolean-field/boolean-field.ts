import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

/** Yes or no, as a switch. An unset value shows the field's default. */
@Component({
  selector: 'nv-boolean-field',
  imports: [FieldMessages],
  templateUrl: './boolean-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BooleanField extends FieldControl<FieldDefOf<'boolean'>> {
  protected readonly checked = computed(() =>
    typeof this.value() === 'boolean' ? (this.value() as boolean) : (this.field().default ?? false),
  );

  protected set(event: Event): void {
    this.value.set((event.target as HTMLInputElement).checked);
  }
}
