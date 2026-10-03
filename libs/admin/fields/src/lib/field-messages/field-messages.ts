import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A field's help text and rules, then its errors, each with the id its control is described by. */
@Component({
  selector: 'nv-field-messages',
  templateUrl: './field-messages.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldMessages {
  readonly help = input<string | null | undefined>(null);
  readonly hint = input<string | null>(null);
  readonly helpId = input.required<string>();
  readonly errors = input<string[]>([]);
  readonly errorId = input.required<string>();
}
