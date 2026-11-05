import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ChromeContact, ChromeLogo } from './site-chrome.types';
import type { SiteContent, SocialLink } from './site-content';

/**
 * The header and footer of a site built without the Novan design system and Bootstrap, swapped in for `site-chrome.ts`
 * by the build's `production-plain` configuration (docs/clients/new-site.md). Plain, semantic markup: the site's own CSS styles it
 * through the `site-chrome__*` classes. Only type imports reach for the design system, and they leave no code behind.
 */
@Component({
  selector: 'site-chrome',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './site-chrome.plain.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteChrome {
  readonly siteName = input.required<string>();
  readonly organisationName = input.required<string>();
  readonly navItems = input.required<SiteContent['nav']>();
  readonly footerGroups = input.required<SiteContent['footer']>();
  readonly logo = input.required<ChromeLogo | null>();
  readonly contact = input.required<ChromeContact>();
  readonly social = input.required<SocialLink[]>();

  /** As the design system decides: anything that is not a path on this site gets an ordinary link. */
  protected internal(href: string): boolean {
    return href.startsWith('/') && !href.startsWith('//');
  }
}
