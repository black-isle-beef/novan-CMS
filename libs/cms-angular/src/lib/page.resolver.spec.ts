import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, type Observable, of } from 'rxjs';
import { NovanContentService } from './content.service';
import { novanPagePath, novanPageResolver } from './page.resolver';
import type { Page } from './types';

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

  function resolve(url: string, found: Page | null) {
    const response: ResponseInit = {};
    const content = { page: vi.fn(() => of(found)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: NovanContentService, useValue: content },
        { provide: RESPONSE_INIT, useValue: response },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      novanPageResolver({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as Observable<Page | null>;
    return { result: firstValueFrom(result), response, content };
  }

  it('loads the page at the route address', async () => {
    const { result, response, content } = resolve('/about?utm=x', page);
    expect(await result).toBe(page);
    expect(content.page).toHaveBeenCalledWith('/about');
    expect(response.status).toBeUndefined();
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
