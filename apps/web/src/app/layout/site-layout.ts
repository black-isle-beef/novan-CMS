import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import {
  DsFooterComponent,
  DsHeaderComponent,
  type FooterLinkGroup,
  type NavItem,
} from '@black-isle-beef/novan-design-system';
import { footerLinks, primaryCta, primaryNav, signInLabel, site } from '@novan/marketing-content';
import { ConsentService, MkBrand, MkConsentManager } from '@novan/marketing-ui';
import { filter, map } from 'rxjs';
import { SITE_CONFIG } from '../config/site-config';

/**
 * Every page's frame: the design system's header (skip link, logo, navigation, sign-in and the call to action), the
 * page in `main#ds-main-content` (the skip link's target), and the design system's footer.
 */
@Component({
  selector: 'app-site-layout',
  imports: [DsFooterComponent, DsHeaderComponent, MkBrand, MkConsentManager, RouterLink, RouterOutlet],
  templateUrl: './site-layout.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteLayout {
  private readonly router = inject(Router);

  protected readonly config = inject(SITE_CONFIG);
  protected readonly consent = inject(ConsentService);
  protected readonly cta = primaryCta;
  protected readonly signInLabel = signInLabel;
  protected readonly site = site;

  private readonly path = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** The header's links; the current page's carries `aria-current="page"`. */
  protected readonly navItems = computed<NavItem[]>(() => {
    const path = this.path().split(/[?#]/)[0];
    return primaryNav.map((link) => ({
      label: link.label,
      href: link.path,
      active: link.path === '/' ? path === '/' : path === link.path || path.startsWith(`${link.path}/`),
    }));
  });

  protected readonly footerGroups: FooterLinkGroup[] = footerLinks.map((group) => ({
    title: group.title,
    links: group.links.map((link) => ({ label: link.label, href: link.path })),
  }));
}
