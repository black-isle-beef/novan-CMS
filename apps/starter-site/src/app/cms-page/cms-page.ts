import { ChangeDetectionStrategy, Component, computed, effect, inject, Injector, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { applyNovanSeo, NovanBlocks } from '@black-isle-beef/cms-angular';
import type { SiteContent } from '../site/site-content';
import type { CmsPageState } from './cms-page.resolver';

/**
 * Every address on the site: a CMS page rendered from its blocks, the CMS's "page not found" content (or a
 * built-in one), or a short apology when the content could not be loaded.
 */
@Component({
  selector: 'site-cms-page',
  imports: [NovanBlocks, RouterLink],
  templateUrl: './cms-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CmsPage {
  /** From `cmsPageResolver`. */
  readonly page = input.required<CmsPageState>();
  /** From the layout route's `siteContentResolver`. */
  readonly site = input<SiteContent | null>(null);

  /** A page whose blocks include no hero still needs its title as the page's main heading. */
  protected readonly needsTitle = computed(() => {
    const state = this.page();
    return state.status === 'found' && !(state.page.data.body ?? []).some((block) => block?._block === 'hero');
  });

  private readonly injector = inject(Injector);
  private readonly title = inject(Title);

  constructor() {
    effect(() => {
      const state = this.page();
      const siteName = this.site()?.siteName;
      const titled = (text: string) => (siteName && text !== siteName ? `${text} | ${siteName}` : text);
      if (state.status === 'found') {
        applyNovanSeo(state.page, { injector: this.injector, siteName, titleTemplate: titled });
      } else if (state.status === 'not-found') {
        this.title.setTitle(titled(state.notFound?.title?.trim() || 'Page not found'));
      } else {
        this.title.setTitle(titled('Page not available'));
      }
    });
  }
}
