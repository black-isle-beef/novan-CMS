import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { copy, Skeleton } from '@novan/admin-shell';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import type { NotFoundSummary } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { SettingsApi } from '../settings-api';

/** The periods the list can cover, in days. */
export const PERIODS = [7, 30, 90] as const;

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Missing pages (docs/build/14-seo-site-features.md): the addresses on the site visitors found no page at, most
 * visited first, as the site reported them. Editors and up redirect one with a click (the redirects screen opens with
 * the address filled in); once an address redirects, it leaves this list.
 */
@Component({
  selector: 'nv-not-found-page',
  imports: [DsAlertComponent, RouterLink, Skeleton],
  templateUrl: './not-found-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {
  private readonly api = inject(SettingsApi);
  protected readonly context = inject(SpaceContext);
  protected readonly copy = copy;
  protected readonly periods = PERIODS;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly days = signal<(typeof PERIODS)[number]>(30);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly rows = signal<NotFoundSummary[]>([]);
  protected readonly canRedirect = computed(() => this.context.canPublishCurrent());

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      const days = this.days();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId, days);
      });
    });
  }

  protected setDays(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if ((PERIODS as readonly number[]).includes(value)) this.days.set(value as (typeof PERIODS)[number]);
  }

  protected when(value: string): string {
    const time = Date.parse(value);
    return Number.isNaN(time) ? value : dateTime.format(time);
  }

  /** The referring page's host, which is what people recognise. */
  protected referrer(value: string | null): string | null {
    if (!value) return null;
    try {
      return new URL(value).host;
    } catch {
      return null;
    }
  }

  private async load(spaceId: string, days: number): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.rows.set(await firstValueFrom(this.api.listNotFound(spaceId, { days, limit: 100 })));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
