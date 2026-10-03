import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthLayout } from '../auth-layout/auth-layout';
import { AuthService } from '../auth.service';
import { SetPasswordForm } from '../set-password/set-password-form';

/** Reached from an invite email, which signs the new user in; they choose a password to finish. */
@Component({
  selector: 'nv-accept-invite-page',
  imports: [AuthLayout, RouterLink, SetPasswordForm],
  templateUrl: './accept-invite-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptInvitePage {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected async saved(): Promise<void> {
    await this.router.navigate(['/']);
  }
}
