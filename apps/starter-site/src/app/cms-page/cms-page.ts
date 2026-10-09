import { ChangeDetectionStrategy, Component, computed, effect, inject, Injector, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import {
  applyNovanJsonLd,
  applyNovanSeo,
  novanBreadcrumbJsonLd,
  novanBreadcrumbTrail,
  NovanBlocks,
  NovanPreview,
} from '@black-isle-beef/cms-angular';
import type { SiteContent } from '../site/site-content';
import { SITE_URL } from '../site/site-url';
import type { CmsPageState } from './cms-page.resolver';

/**
 * Every address on the site: a CMS page rendered from its blocks, the CMS's "page not found" content (or a
 * built-in one), or a short apology when the content could not be loaded. A page sets its SEO tags (the site's
 * sharing image when it has none) and `BreadcrumbList` structured data.
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

  private readonly preview = inject(NovanPreview);

  /** The page to show: in the visual editor, with the editor's unsaved changes. */
  protected readonly shown = computed<CmsPageState>(() => {
    const state = this.page();
    return state.status === 'found' ? { ...state, page: this.preview.withLiveData(state.page) } : state;
  });

  /** A page whose blocks include no hero still needs its title as the page's main heading. */
  protected readonly needsTitle = computed(() => {
    const state = this.shown();
    return state.status === 'found' && !(state.page.data.body ?? []).some((block) => block?._block === 'hero');
  });

  private readonly injector = inject(Injector);
  private readonly title = inject(Title);
  private readonly siteUrl = inject(SITE_URL);

  constructor() {
    effect(() => {
      const state = this.shown();
      const site = this.site();
      const siteName = site?.siteName;
      const titled = (text: string) => (siteName && text !== siteName ? `${text} | ${siteName}` : text);
      const page = state.status === 'found' ? state.page : null;
      const trail = page ? novanBreadcrumbJsonLd(novanBreadcrumbTrail(page, { homeName: siteName }), this.siteUrl) : null;
      applyNovanJsonLd('breadcrumbs', trail, { injector: this.injector });
      if (page) {
        applyNovanSeo(page, { injector: this.injector, siteName, titleTemplate: titled, baseUrl: this.siteUrl, defaultImage: site?.shareImage });
      } else if (state.status === 'not-found') {
        this.title.setTitle(titled(state.notFound?.title?.trim() || 'Page not found'));
      } else {
        this.title.setTitle(titled('Page not available'));
      }
    });
  }
}
