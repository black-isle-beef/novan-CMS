import { DOCUMENT, inject, Injector } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { applyNovanLang } from './locale';
import type { NovanAsset, Page, PageData } from './types';

export interface NovanSeoOptions {
  /** Needed outside an injection context, e.g. in a subscription. */
  injector?: Injector;
  /** The site's public address, e.g. `https://www.example.com`, for canonical and Open Graph URLs. Defaults to the current origin. */
  baseUrl?: string;
  /** Builds the document title, e.g. `(title) => `${title} | Example``. */
  titleTemplate?: (title: string) => string;
  /** `og:site_name`. */
  siteName?: string;
  /** Shared when the page has no `seo.ogImage`: the site's sharing image (`siteSettings.defaultOgImage`). */
  defaultImage?: NovanAsset | null;
}

/**
 * Sets the page's `<title>`, meta description, canonical link, robots `noindex` and Open Graph tags from its
 * `title` and `seo` fields, falling back to the site's sharing image for `og:image`. Tags a page leaves empty
 * are removed, so nothing lingers from the previous page. For a site in several languages it also sets `<html lang>`,
 * an `hreflang` link for each locale the page is in (`x-default` pointing at the first, the site's default) and
 * `og:locale:alternate` (docs/build/16-localisation.md).
 */
export function applyNovanSeo(page: Page<PageData> | null | undefined, options: NovanSeoOptions = {}): void {
  const injector = options.injector ?? inject(Injector);
  const meta = injector.get(Meta);
  const title = injector.get(Title);
  const document = injector.get(DOCUMENT);
  if (!page) return;
  applyNovanLang(page.locale, { injector });

  const seo = page.data.seo ?? {};
  const pageTitle = text(seo.metaTitle) ?? text(page.data.title) ?? '';
  const description = text(seo.metaDescription);
  const base = (options.baseUrl ?? document.location?.origin ?? '').replace(/\/+$/, '');
  const canonical = absoluteHttpUrl(seo.canonical) ?? (base ? `${base}${page.path === '/' ? '/' : page.path}` : null);
  const image = [seo.ogImage, options.defaultImage].find((asset): asset is NovanAsset => !!asset && absoluteHttpUrl(asset.url) !== null) ?? null;

  title.setTitle(options.titleTemplate ? options.titleTemplate(pageTitle) : pageTitle);
  setName(meta, 'description', description);
  setName(meta, 'robots', seo.noindex ? 'noindex' : null);
  setProperty(meta, 'og:type', 'website');
  setProperty(meta, 'og:title', pageTitle || null);
  setProperty(meta, 'og:description', description);
  setProperty(meta, 'og:url', canonical);
  setProperty(meta, 'og:site_name', text(options.siteName));
  setProperty(meta, 'og:locale', page.locale.replace('-', '_'));
  setProperty(meta, 'og:image', image?.url ?? null);
  setProperty(meta, 'og:image:alt', text(image?.alt));
  setProperty(meta, 'og:image:width', image?.width ? String(image.width) : null);
  setProperty(meta, 'og:image:height', image?.height ? String(image.height) : null);
  setName(meta, 'twitter:card', image ? 'summary_large_image' : 'summary');
  setCanonical(document, canonical);

  // Other languages: only when the page is in more than one, and never for a page hidden from search engines.
  const alternates = !seo.noindex && base && (page.alternates?.length ?? 0) > 1 ? (page.alternates ?? []) : [];
  setAlternates(
    document,
    alternates.length ? [...alternates.map((alt) => ({ hreflang: alt.locale, href: `${base}${alt.path}` })), { hreflang: 'x-default', href: `${base}${alternates[0].path}` }] : [],
  );
  meta.getTags('property="og:locale:alternate"').forEach((tag) => meta.removeTagElement(tag));
  for (const alt of alternates) {
    if (alt.locale !== page.locale) meta.addTag({ property: 'og:locale:alternate', content: alt.locale.replace('-', '_') });
  }
}

/** Replaces the head's `<link rel="alternate" hreflang>` links. */
function setAlternates(document: Document, links: { hreflang: string; href: string }[]): void {
  document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((link) => link.remove());
  for (const { hreflang, href } of links) {
    const link = document.createElement('link');
    link.setAttribute('rel', 'alternate');
    link.setAttribute('hreflang', hreflang);
    link.setAttribute('href', href);
    document.head.appendChild(link);
  }
}

function setName(meta: Meta, name: string, content: string | null): void {
  if (content === null) meta.removeTag(`name="${name}"`);
  else meta.updateTag({ name, content });
}

function setProperty(meta: Meta, property: string, content: string | null): void {
  if (content === null) meta.removeTag(`property="${property}"`);
  else meta.updateTag({ property, content });
}

function setCanonical(document: Document, href: string | null): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function absoluteHttpUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\/[^/\\]/i.test(value) ? value : null;
}
