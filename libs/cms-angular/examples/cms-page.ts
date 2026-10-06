import { ChangeDetectionStrategy, Component, computed, effect, inject, Injector, input } from '@angular/core';
import { applyNovanSeo, NovanBlocks, NovanPreview, type Page } from '@black-isle-beef/cms-angular';

@Component({
  selector: 'site-cms-page',
  imports: [NovanBlocks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main id="main-content">
      @if (shown(); as page) {
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
  private readonly preview = inject(NovanPreview);

  /** In the admin's visual editor, the page follows the editor's changes as they are made. */
  protected readonly shown = computed(() => this.preview.withLiveData(this.page()));

  constructor() {
    effect(() => applyNovanSeo(this.shown(), { injector: this.injector, baseUrl: 'https://www.example.com' }));
  }
}
