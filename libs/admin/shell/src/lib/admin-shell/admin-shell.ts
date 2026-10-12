import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  type OnInit,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import {
  DsDropdownComponent,
  DsHeaderComponent,
  DsMenuItemComponent,
  DsSidebarComponent,
  DsToastContainerComponent,
  type NavItem,
} from '@black-isle-beef/novan-design-system';
import { AuthService } from '@novan/admin-auth';
import { SpaceContext, SpaceSwitcher } from '@novan/admin-spaces';
import { filter, map } from 'rxjs';
import { initialsFromEmail } from '../account/initials';
import { ConfirmHost } from '../confirm/confirm-host';
import { buildSpaceNav } from '../nav/space-nav';
import { SearchPalette } from '../search/search-palette';
import { shortcutKeys, Shortcuts } from '../shortcuts/shortcuts';
import { ViewAsBanner } from '../view-as/view-as-banner';
import { ViewAsMenu } from '../view-as/view-as-menu';

/** Below Bootstrap's `md` breakpoint the space menu moves into the header's menu button. */
const narrowScreen = '(max-width: 767.98px)';

const spaceInUrl = /^\/spaces\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

/**
 * Signed-in layout: the top bar (Spaces and Account; search, space switcher, "view as" for agency staff and the
 * account menu), the role-aware space menu in the sidebar on the left, then the screen. Below `md` the space menu
 * moves into the top bar's menu button. Also hosts the toasts, the confirm dialog, the search dialog (Ctrl+K inside a
 * space) and the keyboard shortcuts.
 */
@Component({
  selector: 'nv-admin-shell',
  imports: [
    ConfirmHost,
    DsDropdownComponent,
    DsHeaderComponent,
    DsMenuItemComponent,
    DsSidebarComponent,
    DsToastContainerComponent,
    RouterLink,
    RouterOutlet,
    SearchPalette,
    SpaceSwitcher,
    ViewAsBanner,
    ViewAsMenu,
  ],
  templateUrl: './admin-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nv-shell',
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class AdminShell implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly context = inject(SpaceContext);
  private readonly shortcuts = inject(Shortcuts);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly narrow = toSignal(
    inject(BreakpointObserver)
      .observe(narrowScreen)
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  /** The space in the address, or null outside a space. */
  protected readonly spaceId = computed(() => spaceInUrl.exec(this.url())?.[1] ?? null);

  /** The space menu for the caller's role (or the role being viewed as). */
  protected readonly spaceNav = computed(() => {
    const spaceId = this.spaceId();
    const access = this.context.currentAccess();
    return spaceId && access && this.context.currentSpaceId() === spaceId ? buildSpaceNav(spaceId, access, this.url()) : [];
  });

  /** The top bar's navigation: Spaces and Account, led by the space menu on narrow screens (no sidebar there). */
  protected readonly headerNav = computed<NavItem[]>(() => {
    const url = this.url().split(/[?#]/)[0];
    return [
      ...(this.narrow() ? this.spaceNav() : []),
      { label: 'Spaces', href: '/spaces', icon: 'bi bi-grid', active: url === '/spaces' || url === '/spaces/new' },
      { label: 'Account', href: '/account', icon: 'bi bi-person', active: url.startsWith('/account') },
    ];
  });

  /** Screens whose route has `data: { layout: 'wide' }` (the visual editor) use the whole width of the window. */
  protected readonly wide = computed(() => {
    this.url();
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return route.data['layout'] === 'wide';
  });

  /** Shown on the account button until profiles store a display name. */
  protected readonly initials = computed(() => initialsFromEmail(this.auth.email()));

  /** Agency staff can view the space they are in as one of its roles. */
  protected readonly viewAsSpaceId = computed(() =>
    this.auth.agencyStaff() && this.context.currentSpace() && this.context.currentSpaceId() === this.spaceId() ? this.spaceId() : null,
  );

  private readonly main = viewChild<ElementRef<HTMLElement>>('main');
  private readonly search = viewChild(SearchPalette);
  protected readonly searchKeys = shortcutKeys.search;
  /** The address without its query or fragment: a new screen, rather than the same one filtered. */
  private readonly path = computed(() => this.url().split(/[?#]/)[0]);

  constructor() {
    // Ctrl+K searches the space being worked in; screens that register their own shortcut win.
    this.shortcuts.register('search', () => this.openSearch());
    // Screens inside a space read it from the context; the address decides which space that is.
    effect(() => {
      const spaceId = this.spaceId();
      if (spaceId) untracked(() => this.context.currentSpaceId.set(spaceId));
    });
    // The screen scrolls inside <main>, not the window, so a new screen starts at its top.
    effect(() => {
      this.path();
      const main = this.main()?.nativeElement;
      untracked(() => {
        if (main) main.scrollTop = 0;
      });
    });
  }

  protected openSearch(): void {
    this.search()?.show();
  }

  /** Returns nothing: a listener that returns false makes Angular cancel the key (Tab, typing). */
  protected onKeydown(event: KeyboardEvent): void {
    this.shortcuts.handle(event);
  }

  ngOnInit(): void {
    void this.context.load();
  }

  protected openAccount(): void {
    void this.router.navigate(['/account']);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.context.clear();
    await this.router.navigate(['/sign-in']);
  }
}
