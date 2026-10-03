import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, type OnInit, signal } from '@angular/core';
import { DsAlertComponent, DsButtonComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import type { Factor } from '@supabase/supabase-js';
import { authErrorMessage } from '../auth-errors';
import { AuthService } from '../auth.service';
import { TotpEnrolment } from '../two-step/totp-enrolment';

@Component({
  selector: 'nv-account-page',
  imports: [DatePipe, DsAlertComponent, DsButtonComponent, DsSpinnerComponent, TotpEnrolment],
  templateUrl: './account-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountPage implements OnInit {
  protected readonly auth = inject(AuthService);

  protected readonly factors = signal<Factor[] | null>(null);
  protected readonly enrolling = signal(false);
  protected readonly status = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadFactors();
  }

  protected startEnrolment(): void {
    this.status.set(null);
    this.enrolling.set(true);
  }

  protected async enrolled(): Promise<void> {
    this.enrolling.set(false);
    this.status.set('Two-step verification is on. You will be asked for a code when you sign in.');
    await this.loadFactors();
  }

  private async loadFactors(): Promise<void> {
    try {
      this.factors.set((await this.auth.verifiedTotpFactors()).filter((f) => f.status === 'verified'));
    } catch (error) {
      this.error.set(authErrorMessage(error));
    }
  }
}
