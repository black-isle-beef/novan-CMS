import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DsHeaderComponent, type NavItem } from '@black-isle-beef/novan-design-system';

/** Page frame for the signed-out screens: header, one `main` landmark and the page heading. */
@Component({
  selector: 'nv-auth-layout',
  imports: [DsHeaderComponent],
  templateUrl: './auth-layout.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  protected readonly navItems: NavItem[] = [];
}
