import { provideHttpClient } from '@angular/common/http';
import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NovanApiError, NovanContentService, type NovanLocales, provideNovanCms, type Page } from '@black-isle-beef/cms-angular';
import { novanBlocks } from '@novan/blocks';
import { type Observable, of, throwError } from 'rxjs';
import { appRoutes } from './app.routes';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const pages: Record<string, Page> = {
  '/': {
    id: uid(1),
    contentType: 'page',
    path: '/',
    locale: 'en-GB',
    updatedAt: '2026-10-05T09:00:00Z',
    data: { title: 'Home', body: [{ _uid: uid(11), _block: 'hero', heading: 'Welcome home' }] },
  },
  '/about': {
    id: uid(2),
    contentType: 'page',
    path: '/about',
    locale: 'en-GB',
    updatedAt: '2026-10-05T09:00:00Z',
    data: {
      title: 'About',
      seo: { metaTitle: 'About us' },
      body: [{ _uid: uid(21), _block: 'cta', heading: 'Talk to us', _style: { tone: 'dark' } }],
    },
  },
};

const singletons: Record<string, unknown> = {
  navigation: {
    items: [
      { label: 'Home', link: { type: 'internal', entryId: uid(1), path: '/' } },
      { label: 'About', link: { type: 'internal', entryId: uid(2), path: '/about' } },
    ],
    footerGroups: [{ title: 'More', links: [{ label: 'Email', link: { type: 'email', email: 'hi@example.com' } }] }],
  },
  siteSettings: {
    siteName: 'Test site',
    organisationName: 'Test Ltd',
    contact: { email: 'hello@test.example', address: '1 Test Street\nTestville' },
    socialLinks: [{ network: 'linkedin', url: 'https://www.linkedin.com/company/test' }],
  },
  notFound: { title: 'Lost?', body: [{ _uid: uid(31), _block: 'cta', heading: 'Try the home page' }] },
};

const english = { code: 'en-GB', name: 'English', fallback: null, isDefault: true, prefix: 'en' };

function setup(
  overrides: Partial<Record<'page' | 'singleton', (key: string, options?: { locale?: string }) => Observable<unknown>>> & { locales?: NovanLocales } = {},
) {
  const response: ResponseInit = {};
  TestBed.configureTestingModule({
    providers: [
      provideRouter(appRoutes, withComponentInputBinding(), withRouterConfig({ paramsInheritanceStrategy: 'always' })),
      provideHttpClient(),
      provideNovanCms({ blocks: novanBlocks }),
      { provide: RESPONSE_INIT, useValue: response },
      {
        provide: NovanContentService,
        useValue: {
          page: overrides.page ?? ((path: string) => of(pages[path] ?? null)),
          singleton: overrides.singleton ?? ((apiId: string) => (apiId in singletons ? of(singletons[apiId]) : throwError(() => new Error('none')))),
          locales: () => of(overrides.locales ?? { locales: [english], prefixes: false }),
        },
      },
    ],
  });
  return response;
}

describe('starter site routes', () => {
  it('renders a CMS page from its blocks, inside the header and footer from the singletons', async () => {
    setup();
    const harness = await RouterTestingHarness.create('/about');
    const root = harness.routeNativeElement?.ownerDocument.body ?? document.body;

    expect(root.querySelector('main#ds-main-content novan-cta-block h2')?.textContent).toBe('Talk to us');
    expect(root.querySelector('novan-cta-block')?.classList).toContain('novan-cta-block--tone-dark');
    expect(root.querySelector('ds-header [dsBrand]')?.textContent?.trim()).toBe('Test site');
    expect(root.querySelector('ds-footer')?.textContent).toContain('Test Ltd');
    expect(root.querySelector('ds-footer a[href="mailto:hi@example.com"]')?.textContent).toBe('Email');
    expect(root.querySelector('ds-header a[aria-current="page"]')?.textContent?.trim()).toBe('About');
  });

  it('shows the contact details and social links in the footer', async () => {
    setup();
    const harness = await RouterTestingHarness.create('/about');
    const footer = (harness.routeNativeElement?.ownerDocument.body ?? document.body).querySelector('ds-footer');

    expect([...(footer?.querySelectorAll('address span') ?? [])].map((line) => line.textContent)).toEqual(['1 Test Street', 'Testville']);
    expect(footer?.querySelector('address a[href="mailto:hello@test.example"]')).not.toBeNull();
    expect(footer?.querySelector('ul[aria-label="Social media"] a')?.getAttribute('href')).toBe('https://www.linkedin.com/company/test');
  });

  it('describes the organisation and the trail to the page to search engines', async () => {
    setup();
    await RouterTestingHarness.create('/about');
    const data = (id: string) => JSON.parse(document.getElementById(id)?.textContent ?? 'null');

    expect(data('novan-ld-organisation')).toMatchObject({ '@type': 'Organization', name: 'Test Ltd', email: 'hello@test.example' });
    expect(data('novan-ld-breadcrumbs').itemListElement.map((item: { name: string }) => item.name)).toEqual(['Test site', 'About']);
  });

  it('shows the page title as the main heading when the page has no hero', async () => {
    setup();
    const harness = await RouterTestingHarness.create('/about');

    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe('About');
  });

  it('uses the hero as the main heading when there is one', async () => {
    setup();
    const harness = await RouterTestingHarness.create('/');
    const el = harness.routeNativeElement as HTMLElement;

    expect([...el.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['Welcome home']);
  });

  it('sets the document title from the page and the site name', async () => {
    setup();
    await RouterTestingHarness.create('/about');

    expect(document.title).toBe('About us | Test site');
  });

  it('answers 404 with the CMS "page not found" content', async () => {
    const response = setup();
    const harness = await RouterTestingHarness.create('/missing');
    const el = harness.routeNativeElement as HTMLElement;

    expect(response.status).toBe(404);
    expect(el.querySelector('h1')?.textContent).toBe('Lost?');
    expect(el.querySelector('novan-cta-block h2')?.textContent).toBe('Try the home page');
  });

  it('falls back to a built-in message when there is no "page not found" content', async () => {
    const response = setup({ singleton: (apiId) => (apiId === 'notFound' ? throwError(() => new NovanApiError(404, 'singleton_not_found', 'none')) : of(singletons[apiId])) });
    const harness = await RouterTestingHarness.create('/missing');
    const el = harness.routeNativeElement as HTMLElement;

    expect(response.status).toBe(404);
    expect(el.querySelector('h1')?.textContent).toBe('Page not found');
    expect(el.querySelector('main a[href="/"]')?.textContent).toBe('Go to the home page');
  });

  it('answers 503 with an apology when the API fails', async () => {
    const response = setup({ page: () => throwError(() => new NovanApiError(500, null, 'down')) });
    const harness = await RouterTestingHarness.create('/about');

    expect(response.status).toBe(503);
    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe('This page is not available right now');
  });

  it('still renders the page when navigation and site settings are missing', async () => {
    setup({ singleton: () => throwError(() => new Error('none')) });
    const harness = await RouterTestingHarness.create('/');
    const root = harness.routeNativeElement?.ownerDocument.body ?? document.body;

    expect(root.querySelector('h1')?.textContent).toBe('Welcome home');
    expect(root.querySelector('ds-header [dsBrand]')?.textContent?.trim()).toBe('Home');
  });

  it('follows a link to a place on the same page without navigating', async () => {
    setup();
    const harness = await RouterTestingHarness.create('/about');
    const root = harness.routeNativeElement as HTMLElement;
    const skip = root.querySelector<HTMLAnchorElement>('a[href="#ds-main-content"]');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    // jsdom has no layout, so no scrollIntoView.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    skip?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('ds-main-content');
    expect(scroll).toHaveBeenCalled();
  });

  describe('in several languages, with the language in addresses', () => {
    const french: Page = {
      ...pages['/about'],
      path: '/fr/about',
      locale: 'fr-FR',
      data: { title: 'À propos', body: [{ _uid: uid(21), _block: 'cta', heading: 'Parlez-nous' }] },
      alternates: [
        { locale: 'en-GB', path: '/about' },
        { locale: 'fr-FR', path: '/fr/about' },
      ],
    };
    const locales = { locales: [english, { code: 'fr-FR', name: 'French', fallback: 'en-GB', isDefault: false, prefix: 'fr' }], prefixes: true };

    it('reads the language from the address, for the page and the header and footer, and links the other languages', async () => {
      const asked: string[] = [];
      setup({
        locales,
        page: (path, options) => {
          asked.push(`page ${path} ${options?.locale}`);
          return of(options?.locale === 'fr-FR' ? french : (pages[path] ?? null));
        },
        singleton: (apiId, options) => {
          asked.push(`${apiId} ${options?.locale}`);
          const fr = apiId === 'siteSettings' && options?.locale === 'fr-FR';
          return apiId in singletons ? of(fr ? { ...(singletons[apiId] as object), siteName: 'Site test' } : singletons[apiId]) : throwError(() => new Error('none'));
        },
      });
      const harness = await RouterTestingHarness.create('/fr/about');
      const root = harness.routeNativeElement?.ownerDocument.body ?? document.body;

      expect(asked).toEqual(expect.arrayContaining(['page /about fr-FR', 'navigation fr-FR', 'siteSettings fr-FR']));
      expect(root.querySelector('novan-cta-block h2')?.textContent).toBe('Parlez-nous');
      expect(root.querySelector('ds-header [dsBrand]')?.textContent?.trim()).toBe('Site test');
      expect(document.documentElement.getAttribute('lang')).toBe('fr-FR');
      const hreflang = [...document.head.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => link.getAttribute('hreflang'));
      expect(hreflang).toEqual(['en-GB', 'fr-FR', 'x-default']);

      // Back to the main language: the header and footer follow.
      await harness.navigateByUrl('/about');
      expect(root.querySelector('ds-header [dsBrand]')?.textContent?.trim()).toBe('Test site');
      expect(document.documentElement.getAttribute('lang')).toBe('en-GB');
    });
  });

  it('resolves the new page when the address changes', async () => {
    setup();
    const harness = await RouterTestingHarness.create('/');
    await harness.navigateByUrl('/about');

    expect((harness.routeNativeElement as HTMLElement).querySelector('novan-cta-block h2')?.textContent).toBe('Talk to us');
  });
});
