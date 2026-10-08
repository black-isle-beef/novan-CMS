import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { copy, Skeleton } from '@novan/admin-shell';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import { type EntrySummary, sitePath } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ContentApi } from '../content-api';

/** Pages stay in the bin this long, then are purged for good (package 17). */
export const BIN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The recycle bin (docs/build/13-workflow-publishing.md): deleted pages and entries, newest first, with how long
 * each has left. Editors and up restore them, as drafts at their old address.
 */
@Component({
  selector: 'nv-bin-page',
  imports: [DsAlertComponent, RouterLink, Skeleton],
  templateUrl: './bin-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinPage {
  private readonly api = inject(ContentApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly context = inject(SpaceContext);
  protected readonly copy = copy;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly restored = signal<EntrySummary | null>(null);
  protected readonly entries = signal<EntrySummary[]>([]);
  protected readonly busy = signal<string | null>(null);
  protected readonly canRestore = computed(() => this.context.canPublishCurrent());
  protected readonly sorted = computed(() => [...this.entries()].sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')));

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
  }

  protected deleted(entry: EntrySummary): string {
    return entry.deletedAt ? when.format(new Date(entry.deletedAt)) : '';
  }

  /** Days until the page is purged, never below zero. */
  protected daysLeft(entry: EntrySummary, now = Date.now()): number {
    if (!entry.deletedAt) return BIN_DAYS;
    return Math.max(0, Math.ceil((Date.parse(entry.deletedAt) + BIN_DAYS * DAY_MS - now) / DAY_MS));
  }

  protected address(entry: EntrySummary): string {
    return sitePath(entry.path);
  }

  protected async restore(entry: EntrySummary): Promise<void> {
    if (this.busy()) return;
    this.busy.set(entry.id);
    this.problem.set(null);
    this.restored.set(null);
    try {
      await firstValueFrom(this.api.restoreEntry(this.spaceId(), entry.id));
      this.entries.update((entries) => entries.filter((e) => e.id !== entry.id));
      this.restored.set(entry);
      this.focus('bin-status');
    } catch (error) {
      this.problem.set(`${entry.title} could not be restored: ${problemMessage(error)}`);
      this.focus('bin-problem');
    } finally {
      this.busy.set(null);
    }
  }

  private async load(spaceId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.entries.set(await firstValueFrom(this.api.listEntries(spaceId, { deleted: 'true' })));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private focus(id: string): void {
    afterNextRender(() => this.host.nativeElement.ownerDocument.getElementById(id)?.focus(), { injector: this.injector });
  }
}
