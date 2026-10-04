import { ChangeDetectionStrategy, Component, effect, inject, Injector, input } from '@angular/core';
import { applyNovanSeo, NovanBlocks, type Page } from '@novan/cms-angular';

@Component({
  selector: 'site-cms-page',
  imports: [NovanBlocks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main id="main-content">
      @if (page(); as page) {
        <novan-blocks [blocks]="page.data.body" />
      } @else {
        <h1>Page not found</h1>
        <p>There is no page at this address.</p>
      }
    </main>
  `,
})
export class CmsPage {
  /** From the route's resolver (`withComponentInputBinding()`). */
  readonly page = input<Page | null>(null);

  private readonly injector = inject(Injector);

  constructor() {
    effect(() => applyNovanSeo(this.page(), { injector: this.injector, baseUrl: 'https://www.example.com' }));
  }
}
