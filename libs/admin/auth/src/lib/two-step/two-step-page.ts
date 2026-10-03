import { ChangeDetectionStrategy, Component, inject, input, type OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { DsAlertComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { AuthLayout } from '../auth-layout/auth-layout';
import { authErrorMessage } from '../auth-errors';
import { safeReturnUrl } from '../auth.guards';
import { AuthService } from '../auth.service';
import { TotpCodeField } from './totp-code-field';
import { TotpEnrolment } from './totp-enrolment';

/**
 * Second sign-in step. Users with an authenticator app enter a code; agency staff without one must
 * add one here before they can continue.
 */
@Component({
  selector: 'nv-two-step-page',
  imports: [AuthLayout, DsAlertComponent, DsSpinnerComponent, ReactiveFormsModule, TotpCodeField, TotpEnrolment],
  templateUrl: './two-step-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TwoStepPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly returnUrl = input<string>();

  protected readonly loading = signal(true);
  /** The verified factor to challenge; null means the user must add one. */
  protected readonly factorId = signal<string | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  protected readonly code = this.form.controls.code;

  async ngOnInit(): Promise<void> {
    try {
      const [factor] = (await this.auth.verifiedTotpFactors()).filter((f) => f.status === 'verified');
      this.factorId.set(factor?.id ?? null);
    } catch (error) {
      this.error.set(authErrorMessage(error));
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected async verify(factorId: string): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    if (this.code.invalid) return;

    this.busy.set(true);
    try {
      await this.auth.verifyTotp(factorId, this.code.value);
      await this.continue();
    } catch (error) {
      this.error.set(authErrorMessage(error));
      this.code.reset();
    } finally {
      this.busy.set(false);
    }
  }

  protected async continue(): Promise<void> {
    await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/sign-in']);
  }
}
