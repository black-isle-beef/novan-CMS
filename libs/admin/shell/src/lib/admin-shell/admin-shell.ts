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
  DsButtonComponent,
  DsHeaderComponent,
  DsSidebarComponent,
  DsToastContainerComponent,
  type NavItem,
} from '@black-isle-beef/novan-design-system';
import { AuthService } from '@novan/admin-auth';
import { SpaceContext, SpaceSwitcher } from '@novan/admin-spaces';
import { filter, map } from 'rxjs';
import { ConfirmHost } from '../confirm/confirm-host';
import { buildSpaceNav } from '../nav/space-nav';
import { Shortcuts } from '../shortcuts/shortcuts';
import { ViewAsBanner } from '../view-as/view-as-banner';
import { ViewAsMenu } from '../view-as/view-as-menu';

/** Below Bootstrap's `md` breakpoint the space menu moves into the header's menu button. */
const narrowScreen = '(max-width: 767.98px)';

const spaceInUrl = /^\/spaces\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

/**
 * Signed-in layout: the header (space switcher, "view as" for agency staff, sign out), the role-aware space
 * menu on the left, then the screen. Also hosts the toasts, the confirm dialog and the keyboard shortcuts.
 */
@Component({
  selector: 'nv-admin-shell',
  imports: [
    ConfirmHost,
    DsButtonComponent,
    DsHeaderComponent,
    DsSidebarComponent,
    DsToastContainerComponent,
    RouterLink,
    RouterOutlet,
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

  protected readonly headerNav = computed<NavItem[]>(() => {
    const url = this.url().split(/[?#]/)[0];
    return [
      ...(this.narrow() ? this.spaceNav().map(({ label, href, active }) => ({ label, href, active })) : []),
      { label: 'Spaces', href: '/spaces', active: url === '/spaces' || url === '/spaces/new' },
      { label: 'Account', href: '/account', active: url.startsWith('/account') },
    ];
  });

  /** Agency staff can view the space they are in as one of its roles. */
  protected readonly viewAsSpaceId = computed(() =>
    this.auth.agencyStaff() && this.context.currentSpace() && this.context.currentSpaceId() === this.spaceId() ? this.spaceId() : null,
  );

  private readonly main = viewChild<ElementRef<HTMLElement>>('main');
  /** The address without its query or fragment: a new screen, rather than the same one filtered. */
  private readonly path = computed(() => this.url().split(/[?#]/)[0]);

  constructor() {
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

  /** Returns nothing: a listener that returns false makes Angular cancel the key (Tab, typing). */
  protected onKeydown(event: KeyboardEvent): void {
    this.shortcuts.handle(event);
  }

  ngOnInit(): void {
    void this.context.load();
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.context.clear();
    await this.router.navigate(['/sign-in']);
  }
}
