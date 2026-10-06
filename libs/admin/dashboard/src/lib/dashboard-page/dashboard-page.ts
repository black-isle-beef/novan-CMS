import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent, DsBadgeComponent, DsToastService } from '@black-isle-beef/novan-design-system';
import { ContentApi, statusBadges } from '@novan/admin-content';
import { Confirm, copy, Skeleton } from '@novan/admin-shell';
import { ManagementApi, problemMessage, SpaceContext } from '@novan/admin-spaces';
import { type EntrySummary, HOME_SLUG, type Onboarding } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { OnboardingChecklist } from '../onboarding-checklist/onboarding-checklist';

/** How many pages each list shows. */
const LIST_LENGTH = 5;

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A space's home: the getting-started checklist while it is new, recently edited pages, drafts awaiting review
 * (pages with changes that are not live yet) and a quick way to add a page.
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
  protected readonly context = inject(SpaceContext);
  protected readonly copy = copy;
  protected readonly statusBadges = statusBadges;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  private readonly entries = signal<EntrySummary[]>([]);
  protected readonly checklist = signal<Onboarding | null>(null);

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

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => void this.load(spaceId));
    });
  }

  protected edited(entry: EntrySummary): string {
    return when.format(new Date(entry.updatedAt));
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
      const [entries, onboarding] = await Promise.all([
        firstValueFrom(this.content.listEntries(spaceId)),
        firstValueFrom(this.management.onboarding(spaceId)),
      ]);
      this.entries.set(entries);
      this.checklist.set(onboarding.checklist);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
