import type { NovanSitemap } from '@black-isle-beef/cms-angular';

/**
 * `sitemap.xml` from the Delivery API's sitemap: one `<url>` per page address, with when it last changed. When the
 * site shows the language in addresses, a page in several languages has an address per language, and each lists the
 * others as `hreflang` alternates (the first, the site's default language, also as `x-default`), as search engines
 * ask (docs/build/16-localisation.md). Otherwise its languages share one address, listed once.
 */
export function sitemapXml(siteUrl: string, sitemap: NovanSitemap): string {
  const base = siteUrl.replace(/\/+$/, '');
  const byPage = new Map<string, NovanSitemap['items']>();
  for (const item of sitemap.items) byPage.set(item.id, [...(byPage.get(item.id) ?? []), item]);
  // One entry per address, with its latest change.
  const byPath = new Map<string, NovanSitemap['items'][number]>();
  for (const item of sitemap.items) {
    const previous = byPath.get(item.path);
    if (!previous || Date.parse(item.updatedAt) > Date.parse(previous.updatedAt)) byPath.set(item.path, item);
  }

  const urls = [...byPath.values()].map((item) => {
    const versions = byPage.get(item.id) ?? [];
    const alternates =
      new Set(versions.map((version) => version.path)).size > 1
        ? [...versions.map((version) => link(version.locale, base + version.path)), link('x-default', base + versions[0].path)]
        : [];
    return [
      '  <url>',
      `    <loc>${escapeXml(base + item.path)}</loc>`,
      `    <lastmod>${escapeXml(lastmod(item.updatedAt))}</lastmod>`,
      ...alternates,
      '  </url>',
    ].join('\n');
  });
  const namespaces = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${namespaces}>\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
}

/** `robots.txt`: everything may be crawled except the content proxy, and where the sitemap is. */
export function robotsTxt(siteUrl: string, proxyPath: string): string {
  return `User-agent: *\nDisallow: ${proxyPath.replace(/\/*$/, '/')}\n\nSitemap: ${siteUrl.replace(/\/+$/, '')}/sitemap.xml\n`;
}

function link(hreflang: string, href: string): string {
  return `    <xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}"/>`;
}

/** W3C date-time in UTC, without the microseconds the API sends. */
function lastmod(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);
}
