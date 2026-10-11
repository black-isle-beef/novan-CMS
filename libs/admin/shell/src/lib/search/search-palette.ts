import { HttpClient } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  type ElementRef,
  inject,
  Injector,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { DsModalComponent } from '@black-isle-beef/novan-design-system';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import { SpaceContext } from '@novan/admin-spaces';
import type { AdminSearchHit, AdminSearchResults } from '@novan/shared-schemas';
import { catchError, debounceTime, EMPTY, Subject, switchMap, tap } from 'rxjs';

/** Letters a search needs before it runs. */
const MIN_LENGTH = 2;

const statusWords: Readonly<Record<string, string>> = {
  draft: 'Draft',
  in_review: 'In review',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
};

interface Group {
  key: 'pages' | 'entries' | 'media';
  label: string;
  hits: AdminSearchHit[];
}

/**
 * The admin's global search (Ctrl+K or ⌘K, docs/build/18-search-forms-audit.md): pages, other content and media in
 * the space, as you type. The box is a combobox: the arrow keys move through the results, Enter opens one, Escape
 * closes; the number of results is announced. Drafts are found as last saved.
 */
@Component({
  selector: 'nv-search-palette',
  imports: [DsModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-modal [open]="open()" (openChange)="open.set($event)" [heading]="heading()" size="lg">
      <label for="nv-search-box" class="form-label">{{ prompt() }}</label>
      <input
        #box
        id="nv-search-box"
        type="search"
        class="form-control"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        maxlength="200"
        aria-autocomplete="list"
        aria-controls="nv-search-results"
        aria-describedby="nv-search-status"
        [attr.aria-expanded]="options().length > 0"
        [attr.aria-activedescendant]="activeId()"
        [value]="query()"
        (input)="typed(box.value)"
        (keydown)="key($event)"
      />
      <p id="nv-search-status" class="form-text mb-3" role="status">{{ status() }}</p>
      <div id="nv-search-results" role="listbox" aria-label="Search results" class="nv-search-results">
        @for (group of groups(); track group.key) {
          <div role="group" [attr.aria-labelledby]="'nv-search-group-' + group.key">
            <div [id]="'nv-search-group-' + group.key" role="presentation" class="small fw-semibold text-muted text-uppercase mt-2 mb-1">
              {{ group.label }}
            </div>
            @for (hit of group.hits; track hit.id) {
              <!-- Options are reached from the combobox (arrow keys and aria-activedescendant), so keyboard focus stays in
                   the box; the click is for pointers. -->
              <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
              <div
                role="option"
                class="nv-search-option d-flex justify-content-between gap-3 rounded px-2 py-1"
                [id]="optionId(hit)"
                [attr.aria-selected]="activeId() === optionId(hit)"
                [class.nv-search-option--active]="activeId() === optionId(hit)"
                (click)="go(hit)"
                (mousemove)="activate(hit)"
              >
                <span class="text-break">{{ hit.title }}</span>
                <span class="small text-muted text-nowrap">{{ detail(hit) }}</span>
              </div>
            }
          </div>
        }
      </div>
    </ds-modal>
  `,
})
export class SearchPalette {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;
  private readonly context = inject(SpaceContext);

  /** Whether the dialog is open; two-way. */
  readonly open = model(false);
  /** The space to search. */
  readonly spaceId = input.required<string>();

  protected readonly query = signal('');
  protected readonly results = signal<AdminSearchResults | null>(null);
  protected readonly status = signal('Type at least 2 letters.');
  protected readonly active = signal(0);

  protected readonly heading = computed(() => `Search ${this.context.currentSpace()?.name ?? 'this space'}`);
  protected readonly prompt = computed(() =>
    this.context.agencyMode() ? 'Find pages, entries and media' : 'Find pages, other content and media',
  );
  protected readonly groups = computed<Group[]>(() => {
    const results = this.results();
    if (!results) return [];
    const groups: Group[] = [
      { key: 'pages', label: 'Pages', hits: results.pages },
      { key: 'entries', label: this.context.agencyMode() ? 'Entries' : 'Other content', hits: results.entries },
      { key: 'media', label: 'Media', hits: results.media },
    ];
    return groups.filter((group) => group.hits.length);
  });
  /** Every result, in the order the arrow keys move through them. */
  protected readonly options = computed(() => this.groups().flatMap((group) => group.hits));
  protected readonly activeId = computed(() => {
    const hit = this.options()[this.active()];
    return hit ? this.optionId(hit) : null;
  });

  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  private readonly searches = new Subject<string>();

  constructor() {
    this.searches
      .pipe(
        debounceTime(200),
        switchMap((q) => this.search(q)),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      // audit-ignore Manual RxJS subscription: a debounced keystroke stream; switchMap drops stale searches, takeUntilDestroyed ends it
      .subscribe();
  }

  /** Opens the dialog with the last search selected, ready to type over. */
  show(): void {
    this.active.set(0);
    this.open.set(true);
    afterNextRender(
      () => {
        const box = this.box()?.nativeElement;
        box?.focus();
        box?.select();
      },
      { injector: this.injector },
    );
  }

  protected optionId(hit: AdminSearchHit): string {
    return `nv-search-${hit.kind}-${hit.id}`;
  }

  protected detail(hit: AdminSearchHit): string {
    const status = hit.status ? statusWords[hit.status] : null;
    return status ? `${hit.detail} · ${status}` : hit.detail;
  }

  protected typed(value: string): void {
    this.query.set(value);
    this.searches.next(value.trim());
  }

  protected activate(hit: AdminSearchHit): void {
    this.active.set(this.options().indexOf(hit));
  }

  protected key(event: KeyboardEvent): void {
    const count = this.options().length;
    if (!count) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.update((index) => (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
      this.revealActive();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = this.options()[this.active()];
      if (hit) void this.go(hit);
    }
  }

  protected async go(hit: AdminSearchHit): Promise<void> {
    this.open.set(false);
    const space = this.spaceId();
    if (hit.kind === 'media') await this.router.navigate(['/spaces', space, 'media'], { queryParams: { asset: hit.id } });
    else await this.router.navigate(['/spaces', space, 'content', hit.id]);
  }

  private search(q: string) {
    if (q.length < MIN_LENGTH) {
      this.results.set(null);
      this.status.set(q ? `Type at least ${MIN_LENGTH} letters.` : 'Type at least 2 letters.');
      return EMPTY;
    }
    this.status.set('Searching…');
    return this.http.get<AdminSearchResults>(`${this.base}/${this.spaceId()}/search`, { params: { q } }).pipe(
      tap((results) => {
        this.results.set(results);
        this.active.set(0);
        const count = results.pages.length + results.entries.length + results.media.length;
        this.status.set(
          count ? `${count} ${count === 1 ? 'result' : 'results'}. Use the up and down arrows, then Enter to open one.` : `Nothing found for “${q}”.`,
        );
      }),
      catchError(() => {
        this.results.set(null);
        this.status.set('Search is not available right now. Try again in a moment.');
        return EMPTY;
      }),
    );
  }

  private revealActive(): void {
    const id = this.activeId();
    afterNextRender(() => (id ? this.document.getElementById(id)?.scrollIntoView({ block: 'nearest' }) : undefined), { injector: this.injector });
  }
}
