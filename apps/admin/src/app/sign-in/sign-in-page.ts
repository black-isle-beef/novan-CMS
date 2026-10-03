import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DsHeaderComponent, type NavItem } from '@black-isle-beef/novan-design-system';

/** Placeholder sign-in screen. Real authentication arrives with Supabase Auth (package 03). */
@Component({
  selector: 'nv-sign-in-page',
  imports: [DsHeaderComponent],
  templateUrl: './sign-in-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  protected readonly navItems: NavItem[] = [];
}
