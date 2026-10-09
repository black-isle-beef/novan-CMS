import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { copy } from '@novan/admin-shell';
import { SpaceContext } from '@novan/admin-spaces';

interface SettingsLink {
  title: string;
  description: string;
  link: string[];
}

/**
 * Settings overview for everyone in a space: the site's settings, navigation, redirects and missing pages, and the
 * team, plus the technical settings the caller's role may change (API tokens, space settings).
 */
@Component({
  selector: 'nv-settings-page',
  imports: [RouterLink],
  templateUrl: './settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  private readonly context = inject(SpaceContext);
  protected readonly copy = copy;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly links = computed<SettingsLink[]>(() => {
    const settings = ['/spaces', this.spaceId(), 'settings'];
    return [
      {
        title: copy.siteSettings,
        description: 'Your site’s name, logo, sharing image, contact details and social media.',
        link: [...settings, 'site'],
      },
      { title: 'Navigation', description: 'The menu at the top of every page, and the links in the footer.', link: [...settings, 'navigation'] },
      { title: 'Languages', description: 'The languages your site is published in, and their addresses.', link: [...settings, 'languages'] },
      { title: 'Redirects', description: 'Send visitors from old addresses to the right page.', link: [...settings, 'redirects'] },
      { title: 'Missing pages', description: 'Addresses where visitors found no page, most visited first.', link: [...settings, 'missing-pages'] },
      { title: copy.team, description: 'Who can sign in, and what they can do.', link: ['/spaces', this.spaceId(), 'members'] },
      ...(this.context.can('settings.update')
        ? [{ title: 'API tokens', description: 'Keys your sites use to read published content.', link: [...settings, 'api-tokens'] }]
        : []),
      ...(this.context.can('space.update')
        ? [{ title: 'Space settings', description: 'The space’s name and the address of its site.', link: [...settings, 'space'] }]
        : []),
    ];
  });
}
