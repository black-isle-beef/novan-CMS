import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { DsButtonComponent, DsHeaderComponent, type NavItem } from '@black-isle-beef/novan-design-system';
import { AuthService } from '@novan/admin-auth';
import { SpaceContext, SpaceSwitcher } from '@novan/admin-spaces';
import { filter, map } from 'rxjs';

/** Signed-in layout: header with navigation, space switcher and sign out, then the page. */
@Component({
  selector: 'nv-shell',
  imports: [DsButtonComponent, DsHeaderComponent, RouterLink, RouterOutlet, SpaceSwitcher],
  templateUrl: './shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly spaces = inject(SpaceContext);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly navItems = computed<NavItem[]>(() => [
    { label: 'Spaces', href: '/spaces', active: this.url().startsWith('/spaces') },
    { label: 'Account', href: '/account', active: this.url().startsWith('/account') },
  ]);

  ngOnInit(): void {
    void this.spaces.load();
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.spaces.clear();
    await this.router.navigate(['/sign-in']);
  }
}
