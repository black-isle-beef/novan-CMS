import { ChangeDetectionStrategy, Component, inject, type OnInit, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DsAlertComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { authErrorMessage } from '../auth-errors';
import { AuthService, type TotpEnrolment as Enrolment } from '../auth.service';
import { TotpCodeField } from './totp-code-field';

/** Adds an authenticator app: shows the QR code and secret, then verifies the first code. */
@Component({
  selector: 'nv-totp-enrolment',
  imports: [DsAlertComponent, DsSpinnerComponent, ReactiveFormsModule, TotpCodeField],
  templateUrl: './totp-enrolment.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TotpEnrolment implements OnInit {
  private readonly auth = inject(AuthService);

  /** Emits once the new factor is verified (the session is then AAL2). */
  readonly verified = output<void>();

  protected readonly enrolment = signal<Enrolment | null>(null);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  protected readonly code = this.form.controls.code;

  async ngOnInit(): Promise<void> {
    try {
      this.enrolment.set(await this.auth.enrolTotp());
    } catch (error) {
      this.error.set(authErrorMessage(error));
    }
  }

  protected async submit(): Promise<void> {
    const enrolment = this.enrolment();
    this.submitted.set(true);
    this.error.set(null);
    if (!enrolment || this.code.invalid) return;

    this.busy.set(true);
    try {
      await this.auth.verifyTotp(enrolment.factorId, this.code.value);
      this.verified.emit();
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
