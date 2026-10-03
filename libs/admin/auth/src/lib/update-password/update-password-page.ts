import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthLayout } from '../auth-layout/auth-layout';
import { AuthService } from '../auth.service';
import { SetPasswordForm } from '../set-password/set-password-form';

/** Reached from a password-reset email, which signs the user in for this one step. */
@Component({
  selector: 'nv-update-password-page',
  imports: [AuthLayout, RouterLink, SetPasswordForm],
  templateUrl: './update-password-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdatePasswordPage {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected async saved(): Promise<void> {
    await this.router.navigate(['/']);
  }
}
