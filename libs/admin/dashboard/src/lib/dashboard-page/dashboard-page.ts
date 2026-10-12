import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent, DsBadgeComponent, DsToastService } from '@black-isle-beef/novan-design-system';
import { ContentApi, statusBadges } from '@novan/admin-content';
import { Confirm, copy, shortcutKeys, Shortcuts, Skeleton } from '@novan/admin-shell';
import { ManagementApi, problemMessage, SpaceContext } from '@novan/admin-spaces';
import { type EntrySummary, HOME_SLUG, type Onboarding, type PendingReview } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { OnboardingChecklist } from '../onboarding-checklist/onboarding-checklist';

/** How many pages each list shows. */
const LIST_LENGTH = 5;

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
const units: [unit: Intl.RelativeTimeFormatUnit, seconds: number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** `iso` relative to `now`, in plain words: "2 hours ago", "yesterday", "just now". */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** A quick link under the search box. */
interface QuickLink {
  label: string;
  link: string[];
}

/**
 * A space's home, led by a search box: what to work on next (search, a new page, quick links the role allows), the
 * site with its address, the getting-started checklist while the space is new, recently edited pages, pages waiting
 * for review (the reviewer inbox, docs/build/13-workflow-publishing.md) and changes not live yet.
 */
@Component({
  selector: 'nv-dashboard-page',
  imports: [DsAlertComponent, DsBadgeComponent, OnboardingChecklist, RouterLink, Skeleton],
  templateUrl: './dashboard-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly content = inject(ContentApi);
  private readonly management = inject(ManagementApi);
  private readonly confirm = inject(Confirm);
  private readonly toasts = inject(DsToastService);
  private readonly shortcuts = inject(Shortcuts);
  protected readonly context = inject(SpaceContext);
  protected readonly copy = copy;
  protected readonly statusBadges = statusBadges;
  protected readonly searchKeys = shortcutKeys.search;
  protected readonly timeAgo = timeAgo;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  private readonly entries = signal<EntrySummary[]>([]);
  protected readonly checklist = signal<Onboarding | null>(null);
  /** Pages sent for review, oldest first. */
  protected readonly reviews = signal<PendingReview[]>([]);
  /** Space admins and agency staff review; the role is the space's own (agency staff have none). */
  protected readonly canReview = computed(() => {
    const role = this.context.currentSpace()?.role;
    return role === 'admin' || role === null;
  });

  private readonly pages = computed(() =>
    this.entries()
      .filter((entry) => entry.kind === 'page')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  protected readonly recent = computed(() => this.pages().slice(0, LIST_LENGTH));
  protected readonly drafts = computed(() =>
    this.pages()
      .filter((entry) => entry.status !== 'published' || entry.hasUnpublishedChanges)
      .slice(0, LIST_LENGTH),
  );
  protected readonly homePageId = computed(
    () => this.pages().find((entry) => entry.folderId === null && entry.slug === HOME_SLUG)?.id ?? null,
  );
  protected readonly showChecklist = computed(() => {
    const checklist = this.checklist();
    return checklist !== null && !checklist.dismissedAt;
  });

  /** Whether the home page is on the live site: the site card's status. Null without a home page. */
  protected readonly homeLive = computed(() => {
    const id = this.homePageId();
    const home = id ? this.pages().find((entry) => entry.id === id) : undefined;
    return home ? home.status === 'published' || home.publishedAt !== null : null;
  });

  /** The site's address from Space settings, without a trailing slash; shown without its scheme. */
  protected readonly siteUrl = computed(() => this.context.currentSpace()?.previewUrl?.replace(/\/+$/, '') || null);
  protected readonly siteHost = computed(() => this.siteUrl()?.replace(/^https?:\/\//, '') ?? null);

  /** The quick links under the search box, each only when the role allows it. */
  protected readonly quickLinks = computed<QuickLink[]>(() => {
    const space = ['/spaces', this.spaceId()];
    const home = this.homePageId();
    return [
      ...(home && this.context.canEditCurrent() ? [{ label: 'Edit home page', link: [...space, 'pages', home, 'edit'] }] : []),
      ...(this.context.can('media.read') ? [{ label: 'Upload images', link: [...space, 'media'] }] : []),
      ...(this.context.can('forms.read') ? [{ label: 'Read form replies', link: [...space, 'forms'] }] : []),
      ...(this.context.can('space.read') ? [{ label: 'Site settings', link: [...space, 'settings', 'site'] }] : []),
    ];
  });

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => void this.load(spaceId));
    });
  }

  /** Opens the shell's search, as Ctrl+K does. */
  protected search(): void {
    this.shortcuts.trigger('search');
  }

  protected edited(entry: EntrySummary): string {
    return when.format(new Date(entry.updatedAt));
  }

  protected sent(review: PendingReview): string {
    return when.format(new Date(review.requestedAt));
  }

  protected async dismissChecklist(): Promise<void> {
    const confirmed = await this.confirm.ask({
      heading: 'Dismiss the checklist?',
      body: 'It is hidden for everyone in this space, and does not come back.',
      confirmLabel: 'Dismiss checklist',
    });
    if (!confirmed) return;
    try {
      const { checklist } = await firstValueFrom(this.management.dismissOnboarding(this.spaceId()));
      this.checklist.set(checklist);
      this.toasts.success('Checklist dismissed.');
    } catch (error) {
      this.toasts.danger(problemMessage(error), { title: 'Could not dismiss the checklist' });
    }
  }

  private async load(spaceId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [entries, onboarding, reviews] = await Promise.all([
        firstValueFrom(this.content.listEntries(spaceId)),
        firstValueFrom(this.management.onboarding(spaceId)),
        firstValueFrom(this.content.reviews(spaceId)),
      ]);
      this.entries.set(entries);
      this.checklist.set(onboarding.checklist);
      this.reviews.set(reviews);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
