import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { AuthLayout } from '../auth-layout/auth-layout';
import { authErrorMessage } from '../auth-errors';
import { AuthService } from '../auth.service';

@Component({
  selector: 'nv-forgot-password-page',
  imports: [AuthLayout, DsAlertComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);

  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sentTo = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly email = this.form.controls.email;

  protected invalid(): boolean {
    return this.submitted() && this.email.invalid;
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    if (this.email.invalid) return;

    this.busy.set(true);
    try {
      await this.auth.sendPasswordReset(this.email.value.trim());
      this.sentTo.set(this.email.value.trim());
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
