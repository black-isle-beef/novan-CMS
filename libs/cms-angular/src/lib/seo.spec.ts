import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { applyNovanSeo } from './seo';
import type { Page } from './types';

const page = (data: Page['data'], path = '/about'): Page => ({
  id: 'p',
  contentType: 'page',
  path,
  locale: 'en-GB',
  updatedAt: '2026-10-01T00:00:00Z',
  data,
});

function head(): Record<string, string | null> {
  const document = TestBed.inject(DOCUMENT);
  const content = (selector: string) => document.head.querySelector(`meta[${selector}]`)?.getAttribute('content') ?? null;
  return {
    title: TestBed.inject(Title).getTitle(),
    description: content('name="description"'),
    robots: content('name="robots"'),
    canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    ogTitle: content('property="og:title"'),
    ogDescription: content('property="og:description"'),
    ogUrl: content('property="og:url"'),
    ogImage: content('property="og:image"'),
    ogImageAlt: content('property="og:image:alt"'),
    ogLocale: content('property="og:locale"'),
    twitterCard: content('name="twitter:card"'),
  };
}

const apply = (...args: Parameters<typeof applyNovanSeo>) => TestBed.runInInjectionContext(() => applyNovanSeo(...args));

describe('applyNovanSeo', () => {
  afterEach(() => {
    const document = TestBed.inject(DOCUMENT);
    document.head.querySelectorAll('meta, link[rel="canonical"], link[hreflang]').forEach((el) => el.remove());
  });

  describe('in several languages', () => {
    const french: Page = {
      ...page({ title: 'À propos' }, '/fr/about'),
      locale: 'fr-FR',
      alternates: [
        { locale: 'en-GB', path: '/about' },
        { locale: 'fr-FR', path: '/fr/about' },
      ],
    };
    const links = () =>
      [...TestBed.inject(DOCUMENT).head.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => [link.getAttribute('hreflang'), link.getAttribute('href')]);

    it('links each language of the page, the default one as x-default, and sets the page language', () => {
      apply(french, { baseUrl: 'https://www.example.com' });
      expect(links()).toEqual([
        ['en-GB', 'https://www.example.com/about'],
        ['fr-FR', 'https://www.example.com/fr/about'],
        ['x-default', 'https://www.example.com/about'],
      ]);
      expect(head()).toMatchObject({ canonical: 'https://www.example.com/fr/about', ogLocale: 'fr_FR' });
      const document = TestBed.inject(DOCUMENT);
      expect(document.documentElement.getAttribute('lang')).toBe('fr-FR');
      expect(document.head.querySelector('meta[property="og:locale:alternate"]')?.getAttribute('content')).toBe('en_GB');
    });

    it('drops them for a page in one language, or hidden from search engines', () => {
      apply(french, { baseUrl: 'https://www.example.com' });
      apply({ ...french, alternates: [{ locale: 'fr-FR', path: '/fr/about' }] }, { baseUrl: 'https://www.example.com' });
      expect(links()).toEqual([]);
      apply({ ...french, data: { title: 'x', seo: { noindex: true } } }, { baseUrl: 'https://www.example.com' });
      expect(links()).toEqual([]);
    });
  });

  it('sets the title, description, canonical and Open Graph tags from the SEO fields', () => {
    apply(
      page({
        title: 'About',
        seo: {
          metaTitle: 'About Example Ltd',
          metaDescription: 'Who we are.',
          ogImage: { id: 'a', url: 'https://api.example.com/v1/assets/a/og.png?v=1', filename: 'og.png', mime: 'image/png', width: 1200, height: 630, alt: 'Our team', focal: null },
        },
      }),
      { baseUrl: 'https://www.example.com/', titleTemplate: (title) => `${title} | Example` },
    );

    expect(head()).toEqual({
      title: 'About Example Ltd | Example',
      description: 'Who we are.',
      robots: null,
      canonical: 'https://www.example.com/about',
      ogTitle: 'About Example Ltd',
      ogDescription: 'Who we are.',
      ogUrl: 'https://www.example.com/about',
      ogImage: 'https://api.example.com/v1/assets/a/og.png?v=1',
      ogImageAlt: 'Our team',
      ogLocale: 'en_GB',
      twitterCard: 'summary_large_image',
    });
  });

  it('falls back to the page title, honours noindex and a canonical override, and clears what the last page set', () => {
    apply(page({ title: 'First', seo: { metaDescription: 'First page' } }), { baseUrl: 'https://www.example.com' });
    apply(page({ title: 'Home', seo: { noindex: true, canonical: 'https://other.example.com/home' } }, '/'), {
      baseUrl: 'https://www.example.com',
    });

    expect(head()).toMatchObject({
      title: 'Home',
      description: null,
      robots: 'noindex',
      canonical: 'https://other.example.com/home',
      ogDescription: null,
      ogImage: null,
      twitterCard: 'summary',
    });
  });

  it("shares the site's image when the page has none of its own", () => {
    const site = { id: 's', url: 'https://api.example.com/v1/assets/s/site.jpg?v=2', filename: 'site.jpg', mime: 'image/jpeg', width: 1200, height: 630, alt: 'Our office', focal: null };
    apply(page({ title: 'About' }), { baseUrl: 'https://www.example.com', defaultImage: site });

    expect(head()).toMatchObject({ ogImage: site.url, ogImageAlt: 'Our office', twitterCard: 'summary_large_image' });
  });

  it('ignores an unsafe canonical override', () => {
    apply(page({ title: 'X', seo: { canonical: 'javascript:alert(1)' } }), { baseUrl: 'https://www.example.com' });
    expect(head()['canonical']).toBe('https://www.example.com/about');
  });
});
