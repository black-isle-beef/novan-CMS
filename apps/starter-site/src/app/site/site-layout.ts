import { isPlatformBrowser, Location } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  effect,
  inject,
  Injector,
  input,
  PLATFORM_ID,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { DsFooterComponent, DsHeaderComponent } from '@black-isle-beef/novan-design-system';
import { filter, map } from 'rxjs';
import { FALLBACK_SITE_NAME, type SiteContent, withActive } from './site-content';

/**
 * The frame around every page: the design-system header (with the menu from the `navigation` singleton) and
 * footer, and the `main` landmark that the header's skip link targets. After each navigation to another
 * page, focus moves to `main`, so keyboard and screen-reader users start at the new content.
 */
@Component({
  selector: 'site-layout',
  imports: [DsFooterComponent, DsHeaderComponent, RouterLink, RouterOutlet],
  templateUrl: './site-layout.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(click)': 'followInPageLink($event)' },
})
export class SiteLayout {
  /** From `siteContentResolver`. */
  readonly site = input<SiteContent | null>(null);

  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  /** The address the page was loaded at (the router's own URL is not set until its first navigation ends). */
  private readonly loadedPath = pathOf(inject(Location).path() || '/');

  /** The current path, without query or fragment. */
  private readonly path = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => pathOf(event.urlAfterRedirects)),
    ),
    { initialValue: this.loadedPath },
  );

  protected readonly siteName = computed(() => this.site()?.siteName ?? FALLBACK_SITE_NAME);
  protected readonly organisationName = computed(() => this.site()?.organisationName ?? this.siteName());
  protected readonly navItems = computed(() => withActive(this.site()?.nav ?? [], this.path()));
  protected readonly footerGroups = computed(() => this.site()?.footer ?? []);

  constructor() {
    // Compared with the loaded address, not the first value seen: a link clicked before hydration finishes is
    // replayed, and its navigation can be the first change this effect sees.
    let previous = this.loadedPath;
    effect(() => {
      const path = this.path();
      const moved = previous !== path;
      previous = path;
      if (moved && this.browser) {
        afterNextRender(() => this.main().nativeElement.focus({ preventScroll: true }), { injector: this.injector });
      }
    });
  }

  /**
   * Links to a place on the same page (`#id`): the header's "Skip to main content" link, and anchors in rich
   * text. With `<base href="/">` the browser would resolve `#id` against the base and load the home page,
   * so focus and scroll to the target here instead.
   */
  protected followInPageLink(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    const id = safeDecode(link?.getAttribute('href')?.slice(1) ?? '');
    const target = id ? link?.ownerDocument.getElementById(id) : null;
    if (!target) return;
    event.preventDefault();
    if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView();
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0] || '/';
}
