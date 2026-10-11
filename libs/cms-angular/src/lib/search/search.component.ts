import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, model, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, debounce, EMPTY, firstValueFrom, of, Subject, switchMap, tap, timer } from 'rxjs';
import { NovanContentService } from '../content.service';
import type { NovanEntry } from '../types';

let nextId = 0;

/** Letters a search needs before it runs. */
const MIN_LENGTH = 2;
/** How long typing pauses before a search runs. */
const DEBOUNCE_MS = 300;

/**
 * Site search (docs/build/18-search-forms-audit.md): a search box that searches the site's published content with the
 * Delivery API's `q` as visitors type, and lists what it finds, best first, each with its title linked and a snippet
 * with the matching words in `<mark>`. Results are announced to screen readers. Unstyled apart from Bootstrap classes;
 * style `.novan-search*` to suit the site.
 *
 * ```html
 * <novan-search [(query)]="q" type="page" />
 * ```
 */
@Component({
  selector: 'novan-search',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'novan-search d-block' },
  template: `
    <form role="search" class="novan-search__form mb-3" [attr.aria-label]="label()" (submit)="submitted($event)">
      <label class="form-label" [for]="inputId">{{ label() }}</label>
      <div class="input-group">
        <input
          #box
          type="search"
          class="form-control"
          [id]="inputId"
          [value]="query()"
          [attr.placeholder]="placeholder() || null"
          [attr.aria-describedby]="statusId"
          autocomplete="off"
          enterkeyhint="search"
          maxlength="200"
          (input)="typed(box.value)"
        />
        <button type="submit" class="btn btn-primary">{{ buttonLabel() }}</button>
      </div>
    </form>
    <p class="novan-search__status" [id]="statusId" role="status">{{ status() }}</p>
    @if (results().length) {
      <ol class="novan-search__results list-unstyled" [attr.aria-label]="resultsLabel()">
        @for (entry of results(); track entry.id) {
          <li class="novan-search__result mb-4">
            @if (hasRouter) {
              <a class="novan-search__link h5 d-inline-block mb-1" [routerLink]="entry.path">{{ titleOf(entry) }}</a>
            } @else {
              <a class="novan-search__link h5 d-inline-block mb-1" [href]="entry.path">{{ titleOf(entry) }}</a>
            }
            @if (entry.search?.snippet?.length) {
              <p class="novan-search__snippet mb-0">
                @for (part of entry.search?.snippet; track $index) {
                  @if (part.match) {
                    <mark>{{ part.text }}</mark>
                  } @else {
                    {{ part.text }}
                  }
                }
              </p>
            }
          </li>
        }
      </ol>
    }
    @if (nextCursor()) {
      <button type="button" class="btn btn-secondary" [disabled]="loading()" (click)="more()">{{ moreLabel() }}</button>
    }
  `,
})
export class NovanSearch implements OnInit {
  private readonly content = inject(NovanContentService);
  private readonly destroyRef = inject(DestroyRef);

  /** What is searched for; two-way, so a search page can keep it in its address (`?q=`). */
  readonly query = model('');
  /** Only entries of this content type, e.g. `page`. */
  readonly type = input<string | undefined>(undefined);
  /** Results a page, 1 to 100. */
  readonly limit = input(10);
  readonly label = input('Search this site');
  readonly placeholder = input('');
  readonly buttonLabel = input('Search');
  readonly moreLabel = input('Show more results');

  protected readonly inputId = `novan-search-${nextId++}`;
  protected readonly statusId = `${this.inputId}-status`;
  /** Site links use `routerLink` when the app has routes, plain links otherwise. */
  protected readonly hasRouter = inject(ActivatedRoute, { optional: true }) !== null;
  protected readonly results = signal<NovanEntry[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly status = signal('');
  /** The search the results are for. */
  private readonly searched = signal('');
  protected readonly resultsLabel = computed(() => `Results for ${this.searched()}`);

  private readonly searches = new Subject<{ q: string; now: boolean }>();

  constructor() {
    this.searches
      .pipe(
        debounce((search) => (search.now ? of(0) : timer(DEBOUNCE_MS))),
        switchMap(({ q }) => this.search(q.trim())),
        takeUntilDestroyed(this.destroyRef),
      )
      // audit-ignore Manual RxJS subscription: a debounced keystroke stream; switchMap drops stale searches, takeUntilDestroyed ends it
      .subscribe();
  }

  ngOnInit(): void {
    // A search page opened with a query shows its results straight away (on the server too).
    if (this.query().trim()) this.searches.next({ q: this.query(), now: true });
  }

  protected typed(value: string): void {
    this.query.set(value);
    this.searches.next({ q: value, now: false });
  }

  protected submitted(event: Event): void {
    event.preventDefault();
    this.searches.next({ q: this.query(), now: true });
  }

  protected async more(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor) return;
    this.loading.set(true);
    try {
      const page = await firstValueFrom(
        this.content.entries({ q: this.searched(), type: this.type(), limit: this.limit(), cursor, include: 0, select: ['title'] }),
      );
      this.results.update((list) => [...list, ...page.items]);
      this.nextCursor.set(page.nextCursor);
      this.status.set(this.found(this.results().length, page.nextCursor !== null));
    } catch {
      this.status.set('More results could not be loaded. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected titleOf(entry: NovanEntry): string {
    const title = entry.data['title'];
    return typeof title === 'string' && title.trim() ? title : entry.path;
  }

  private search(q: string) {
    if (q.length < MIN_LENGTH) {
      this.results.set([]);
      this.nextCursor.set(null);
      this.status.set(q ? `Type at least ${MIN_LENGTH} letters to search.` : '');
      return EMPTY;
    }
    this.loading.set(true);
    this.status.set('Searching…');
    return this.content.entries({ q, type: this.type(), limit: this.limit(), include: 0, select: ['title'] }).pipe(
      tap((page) => {
        this.searched.set(q);
        this.results.set(page.items);
        this.nextCursor.set(page.nextCursor);
        this.loading.set(false);
        this.status.set(page.items.length ? this.found(page.items.length, page.nextCursor !== null, q) : `Nothing found for “${q}”.`);
      }),
      catchError(() => {
        this.loading.set(false);
        this.results.set([]);
        this.nextCursor.set(null);
        this.status.set('Search is not available right now. Please try again in a minute.');
        return EMPTY;
      }),
    );
  }

  private found(count: number, more: boolean, q = this.searched()): string {
    const results = count === 1 ? '1 result' : `${count} results`;
    return `${more ? `Showing ${results}` : results} for “${q}”.`;
  }
}
