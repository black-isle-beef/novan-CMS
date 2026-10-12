import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Injectable, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { DsDropdownComponent, DsMenuItemComponent, type SidebarItem } from '@black-isle-beef/novan-design-system';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type { EntrySummary } from '@novan/shared-schemas';
import { map, type Observable } from 'rxjs';

/** The page an address is about: the visual editor (`pages/:id/edit`) or the form (`content/:id`). */
const pageInUrl = /\/(?:pages\/([0-9a-f-]{36})\/edit|content\/([0-9a-f-]{36}))(?:[/?#]|$)/i;

/** The space's pages, by title, for the sidebar's pages menu. */
@Injectable({ providedIn: 'root' })
export class SpacePages {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;

  list(spaceId: string): Observable<EntrySummary[]> {
    return this.http
      .get<EntrySummary[]>(`${this.base}/${spaceId}/entries`)
      .pipe(map((entries) => entries.filter((entry) => entry.kind === 'page').sort((a, b) => a.title.localeCompare(b.title))));
  }
}

/**
 * The space menu in the sidebar: the design system's sidebar (its classes, rail and collapse button), with a menu of
 * the space's pages under Pages that opens one in the visual editor. The design system's `ds-sidebar` has no slot
 * for that menu, so this renders the same markup.
 */
@Component({
  selector: 'nv-space-sidebar',
  imports: [DsDropdownComponent, DsMenuItemComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-sidebar nv-space-sidebar',
    '[class.ds-sidebar--open]': '!collapsed()',
  },
  template: `
    <nav class="ds-sidebar__nav" aria-label="Space">
      <ul id="nv-space-sidebar-list" class="ds-sidebar__list list-unstyled d-flex flex-column gap-1">
        @for (item of items(); track item.label) {
          <li>
            <a
              class="ds-sidebar__link ds-focus-ring"
              [routerLink]="item.href"
              [attr.aria-current]="item.active ? 'page' : null"
              [class.ds-sidebar__link--active]="item.active"
            >
              @if (item.icon) {
                <i class="ds-sidebar__icon" [class]="item.icon" aria-hidden="true"></i>
              }
              <span class="ds-sidebar__label">{{ item.label }}</span>
            </a>
            @if (item.href === pagesHref() && !collapsed() && pages().length) {
              <ds-dropdown class="nv-space-sidebar__pages" label="Open a page" position="bottom-start" (openChange)="opened($event)">
                <!-- The name starts with the visible text (the page being worked on, else "Open a page"). -->
                <span dsDropdownTrigger>
                  @if (currentPage(); as page) {
                    <span class="nv-space-sidebar__pages-label">{{ page.title }}</span>
                    <span class="visually-hidden">, open another page</span>
                  } @else {
                    <span class="nv-space-sidebar__pages-label">Open a page</span>
                  }
                </span>
                @for (page of pages(); track page.id) {
                  <ds-menu-item (activated)="openPage(page)">{{ page.title }}</ds-menu-item>
                }
              </ds-dropdown>
            }
          </li>
        }
      </ul>

      <button
        type="button"
        class="ds-sidebar__toggle ds-focus-ring"
        [attr.aria-expanded]="!collapsed()"
        aria-controls="nv-space-sidebar-list"
        [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
        (click)="collapsed.set(!collapsed())"
      >
        <i class="ds-sidebar__toggle-icon bi bi-chevron-right" aria-hidden="true"></i>
      </button>
    </nav>
  `,
})
export class SpaceSidebar {
  private readonly spacePages = inject(SpacePages);
  private readonly router = inject(Router);

  /** The space menu (the shell builds it for the caller's role). */
  readonly items = input.required<SidebarItem[]>();
  readonly spaceId = input.required<string>();
  /** The current address, to show the page being worked on. */
  readonly url = input('');

  protected readonly collapsed = signal(false);
  protected readonly pagesHref = computed(() => `/spaces/${this.spaceId()}/content`);

  /** Only fetched when the role sees Pages. */
  private readonly pageList = rxResource({
    params: () => (this.items().some((item) => item.href === this.pagesHref()) ? this.spaceId() : undefined),
    stream: ({ params: spaceId }) => this.spacePages.list(spaceId),
  });

  protected readonly pages = computed(() => (this.pageList.hasValue() ? this.pageList.value() : []));

  protected readonly currentPage = computed(() => {
    const match = pageInUrl.exec(this.url());
    const id = match?.[1] ?? match?.[2];
    return id ? (this.pages().find((page) => page.id === id) ?? null) : null;
  });

  /** Pages added or renamed since the list loaded show the next time the menu opens. */
  protected opened(open: boolean): void {
    if (open) this.pageList.reload();
  }

  protected openPage(page: EntrySummary): void {
    void this.router.navigate(['/spaces', this.spaceId(), 'pages', page.id, 'edit']);
  }
}
