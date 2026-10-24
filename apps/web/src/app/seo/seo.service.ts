import { DOCUMENT, inject, Injectable, Injector } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { applyNovanJsonLd, type NovanJsonLd } from '@black-isle-beef/cms-angular';
import { type PageMeta, site } from '@novan/marketing-content';
import { SITE_CONFIG } from '../config/site-config';

/** What a route puts in `data.seo`. */
export interface SeoConfig extends PageMeta {
  /** Social image path or URL. None yet: TODO(copy) add a 1200×630 social image. */
  image?: string;
  type?: 'website' | 'article';
  /** Keeps the page out of search results (the 404 page). */
  noIndex?: boolean;
  /** Structured data for this page, built from the site's origin. Each key is one script, removed on other pages. */
  jsonLd?: (siteUrl: string) => Readonly<Record<string, NovanJsonLd>>;
}

/** Every JSON-LD key the pages use, so a page without one removes what the last page added. */
export const JSON_LD_KEYS = ['organization', 'software'] as const;

/**
 * Applies a route's SEO on every navigation (`SeoTitleStrategy`): title, description, robots, canonical link, Open
 * Graph, Twitter card and JSON-LD. Tags are upserted by name, so client-side navigation never accumulates them, and
 * the server-rendered head already carries them.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly injector = inject(Injector);
  private readonly config = inject(SITE_CONFIG);

  apply(seo: SeoConfig, url: string): void {
    const origin = this.config.siteUrl.replace(/\/+$/, '');
    const title = seo.title.includes(site.productName) ? seo.title : `${seo.title} | ${site.productName}`;
    const canonical = origin + canonicalPath(url);
    const image = seo.image ? new URL(seo.image, `${origin}/`).href : null;

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: seo.description });
    this.meta.updateTag({ name: 'robots', content: seo.noIndex ? 'noindex, follow' : 'index, follow' });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: seo.description });
    this.meta.updateTag({ property: 'og:type', content: seo.type ?? 'website' });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ property: 'og:site_name', content: site.productName });
    this.meta.updateTag({ property: 'og:locale', content: 'en_GB' });
    this.meta.updateTag({ name: 'twitter:card', content: image ? 'summary_large_image' : 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: seo.description });
    if (image) {
      this.meta.updateTag({ property: 'og:image', content: image });
      this.meta.updateTag({ name: 'twitter:image', content: image });
    } else {
      this.meta.removeTag("property='og:image'");
      this.meta.removeTag("name='twitter:image'");
    }
    this.setCanonical(seo.noIndex ? null : canonical);

    const jsonLd = seo.jsonLd?.(origin) ?? {};
    for (const key of JSON_LD_KEYS) applyNovanJsonLd(key, jsonLd[key] ?? null, { injector: this.injector });
  }

  /** Exactly one canonical link, or none on pages kept out of search results. */
  private setCanonical(href: string | null): void {
    const links = this.document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');
    links.forEach((link, index) => index > 0 && link.remove());
    let link = links[0] ?? null;
    if (!href) {
      link?.remove();
      return;
    }
    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'canonical';
      this.document.head.appendChild(link);
    }
    link.href = href;
  }
}

/** The path alone, with no query, fragment or trailing slash (except the home page's). */
export function canonicalPath(url: string): string {
  const path = url.split(/[?#]/)[0] || '/';
  return path === '/' ? '/' : path.replace(/\/+$/, '');
}
