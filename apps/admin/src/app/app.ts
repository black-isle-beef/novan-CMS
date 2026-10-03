import { afterNextRender, ChangeDetectionStrategy, Component, DOCUMENT, effect, inject, Injector } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';

@Component({
  imports: [RouterOutlet],
  selector: 'nv-root',
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  /** Every in-app navigation after the first load. */
  private readonly navigated = toSignal(
    inject(Router).events.pipe(
      filter((event) => event instanceof NavigationEnd),
      skip(1),
    ),
  );

  constructor() {
    // Move focus to the new page's heading so screen-reader users hear where they are. The first
    // load keeps the browser's default focus.
    effect(() => {
      if (!this.navigated()) return;
      afterNextRender(() => this.focusHeading(), { injector: this.injector });
    });
  }

  private focusHeading(): void {
    const heading = this.document.querySelector<HTMLElement>('main h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }
}
