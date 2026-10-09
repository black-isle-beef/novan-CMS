import { CMS_PAGE_CACHE_CONTROL, withCachePolicy } from './cache-policy';
import { withoutFontPreloads } from './font-preloads';
import { robotsTxt, sitemapXml } from './sitemap';

describe('withCachePolicy', () => {
  const page = (status: number, headers: Record<string, string> = {}) => withCachePolicy(new Response('<html></html>', { status, headers }));

  it('caches a page at the edge when it carries Delivery API tags', () => {
    const response = page(200, { 'Cache-Tag': 'space:s,entry:e' });

    expect(response.headers.get('Cache-Control')).toBe(CMS_PAGE_CACHE_CONTROL);
    expect(response.headers.get('Cache-Tag')).toBe('space:s,entry:e');
  });

  it('keeps a Cache-Control set during the render (preview, or a failed API answer)', () => {
    expect(page(200, { 'Cache-Control': 'private, no-store', 'Cache-Tag': 'space:s' }).headers.get('Cache-Control')).toBe('private, no-store');
    const failed = page(200, { 'Cache-Control': 'no-store', 'Cache-Tag': 'space:s' });
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    expect(failed.headers.has('Cache-Tag')).toBe(false);
  });

  it.each([
    ['a 404', 404, { 'Cache-Tag': 'space:s' }],
    ['a 503', 503, {}],
    ['a page with no tags to purge it by', 200, {}],
  ])('does not store %s', (_label, status, headers) => {
    const response = page(status, headers);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('Cache-Tag')).toBe(false);
    expect(response.status).toBe(status);
  });

  it('keeps the body and other headers', async () => {
    const response = page(200, { 'Cache-Tag': 'space:s', 'Content-Type': 'text/html' });

    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(await response.text()).toBe('<html></html>');
  });
});

describe('sitemapXml', () => {
  it('lists each page path once, with its latest change, escaped', () => {
    const xml = sitemapXml('https://www.example.com/', {
      items: [
        { path: '/', locale: 'en-GB', updatedAt: '2026-10-05T09:30:00.123456+00:00' },
        { path: '/about', locale: 'en-GB', updatedAt: '2026-10-01T09:30:00Z' },
        { path: '/about', locale: 'cy', updatedAt: '2026-10-04T09:30:00Z' },
        { path: '/a&b', locale: 'en-GB', updatedAt: '2026-10-01T09:30:00Z' },
      ],
    });

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://www.example.com/</loc>\n    <lastmod>2026-10-05T09:30:00Z</lastmod>');
    expect(xml.match(/<loc>https:\/\/www\.example\.com\/about<\/loc>/g)).toHaveLength(1);
    expect(xml).toContain('<lastmod>2026-10-04T09:30:00Z</lastmod>');
    expect(xml).toContain('<loc>https://www.example.com/a&amp;b</loc>');
  });

  it('is a valid empty sitemap without pages', () => {
    expect(sitemapXml('https://x.test', { items: [] })).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n',
    );
  });
});

describe('robotsTxt', () => {
  it('allows crawling, keeps crawlers out of the content proxy and points at the sitemap', () => {
    expect(robotsTxt('https://www.example.com/', '/_novan')).toBe(
      'User-agent: *\nDisallow: /_novan/\n\nSitemap: https://www.example.com/sitemap.xml\n',
    );
  });
});

describe('withoutFontPreloads', () => {
  const head =
    '<link rel="icon" href="favicon.ico">' +
    '<link rel="preload" as="font" crossorigin="anonymous" href="/media/inter-latin-400-normal.woff2">' +
    '<link rel="preload" href="/media/bootstrap-icons.woff2" as="font" crossorigin="anonymous">' +
    '<link rel="preload" href="hero.jpg" as="image">' +
    '<link rel="stylesheet" href="styles.css" media="print" data-beasties-media="all">';

  it('takes out the font preloads and keeps every other link', async () => {
    const response = await withoutFontPreloads(
      new Response(`<head>${head}</head>`, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '999', 'Cache-Tag': 'space:s' } }),
    );

    expect(await response.text()).toBe(
      '<head><link rel="icon" href="favicon.ico"><link rel="preload" href="hero.jpg" as="image">' +
        '<link rel="stylesheet" href="styles.css" media="print" data-beasties-media="all"></head>',
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Tag')).toBe('space:s');
    expect(response.headers.has('Content-Length')).toBe(false);
  });

  it('leaves responses other than pages alone', async () => {
    const json = new Response(head, { headers: { 'Content-Type': 'application/json' } });

    expect(await withoutFontPreloads(json)).toBe(json);
  });
});