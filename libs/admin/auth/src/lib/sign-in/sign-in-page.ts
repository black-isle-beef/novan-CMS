import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { AuthLayout } from '../auth-layout/auth-layout';
import { authErrorMessage } from '../auth-errors';
import { safeReturnUrl } from '../auth.guards';
import { AuthService } from '../auth.service';

type Mode = 'password' | 'link';

@Component({
  selector: 'nv-sign-in-page',
  imports: [AuthLayout, DsAlertComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './sign-in-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Bound from the `returnUrl` query parameter. */
  readonly returnUrl = input<string>();

  protected readonly mode = signal<Mode>('password');
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly linkSentTo = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected invalid(name: 'email' | 'password'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected toggleMode(): void {
    this.mode.update((mode) => (mode === 'password' ? 'link' : 'password'));
    this.error.set(null);
    this.linkSentTo.set(null);
    this.submitted.set(false);
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    const { email, password } = this.form.controls;
    if (email.invalid || (this.mode() === 'password' && password.invalid)) return;

    this.busy.set(true);
    try {
      if (this.mode() === 'password') {
        await this.auth.signInWithPassword(email.value.trim(), password.value);
        await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
      } else {
        await this.auth.sendMagicLink(email.value.trim());
        this.linkSentTo.set(email.value.trim());
      }
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
