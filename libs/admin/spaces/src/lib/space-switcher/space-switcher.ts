import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DsDropdownComponent, DsMenuItemComponent } from '@black-isle-beef/novan-design-system';
import { AuthService } from '@novan/admin-auth';
import { SpaceContext } from '../space-context';

/** Header menu for moving between spaces (and creating one, for agency staff). */
@Component({
  selector: 'nv-space-switcher',
  imports: [DsDropdownComponent, DsMenuItemComponent],
  templateUrl: './space-switcher.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpaceSwitcher {
  private readonly router = inject(Router);
  protected readonly context = inject(SpaceContext);
  protected readonly auth = inject(AuthService);

  protected open(commands: string[]): void {
    void this.router.navigate(commands);
  }
}
