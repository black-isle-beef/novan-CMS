import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { cacheTagInterceptor, MAX_CACHE_TAG_LENGTH, mergeCacheTags } from './cache-tags';

describe('mergeCacheTags', () => {
  it('joins tags without repeats', () => {
    expect(mergeCacheTags(null, 'space:s,entry:a')).toBe('space:s,entry:a');
    expect(mergeCacheTags('space:s,entry:a', 'space:s, entry:b')).toBe('space:s,entry:a,entry:b');
  });

  it('keeps the space overflow tag and the first tags that fit when the header would be too long', () => {
    const many = Array.from({ length: 1200 }, (_, n) => `entry:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`).join(',');
    const merged = mergeCacheTags('space:abc', many);

    expect(merged.length).toBeLessThanOrEqual(MAX_CACHE_TAG_LENGTH);
    expect(merged.split(',').slice(0, 2)).toEqual(['overflow:abc', 'space:abc']);
    const again = mergeCacheTags(merged, 'entry:new');
    expect(again.length).toBeLessThanOrEqual(MAX_CACHE_TAG_LENGTH);
    expect(again.startsWith('overflow:abc,space:abc,')).toBe(true);
  });
});

describe('cacheTagInterceptor', () => {
  function setup(response: ResponseInit | null) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([cacheTagInterceptor])),
        provideHttpClientTesting(),
        ...(response ? [{ provide: RESPONSE_INIT, useValue: response }] : []),
      ],
    });
    return { http: TestBed.inject(HttpClient), backend: TestBed.inject(HttpTestingController) };
  }

  it('collects the Cache-Tag of every answer on the page response', async () => {
    const response: ResponseInit = { headers: { 'X-Other': 'kept' } };
    const { http, backend } = setup(response);

    const first = firstValueFrom(http.get('/v1/delivery/pages'));
    backend.expectOne('/v1/delivery/pages').flush({}, { headers: { 'Cache-Tag': 'space:s,entry:page' } });
    await first;
    const second = firstValueFrom(http.get('/v1/delivery/singletons/navigation'));
    backend.expectOne('/v1/delivery/singletons/navigation').flush({}, { headers: { 'Cache-Tag': 'space:s,entry:nav' } });
    await second;

    const headers = new Headers(response.headers);
    expect(headers.get('Cache-Tag')).toBe('space:s,entry:page,entry:nav');
    expect(headers.get('X-Other')).toBe('kept');
    expect(headers.has('Cache-Control')).toBe(false);
  });

  it('marks the page no-store when an answer fails, a 404 included', async () => {
    const response: ResponseInit = {};
    const { http, backend } = setup(response);

    const request = firstValueFrom(http.get('/v1/delivery/singletons/navigation')).catch(() => null);
    backend.expectOne('/v1/delivery/singletons/navigation').flush({}, { status: 404, statusText: 'Not Found' });
    await request;

    expect(new Headers(response.headers).get('Cache-Control')).toBe('no-store');
  });

  it('does nothing in the browser, where there is no response to set', async () => {
    const { http, backend } = setup(null);

    const request = firstValueFrom(http.get('/_novan/delivery/pages'));
    backend.expectOne('/_novan/delivery/pages').flush({ ok: true }, { headers: { 'Cache-Tag': 'space:s' } });
    expect(await request).toEqual({ ok: true });
  });
});
