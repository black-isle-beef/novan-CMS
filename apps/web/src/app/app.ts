import { afterNextRender, ChangeDetectionStrategy, Component, DOCUMENT, effect, inject, Injector } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);

  /** Every in-app navigation after the first load. */
  private readonly navigated = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      skip(1),
    ),
  );

  constructor() {
    // Move focus to the new page's heading (or the section a link pointed at), so screen-reader users hear where
    // they are. The first load keeps the browser's default focus, as in the admin.
    effect(() => {
      if (!this.navigated()) return;
      afterNextRender(() => this.focusTarget(), { injector: this.injector });
    });
  }

  private focusTarget(): void {
    const fragment = this.router.parseUrl(this.router.url).fragment;
    const target =
      (fragment ? this.document.getElementById(fragment) : null) ?? this.document.querySelector<HTMLElement>('main h1');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: !!fragment });
  }
}
