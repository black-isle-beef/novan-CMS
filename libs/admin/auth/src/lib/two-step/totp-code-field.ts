import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { type FormControl, ReactiveFormsModule } from '@angular/forms';

/** Six-digit authenticator code input with its label and error message. */
@Component({
  selector: 'nv-totp-code-field',
  imports: [ReactiveFormsModule],
  templateUrl: './totp-code-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TotpCodeField {
  readonly control = input.required<FormControl<string>>();
  readonly fieldId = input.required<string>();
  readonly showError = input(false);
}
