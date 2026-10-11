import { ChangeDetectionStrategy, Component, effect, inject, Injector, input } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { applyNovanLang, NovanLocale, NovanSearch } from '@black-isle-beef/cms-angular';
import type { SiteContent } from '../site/site-content';

/**
 * Site search at `/search` (docs/build/18-search-forms-audit.md): `<novan-search>` over the published pages, with the
 * search kept in the address (`/search?q=roses`) so results can be shared and the back button works. Search results
 * are kept out of search engines.
 */
@Component({
  selector: 'site-search-page',
  imports: [NovanSearch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container py-8">
      <h1 class="mb-4">Search</h1>
      <novan-search class="col-lg-8" type="page" [query]="q() ?? ''" (queryChange)="searched($event)" />
    </div>
  `,
})
export class SearchPage {
  /** `?q=`, from the router: undefined when the address has none. */
  readonly q = input<string | undefined>(undefined);
  /** From the layout route's `siteContentResolver`. */
  readonly site = input<SiteContent | null>(null);

  private readonly router = inject(Router);

  constructor() {
    const title = inject(Title);
    const meta = inject(Meta);
    const locale = inject(NovanLocale);
    const injector = inject(Injector);
    effect(() => {
      const siteName = this.site()?.siteName;
      title.setTitle(siteName ? `Search | ${siteName}` : 'Search');
      meta.updateTag({ name: 'robots', content: 'noindex' });
      applyNovanLang(locale.current(), { injector });
    });
  }

  protected searched(q: string): void {
    // Untrimmed: the address follows the box as people type, spaces included.
    void this.router.navigate([], { queryParams: { q: q || null }, replaceUrl: true });
  }
}
