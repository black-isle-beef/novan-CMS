import { allowedHosts, siteUrl, webServerConfig } from '../web.server';
import { NO_STORE, PAGE_CACHE_CONTROL, withCachePolicy } from './cache-policy';
import { robotsTxt, sitemapXml } from './seo-files';

describe('webServerConfig', () => {
  it('reads the addresses and the contact form from the environment', () => {
    const config = webServerConfig({
      MARKETING_SITE_URL: 'https://novan.example/',
      CMS_LOGIN_URL: 'https://admin.novan.example/sign-in',
      NOVAN_API_URL: 'https://api.novan.example/',
      MARKETING_DELIVERY_TOKEN: 'nv_del_x',
      MARKETING_CONTACT_ENTRY_ID: 'entry',
      MARKETING_CONTACT_FORM_UID: 'form',
    });

    expect(config).toEqual({
      siteUrl: 'https://novan.example',
      cmsLoginUrl: 'https://admin.novan.example/sign-in',
      apiUrl: 'https://api.novan.example',
      deliveryToken: 'nv_del_x',
      contactForm: { entryId: 'entry', formUid: 'form' },
    });
  });

  it('defaults the login link to the admin address, else the local admin', () => {
    expect(webServerConfig({ ADMIN_URL: 'https://admin.staging.novan.example/' }).cmsLoginUrl).toBe('https://admin.staging.novan.example/sign-in');
    expect(webServerConfig({}).cmsLoginUrl).toBe('http://localhost:4200/sign-in');
  });

  it('offers no contact form without its page, its block and a token', () => {
    expect(webServerConfig({ MARKETING_CONTACT_ENTRY_ID: 'entry', MARKETING_CONTACT_FORM_UID: 'form' }).contactForm).toBeNull();
    expect(webServerConfig({ MARKETING_DELIVERY_TOKEN: 'nv_del_x', MARKETING_CONTACT_FORM_UID: 'form' }).contactForm).toBeNull();
  });

  it("uses the request's origin when no site address is set", () => {
    expect(siteUrl(webServerConfig({}), 'http://localhost:4100/')).toBe('http://localhost:4100');
    expect(siteUrl(webServerConfig({ MARKETING_SITE_URL: 'https://novan.example' }), 'http://internal:4000')).toBe('https://novan.example');
  });

  it('allows the site host and any extra hosts', () => {
    expect(allowedHosts({})).toBeUndefined();
    expect(allowedHosts({ MARKETING_SITE_URL: 'https://novan.example', NG_ALLOWED_HOSTS: 'staging.novan.example, localhost' })).toEqual([
      'staging.novan.example',
      'localhost',
      'novan.example',
    ]);
  });
});

describe('withCachePolicy', () => {
  it('lets the CDN keep a page and never stores errors', () => {
    expect(withCachePolicy(new Response('ok', { status: 200 })).headers.get('Cache-Control')).toBe(PAGE_CACHE_CONTROL);
    expect(withCachePolicy(new Response('missing', { status: 404 })).headers.get('Cache-Control')).toBe(NO_STORE);
    const kept = withCachePolicy(new Response('ok', { status: 200, headers: { 'Cache-Control': 'private' } }));
    expect(kept.headers.get('Cache-Control')).toBe('private');
  });
});

describe('sitemap.xml and robots.txt', () => {
  it('lists absolute addresses, escaped', () => {
    const xml = sitemapXml('https://novan.example/', ['/', '/features', "/a&b'"]);
    expect(xml).toContain('<loc>https://novan.example/</loc>');
    expect(xml).toContain('<loc>https://novan.example/features</loc>');
    expect(xml).toContain('<loc>https://novan.example/a&amp;b&apos;</loc>');
  });

  it('keeps crawlers off the form proxy and points to the sitemap', () => {
    expect(robotsTxt('https://novan.example/', '/_novan')).toBe('User-agent: *\nDisallow: /_novan/\n\nSitemap: https://novan.example/sitemap.xml\n');
  });
});
