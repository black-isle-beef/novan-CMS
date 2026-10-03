import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

/** A single line of text, or several when the field is multiline. */
@Component({
  selector: 'nv-text-field',
  imports: [FieldMessages],
  templateUrl: './text-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextField extends FieldControl<FieldDefOf<'text'>> {
  protected readonly text = computed(() => (typeof this.value() === 'string' ? (this.value() as string) : ''));

  protected override readonly hint = computed(() => {
    const { min, max } = this.field();
    if (min !== undefined && max !== undefined) return `Use ${min} to ${max} characters.`;
    if (max !== undefined) return `Up to ${max} characters.`;
    if (min !== undefined) return `At least ${min} characters.`;
    return null;
  });

  protected set(event: Event): void {
    this.value.set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }
}
