import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, type Observable, of } from 'rxjs';
import { NOVAN_CMS_CONFIG, type NovanCmsConfig } from './config';
import { NovanContentService } from './content.service';
import { NovanLocale } from './locale-state';
import { novanPagePath, novanPageResolver } from './page.resolver';
import type { NovanLocales, Page } from './types';

describe('novanPagePath', () => {
  it.each([
    ['/', '/'],
    ['', '/'],
    ['/about', '/about'],
    ['/about/', '/about'],
    ['/blog/hello-world?novan_preview=x#top', '/blog/hello-world'],
    ['/caf%C3%A9', null],
    ['/About', null],
    ['/a//b', null],
    ['/%E0%A4%A', null],
    ['/../etc', null],
    [`/${'a'.repeat(1001)}`, null],
  ])('%s → %s', (url, path) => {
    expect(novanPagePath(url)).toBe(path);
  });
});

describe('novanPageResolver', () => {
  const page = { id: 'p', contentType: 'page', path: '/about', locale: 'en-GB', updatedAt: '', data: {} } as Page;
  const locales: NovanLocales = {
    locales: [
      { code: 'en-GB', name: 'English', fallback: null, isDefault: true, prefix: 'en' },
      { code: 'fr-FR', name: 'French', fallback: 'en-GB', isDefault: false, prefix: 'fr' },
    ],
    prefixes: true,
  };

  function resolve(url: string, found: Page | null, config: Partial<NovanCmsConfig> = {}) {
    const response: ResponseInit = {};
    const content = { page: vi.fn(() => of(found)), locales: vi.fn(() => of(locales)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: NovanContentService, useValue: content },
        { provide: RESPONSE_INIT, useValue: response },
        { provide: NOVAN_CMS_CONFIG, useValue: { blocks: {}, ...config } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      novanPageResolver({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as Observable<Page | null>;
    return { result: firstValueFrom(result), response, content };
  }

  it('loads the page at the route address, in the default locale', async () => {
    const { result, response, content } = resolve('/about?utm=x', page);
    expect(await result).toBe(page);
    expect(content.page).toHaveBeenCalledWith('/about', { locale: 'en-GB' });
    expect(response.status).toBeUndefined();
    expect(TestBed.inject(NovanLocale).current()).toBe('en-GB');
  });

  it('reads the locale from the address prefix', async () => {
    const { result, content } = resolve('/fr/about', page);
    await result;
    expect(content.page).toHaveBeenCalledWith('/about', { locale: 'fr-FR' });
    expect(TestBed.inject(NovanLocale).current()).toBe('fr-FR');
  });

  it('reads /fr as the French home page', async () => {
    const { result, content } = resolve('/fr', page);
    await result;
    expect(content.page).toHaveBeenCalledWith('/', { locale: 'fr-FR' });
  });

  it('uses the configured locale without asking for the site\'s', async () => {
    const { result, content } = resolve('/fr/about', page, { locale: 'cy-GB' });
    await result;
    expect(content.locales).not.toHaveBeenCalled();
    expect(content.page).toHaveBeenCalledWith('/fr/about', { locale: 'cy-GB' });
  });

  it('answers 404 when there is no page', async () => {
    const { result, response } = resolve('/missing', null);
    expect(await result).toBeNull();
    expect(response.status).toBe(404);
  });

  it('answers 404 without asking the API for an address no page can have', async () => {
    const { result, response, content } = resolve('/Not-A-Slug', page);
    expect(await result).toBeNull();
    expect(content.page).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });
});
