import { ChangeDetectionStrategy, Component, computed, forwardRef, input, model } from '@angular/core';
import type { FieldDef } from '@novan/shared-schemas';
import { Field } from '../field/field';
import { joinPath } from '../field-form-context';

/**
 * The form for a list of field definitions: one control per visible field, bound to the matching key
 * of `value`. Used for an entry's fields, a group's fields and a block's fields. Keys it has no field
 * for (a block's `_uid`, `_block` and `children`) are kept as they are.
 */
@Component({
  selector: 'nv-field-form',
  // Group and blocks fields nest a FieldForm, so the two refer to each other lazily.
  imports: [forwardRef(() => Field)],
  templateUrl: './field-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldForm {
  readonly fields = input.required<readonly FieldDef[]>();
  /** Path of this object in the entry data; empty at the root. */
  readonly path = input('');
  readonly value = model<Record<string, unknown>>({});

  protected readonly visible = computed(() => this.fields().filter((field) => !field.hidden));

  protected childPath(field: FieldDef): string {
    return joinPath(this.path(), field.apiId);
  }

  protected valueOf(field: FieldDef): unknown {
    return (this.value() ?? {})[field.apiId];
  }

  protected set(field: FieldDef, value: unknown): void {
    this.value.update((data) => ({ ...(data ?? {}), [field.apiId]: value }));
  }
}
