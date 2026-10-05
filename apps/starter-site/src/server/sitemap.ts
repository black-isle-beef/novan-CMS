import type { NovanSitemap } from '@black-isle-beef/cms-angular';

/** `sitemap.xml` from the Delivery API's sitemap: one `<url>` per page path, with when it last changed. */
export function sitemapXml(siteUrl: string, sitemap: NovanSitemap): string {
  const base = siteUrl.replace(/\/+$/, '');
  // A page published in several locales shares its path; keep the latest change.
  const latest = new Map<string, string>();
  for (const item of sitemap.items) {
    const previous = latest.get(item.path);
    if (!previous || Date.parse(item.updatedAt) > Date.parse(previous)) latest.set(item.path, item.updatedAt);
  }
  const urls = [...latest].map(
    ([path, updatedAt]) => `  <url>\n    <loc>${escapeXml(base + path)}</loc>\n    <lastmod>${escapeXml(lastmod(updatedAt))}</lastmod>\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
}

/** `robots.txt`: everything may be crawled except the content proxy, and where the sitemap is. */
export function robotsTxt(siteUrl: string, proxyPath: string): string {
  return `User-agent: *\nDisallow: ${proxyPath.replace(/\/*$/, '/')}\n\nSitemap: ${siteUrl.replace(/\/+$/, '')}/sitemap.xml\n`;
}

/** W3C date-time in UTC, without the microseconds the API sends. */
function lastmod(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);
}
