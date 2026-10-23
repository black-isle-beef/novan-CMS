/** `sitemap.xml` for the given page paths (the 404 page is never one of them). */
export function sitemapXml(siteUrl: string, paths: readonly string[]): string {
  const base = siteUrl.replace(/\/+$/, '');
  const urls = paths.map((path) => `  <url>\n    <loc>${escapeXml(base + path)}</loc>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
}

/** `robots.txt`: everything may be crawled except the form proxy, and where the sitemap is. */
export function robotsTxt(siteUrl: string, proxyPath: string): string {
  return `User-agent: *\nDisallow: ${proxyPath.replace(/\/*$/, '/')}\n\nSitemap: ${siteUrl.replace(/\/+$/, '')}/sitemap.xml\n`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);
}
