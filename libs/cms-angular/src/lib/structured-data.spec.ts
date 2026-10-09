import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { applyNovanJsonLd, novanBreadcrumbJsonLd, novanBreadcrumbTrail, novanOrganizationJsonLd } from './structured-data';
import type { NovanAsset } from './types';

const logo: NovanAsset = {
  id: 'l',
  url: 'https://api.example.com/v1/assets/l/logo.svg?v=1',
  filename: 'logo.svg',
  mime: 'image/svg+xml',
  width: 200,
  height: 60,
  alt: null,
  focal: null,
};

describe('novanOrganizationJsonLd', () => {
  it('describes the organisation from the site settings', () => {
    expect(
      novanOrganizationJsonLd(
        {
          siteName: 'Example',
          organisationName: 'Example Ltd',
          logo,
          contact: { email: 'hello@example.com', phone: '+44 20 7946 0000', address: '1 High Street\nLondon' },
          socialLinks: [{ network: 'linkedin', url: 'https://www.linkedin.com/company/example' }, { network: 'x', url: 'javascript:alert(1)' }],
        },
        'https://www.example.com/',
      ),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Example Ltd',
      url: 'https://www.example.com/',
      logo: logo.url,
      email: 'hello@example.com',
      telephone: '+44 20 7946 0000',
      address: { '@type': 'PostalAddress', streetAddress: '1 High Street\nLondon' },
      sameAs: ['https://www.linkedin.com/company/example'],
    });
  });

  it('falls back to the site name, leaves out what is empty, and needs a name', () => {
    expect(novanOrganizationJsonLd({ siteName: 'Example', contact: { email: ' ' } }, 'https://x.test')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Example',
      url: 'https://x.test/',
    });
    expect(novanOrganizationJsonLd({}, 'https://x.test')).toBeNull();
    expect(novanOrganizationJsonLd(null, 'https://x.test')).toBeNull();
  });
});

describe('breadcrumbs', () => {
  it('trail from the home page through the folders to the page', () => {
    const trail = novanBreadcrumbTrail({ path: '/our-team/people/ada', data: { title: 'Ada Lovelace' } }, { names: { '/our-team': 'Team' } });

    expect(trail).toEqual([
      { name: 'Home', path: '/' },
      { name: 'Team', path: '/our-team' },
      { name: 'People', path: '/our-team/people' },
      { name: 'Ada Lovelace', path: '/our-team/people/ada' },
    ]);
    expect(novanBreadcrumbJsonLd(trail, 'https://www.example.com/')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.example.com/' },
        { '@type': 'ListItem', position: 2, name: 'Team', item: 'https://www.example.com/our-team' },
        { '@type': 'ListItem', position: 3, name: 'People', item: 'https://www.example.com/our-team/people' },
        { '@type': 'ListItem', position: 4, name: 'Ada Lovelace', item: 'https://www.example.com/our-team/people/ada' },
      ],
    });
  });

  it('has no list for the home page', () => {
    const trail = novanBreadcrumbTrail({ path: '/', data: { title: 'Welcome' } }, { homeName: 'Start' });
    expect(trail).toEqual([{ name: 'Start', path: '/' }]);
    expect(novanBreadcrumbJsonLd(trail, 'https://x.test')).toBeNull();
  });
});

describe('applyNovanJsonLd', () => {
  const scripts = () => [...TestBed.inject(DOCUMENT).head.querySelectorAll('script[type="application/ld+json"]')];
  const apply = (...args: Parameters<typeof applyNovanJsonLd>) => TestBed.runInInjectionContext(() => applyNovanJsonLd(...args));

  afterEach(() => scripts().forEach((script) => script.remove()));

  it('writes one script per key, replacing it, and removes it for null', () => {
    apply('organisation', { name: 'A' });
    apply('organisation', { name: 'B' });
    apply('breadcrumbs', { name: 'C' });

    expect(scripts().map((script) => [script.id, script.textContent])).toEqual([
      ['novan-ld-organisation', '{"name":"B"}'],
      ['novan-ld-breadcrumbs', '{"name":"C"}'],
    ]);
    apply('breadcrumbs', null);
    expect(scripts()).toHaveLength(1);
  });

  it('cannot be closed early by the text it carries', () => {
    apply('organisation', { name: '</script><script>alert(1)</script>' });

    expect(scripts()[0].textContent).toBe('{"name":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}');
    expect(JSON.parse(scripts()[0].textContent ?? '')).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});
