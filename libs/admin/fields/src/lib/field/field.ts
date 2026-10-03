import { ChangeDetectionStrategy, Component, forwardRef, input, model } from '@angular/core';
import type { FieldDef, FieldDefOf, FieldType } from '@novan/shared-schemas';
import { BlocksField } from '../blocks-field/blocks-field';
import { BooleanField } from '../boolean-field/boolean-field';
import { DateField } from '../date-field/date-field';
import { GroupField } from '../group-field/group-field';
import { JsonField } from '../json-field/json-field';
import { LinkField } from '../link-field/link-field';
import { MediaField } from '../media-field/media-field';
import { NumberField } from '../number-field/number-field';
import { ReferenceField } from '../reference-field/reference-field';
import { RichTextField } from '../rich-text-field/rich-text-field';
import { SelectField } from '../select-field/select-field';
import { TextField } from '../text-field/text-field';

/** The control for one field, chosen by its type. */
@Component({
  selector: 'nv-field',
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
  templateUrl: './field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Field {
  readonly field = input.required<FieldDef>();
  readonly path = input.required<string>();
  readonly value = model<unknown>();

  /** The definition as its own type; the template only calls this inside the matching `@case`. */
  protected def<T extends FieldType>(type: T): FieldDefOf<T> {
    const field = this.field();
    if (field.type !== type) throw new Error(`Expected a ${type} field, got ${field.type}.`);
    return field as FieldDefOf<T>;
  }
}
