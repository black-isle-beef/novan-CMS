import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SITE_CONFIG } from '../config/site-config';
import { canonicalPath, SeoService } from './seo.service';
import { homeJsonLd } from './structured-data';

describe('SeoService', () => {
  let seo: SeoService;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: SITE_CONFIG, useValue: { siteUrl: 'https://novan.example/', cmsLoginUrl: '', contactForm: null } }],
    });
    seo = TestBed.inject(SeoService);
    doc = TestBed.inject(DOCUMENT);
  });

  const meta = (selector: string) => doc.head.querySelector(`meta[${selector}]`)?.getAttribute('content');

  it('sets the title with the product name, description, robots, Open Graph and Twitter tags', () => {
    seo.apply({ title: 'Pricing', description: 'Plans and prices.' }, '/pricing?enquiry=sales#faq');

    expect(doc.title).toBe('Pricing | Novan CMS');
    expect(meta('name="description"')).toBe('Plans and prices.');
    expect(meta('name="robots"')).toBe('index, follow');
    expect(meta('property="og:title"')).toBe('Pricing | Novan CMS');
    expect(meta('property="og:url"')).toBe('https://novan.example/pricing');
    expect(meta('property="og:locale"')).toBe('en_GB');
    expect(meta('name="twitter:card"')).toBe('summary');
    expect(doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://novan.example/pricing');
  });

  it('keeps a title that already names the product', () => {
    seo.apply({ title: 'Novan CMS: a simple CMS', description: 'Home.' }, '/');
    expect(doc.title).toBe('Novan CMS: a simple CMS');
  });

  it('replaces tags on the next page instead of adding more, and keeps one canonical link', () => {
    seo.apply({ title: 'Features', description: 'One.' }, '/features');
    seo.apply({ title: 'Contact us', description: 'Two.' }, '/contact');

    expect(doc.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(doc.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://novan.example/contact');
  });

  it('keeps the 404 page out of search results, with no canonical link', () => {
    seo.apply({ title: 'Features', description: 'One.' }, '/features');
    seo.apply({ title: 'Page not found', description: 'Gone.', noIndex: true }, '/missing');

    expect(meta('name="robots"')).toBe('noindex, follow');
    expect(doc.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('adds the home page structured data and removes it on other pages', () => {
    seo.apply({ title: 'Home', description: 'Home.', jsonLd: homeJsonLd }, '/');
    const scripts = Array.from(doc.head.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'));
    const types = scripts.map((script) => JSON.parse(script.textContent ?? '{}')['@type']);
    expect(types.sort()).toEqual(['Organization', 'SoftwareApplication']);
    expect(JSON.parse(scripts[0].textContent ?? '{}').url).toBe('https://novan.example/');

    seo.apply({ title: 'Features', description: 'One.' }, '/features');
    expect(doc.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0);
  });
});

describe('canonicalPath', () => {
  it('drops the query, the fragment and any trailing slash, except on the home page', () => {
    expect(canonicalPath('/')).toBe('/');
    expect(canonicalPath('/?utm=x')).toBe('/');
    expect(canonicalPath('/features/#roles')).toBe('/features');
    expect(canonicalPath('/contact?enquiry=demo')).toBe('/contact');
  });
});
