import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, input, model } from '@angular/core';
import type { FieldDef, FieldDefOf, FieldType } from '@novan/shared-schemas';
import { BlocksField } from '../blocks-field/blocks-field';
import { BooleanField } from '../boolean-field/boolean-field';
import { DateField } from '../date-field/date-field';
import { FieldFormContext, FieldScope } from '../field-form-context';
import { GroupField } from '../group-field/group-field';
import { JsonField } from '../json-field/json-field';
import { LinkField } from '../link-field/link-field';
import { MediaField } from '../media-field/media-field';
import { NumberField } from '../number-field/number-field';
import { ReferenceField } from '../reference-field/reference-field';
import { RichTextField } from '../rich-text-field/rich-text-field';
import { SelectField } from '../select-field/select-field';
import { TextField } from '../text-field/text-field';

/**
 * The control for one value, chosen by the field's type. It sets the {@link FieldScope} for everything inside it:
 * the locale shown (its parent's unless given) and whether it is read-only.
 */
@Component({
  selector: 'nv-field-input',
  imports: [
    forwardRef(() => BlocksField),
    BooleanField,
    DateField,
    forwardRef(() => GroupField),
    JsonField,
    LinkField,
    MediaField,
    NumberField,
    ReferenceField,
    RichTextField,
    SelectField,
    TextField,
  ],
  templateUrl: './field-input.html',
  providers: [{ provide: FieldScope, useExisting: forwardRef(() => FieldInput) }],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldInput implements FieldScope {
  private readonly context = inject(FieldFormContext);
  private readonly parent = inject(FieldScope, { skipSelf: true, optional: true });

  readonly field = input.required<FieldDef>();
  readonly path = input.required<string>();
  readonly value = model<unknown>();
  /** The locale to show; its parent's (or the form's) when null. */
  readonly locale = input<string | null>(null);
  /** Read-only, whatever the form allows. */
  readonly locked = input(false);

  readonly scopeLocale = computed(() => this.locale() ?? this.parent?.scopeLocale() ?? this.context.activeLocale());
  readonly scopeLocked = computed(() => this.locked() || (this.parent?.scopeLocked() ?? false));

  /** The definition as its own type; the template only calls this inside the matching `@case`. */
  protected def<T extends FieldType>(type: T): FieldDefOf<T> {
    const field = this.field();
    if (field.type !== type) throw new Error(`Expected a ${type} field, got ${field.type}.`);
    return field as FieldDefOf<T>;
  }
}
