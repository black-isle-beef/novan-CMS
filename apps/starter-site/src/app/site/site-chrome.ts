import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsFooterComponent, DsHeaderComponent, type FooterLinkGroup, type NavItem } from '@black-isle-beef/novan-design-system';
import type { ChromeContact, ChromeLogo } from './site-chrome.types';
import type { SocialLink } from './site-content';

/**
 * The header and footer round every page, from the design system. The build's `production-plain` configuration swaps this file for
 * `site-chrome.plain.ts`, which has no design system or Bootstrap in it (docs/clients/new-site.md): keep the two in step.
 * The page's `main` is projected between them, so `SiteLayout` keeps hold of it.
 */
@Component({
  selector: 'site-chrome',
  imports: [DsFooterComponent, DsHeaderComponent, RouterLink],
  templateUrl: './site-chrome.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteChrome {
  readonly siteName = input.required<string>();
  readonly organisationName = input.required<string>();
  readonly navItems = input.required<NavItem[]>();
  readonly footerGroups = input.required<FooterLinkGroup[]>();
  readonly logo = input.required<ChromeLogo | null>();
  readonly contact = input.required<ChromeContact>();
  readonly social = input.required<SocialLink[]>();
}
