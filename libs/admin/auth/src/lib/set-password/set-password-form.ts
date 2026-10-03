import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { authErrorMessage } from '../auth-errors';
import { AuthService } from '../auth.service';

export const MIN_PASSWORD_LENGTH = 8;

/** New password + confirmation for the signed-in user (password reset and invite acceptance). */
@Component({
  selector: 'nv-set-password-form',
  imports: [DsAlertComponent, ReactiveFormsModule],
  templateUrl: './set-password-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetPasswordForm {
  private readonly auth = inject(AuthService);

  readonly submitLabel = input('Save password');
  /** Emits after the password was saved. */
  readonly saved = output<void>();

  protected readonly minLength = MIN_PASSWORD_LENGTH;
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirm: ['', Validators.required],
  });

  protected passwordInvalid(): boolean {
    return this.submitted() && this.form.controls.password.invalid;
  }

  protected confirmInvalid(): boolean {
    const { password, confirm } = this.form.controls;
    return this.submitted() && (confirm.invalid || confirm.value !== password.value);
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    if (this.passwordInvalid() || this.confirmInvalid()) return;

    this.busy.set(true);
    try {
      await this.auth.updatePassword(this.form.controls.password.value);
      this.saved.emit();
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
