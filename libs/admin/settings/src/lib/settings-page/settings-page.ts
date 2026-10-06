import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentApi } from '@novan/admin-content';
import { copy, Skeleton } from '@novan/admin-shell';
import { SpaceContext } from '@novan/admin-spaces';
import { firstValueFrom } from 'rxjs';

/** The singleton that holds the site's name and details (supabase/seed.sql, package 10). */
const SITE_SETTINGS_TYPE = 'siteSettings';

interface SettingsLink {
  title: string;
  description: string;
  link: string[] | null;
  /** Shown instead of a link when there is nowhere to go yet. */
  missing?: string;
}

/**
 * Settings overview for everyone in a space: the site settings and the team, plus the technical settings the
 * caller's role may change (API tokens, space settings).
 */
@Component({
  selector: 'nv-settings-page',
  imports: [RouterLink, Skeleton],
  templateUrl: './settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  private readonly content = inject(ContentApi);
  private readonly context = inject(SpaceContext);
  protected readonly copy = copy;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly loading = signal(true);
  /** The site settings entry, null when the space has none, undefined if it could not be looked up. */
  private readonly siteSettingsId = signal<string | null | undefined>(undefined);

  protected readonly links = computed<SettingsLink[]>(() => {
    const space = ['/spaces', this.spaceId()];
    const siteSettings = this.siteSettingsId();
    return [
      {
        title: copy.siteSettings,
        description: 'Your site’s name, and who runs it.',
        link: siteSettings ? [...space, 'content', siteSettings] : null,
        missing: siteSettings === null ? 'Not set up for this site yet.' : 'Could not be opened just now. Try again later.',
      },
      { title: copy.team, description: 'Who can sign in, and what they can do.', link: [...space, 'members'] },
      ...(this.context.can('settings.update')
        ? [{ title: 'API tokens', description: 'Keys your sites use to read published content.', link: [...space, 'settings', 'api-tokens'] }]
        : []),
      ...(this.context.can('space.update')
        ? [{ title: 'Space settings', description: 'The space’s name and the address of its site.', link: [...space, 'settings', 'space'] }]
        : []),
    ];
  });

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => void this.load(spaceId));
    });
  }

  private async load(spaceId: string): Promise<void> {
    this.loading.set(true);
    try {
      const [entry] = await firstValueFrom(this.content.listEntries(spaceId, { contentType: SITE_SETTINGS_TYPE }));
      this.siteSettingsId.set(entry?.id ?? null);
    } catch {
      // The other settings still work; the site settings link says it could not be opened.
      this.siteSettingsId.set(undefined);
    } finally {
      this.loading.set(false);
    }
  }
}
