import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type EnvironmentProviders, PLATFORM_ID, type Provider, REQUEST, RESPONSE_INIT, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { defineBlocks } from './blocks';
import { NOVAN_BRIDGE_LOADER, type NovanCmsConfig, type NovanServerOptions } from './config';
import { NovanApiError, NovanContentService } from './content.service';
import { NovanPreview } from './preview';
import { provideNovanCms, provideNovanCmsServer } from './provide';
import type { Page } from './types';

const API = 'http://api.internal:3000';
const DELIVERY = 'nv_del_server-only-delivery-token';
const PREVIEW = 'nv_pre_server-only-preview-token';

const page: Page = {
  id: '00000000-0000-4000-8000-000000000101',
  contentType: 'page',
  path: '/about',
  locale: 'en-GB',
  updatedAt: '2026-10-01T09:00:00.000Z',
  data: { title: 'About us', body: [] },
};

interface Setup {
  platform: 'server' | 'browser';
  url?: string;
  config?: Partial<NovanCmsConfig>;
  server?: Partial<NovanServerOptions> | null;
  response?: ResponseInit;
}

function setup({ platform, url = 'http://site.test/about', config = {}, server = {}, response }: Setup) {
  const bridge = vi.fn(() => Promise.resolve({ startNovanBridge: () => () => undefined }));
  const providers: (Provider | EnvironmentProviders)[] = [
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: PLATFORM_ID, useValue: platform },
    { provide: NOVAN_BRIDGE_LOADER, useValue: bridge },
  ];
  if (platform === 'server') {
    providers.push({ provide: REQUEST, useValue: new Request(url) });
    providers.push({ provide: RESPONSE_INIT, useValue: response ?? {} });
  } else {
    window.history.replaceState(null, '', new URL(url).pathname + new URL(url).search);
  }
  TestBed.configureTestingModule({
    providers: [
      ...providers,
      provideNovanCms({ blocks: defineBlocks({}), locale: 'en-GB', ...config }),
      ...(platform === 'server' && server !== null
        ? [provideNovanCmsServer({ apiUrl: API, deliveryToken: DELIVERY, previewToken: PREVIEW, ...server })]
        : []),
    ],
  });
  return {
    content: TestBed.inject(NovanContentService),
    http: TestBed.inject(HttpTestingController),
    bridge,
  };
}

/** Lets the preview check (a promise) settle before the request goes out. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

/** Transfer state as the server writes it into the page (<APP_ID>-state; TestBed's APP_ID is ). */
const STATE_ID = 'a-state';
function addPageState(json: string): void {
  const script = document.createElement('script');
  script.id = STATE_ID;
  script.type = 'application/json';
  script.textContent = json;
  document.body.appendChild(script);
}

afterEach(() => {
  document.getElementById(STATE_ID)?.remove();
  window.history.replaceState(null, '', '/');
});

describe('NovanContentService on the server', () => {
  it('calls the Delivery API with the server token and keeps the answer for the browser', async () => {
    const { content, http } = setup({ platform: 'server' });

    const result = firstValueFrom(content.page('/about'));
    await settle();
    const req = http.expectOne((r) => r.url === `${API}/v1/delivery/pages`);
    expect(req.request.params.get('path')).toBe('/about');
    expect(req.request.params.get('locale')).toBe('en-GB');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${DELIVERY}`);
    req.flush(page);

    expect(await result).toEqual(page);
    expect(TestBed.inject(TransferState).toJson()).toContain('About us');
    http.verify();
  });

  it('answers null for a page that does not exist, and keeps that too', async () => {
    const { content, http } = setup({ platform: 'server' });

    const result = firstValueFrom(content.page('/missing'));
    await settle();
    http
      .expectOne((r) => r.url === `${API}/v1/delivery/pages`)
      .flush({ code: 'page_not_found' }, { status: 404, statusText: 'Not Found' });

    expect(await result).toBeNull();
    expect(TestBed.inject(TransferState).toJson()).toContain('novan:delivery:pages?locale=en-GB&path=%2Fmissing');
  });

  it('reports other errors with the API code', async () => {
    const { content, http } = setup({ platform: 'server' });

    const result = firstValueFrom(content.singleton('navigation'));
    await settle();
    http
      .expectOne(`${API}/v1/delivery/singletons/navigation?locale=en-GB`)
      .flush({ code: 'singleton_not_found', detail: 'There is no singleton "navigation".' }, { status: 404, statusText: 'Not Found' });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NovanApiError);
    expect(error).toMatchObject({ status: 404, code: 'singleton_not_found', message: 'There is no singleton "navigation".' });
  });

  it('builds entries queries with field filters', async () => {
    const { content, http } = setup({ platform: 'server' });

    const result = firstValueFrom(
      content.entries({
        type: 'article',
        sort: '-fields.publishedOn',
        limit: 10,
        cursor: 'abc',
        include: 0,
        select: ['title', 'summary'],
        filter: { category: 'news', publishedOn: { gt: '2026-01-01' }, tags: { in: ['a', 'b'] } },
      }),
    );
    await settle();
    const req = http.expectOne((r) => r.url === `${API}/v1/delivery/entries`);
    const params = Object.fromEntries(req.request.params.keys().map((key) => [key, req.request.params.get(key)]));
    expect(params).toEqual({
      type: 'article',
      locale: 'en-GB',
      sort: '-fields.publishedOn',
      limit: '10',
      cursor: 'abc',
      include: '0',
      select: 'fields.title,fields.summary',
      'fields.category[eq]': 'news',
      'fields.publishedOn[gt]': '2026-01-01',
      'fields.tags[in]': 'a,b',
    });
    req.flush({ items: [], nextCursor: null });
    expect(await result).toEqual({ items: [], nextCursor: null });
  });

  it('returns the data of a singleton, and never sends a locale for one entry', async () => {
    const { content, http } = setup({ platform: 'server' });

    const nav = firstValueFrom(content.singleton<{ items: string[] }>('navigation'));
    const entry = firstValueFrom(content.entry(page.id, { include: 2 }));
    await settle();
    http.expectOne(`${API}/v1/delivery/singletons/navigation?locale=en-GB`).flush({ ...page, data: { items: ['Home'] } });
    http.expectOne(`${API}/v1/delivery/entries/${page.id}?include=2`).flush(page);

    expect(await nav).toEqual({ items: ['Home'] });
    expect(await entry).toEqual(page);
  });

  it('refuses to run without server settings or a public token', async () => {
    const { content } = setup({ platform: 'server', server: null });
    await expect(firstValueFrom(content.page('/'))).rejects.toThrow(/provideNovanCmsServer/);
  });
});

describe('NovanContentService in the browser', () => {
  it('takes the server answer from transfer state instead of fetching again', async () => {
    // What the server put in the page.
    const server = setup({ platform: 'server' });
    const fetched = firstValueFrom(server.content.page('/about'));
    await settle();
    server.http.expectOne((r) => r.url === `${API}/v1/delivery/pages`).flush(page);
    await fetched;
    const state = TestBed.inject(TransferState).toJson();
    TestBed.resetTestingModule();

    addPageState(state);


    const { content, http } = setup({ platform: 'browser' });
    expect(await firstValueFrom(content.page('/about'))).toEqual(page);
    http.verify();

    // Used once: later visits to the page fetch fresh content.
    const again = firstValueFrom(content.page('/about'));
    await settle();
    http.expectOne((r) => r.url === '/_novan/delivery/pages').flush(page);
    expect(await again).toEqual(page);
  });

  it('fetches through the site server without any token', async () => {
    const { content, http } = setup({ platform: 'browser', config: { proxyPath: '/content-proxy/' } });

    const result = firstValueFrom(content.page('/about'));
    await settle();
    const req = http.expectOne((r) => r.url === '/content-proxy/delivery/pages');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(page);
    expect(await result).toEqual(page);
  });

  it('calls the Delivery API directly with a public delivery token, when the site chose that', async () => {
    const { content, http } = setup({
      platform: 'browser',
      config: { apiUrl: 'https://api.example.com/', publicDeliveryToken: 'nv_del_public' },
    });

    const result = firstValueFrom(content.page('/about'));
    await settle();
    const req = http.expectOne((r) => r.url === 'https://api.example.com/v1/delivery/pages');
    expect(req.request.headers.get('Authorization')).toBe('Bearer nv_del_public');
    req.flush(page);
    expect(await result).toEqual(page);
  });
});

describe('preview mode', () => {
  const previewUrl = 'http://site.test/about?novan_preview=signed-by-admin';

  it('stays off without a verifier, so the parameter alone never shows drafts', async () => {
    const response: ResponseInit = {};
    const { content, http } = setup({ platform: 'server', url: previewUrl, response });

    const result = firstValueFrom(content.page('/about'));
    await settle();
    http.expectOne((r) => r.url === `${API}/v1/delivery/pages`).flush(page);
    await result;
    expect(TestBed.inject(NovanPreview).active()).toBe(false);
    expect(response.headers).toBeUndefined();
  });

  it('stays off when the verifier refuses or fails', async () => {
    for (const verifyPreview of [() => false, () => Promise.reject(new Error('expired'))]) {
      TestBed.resetTestingModule();
      setup({ platform: 'server', url: previewUrl, server: { verifyPreview } });
      expect(await TestBed.inject(NovanPreview).resolve()).toBe(false);
    }
  });

  it('reads drafts from the Preview API without caching once the signed token is accepted', async () => {
    const response: ResponseInit = { headers: { 'X-Other': 'kept' } };
    const verifyPreview = vi.fn((token: string) => token === 'signed-by-admin');
    const { content, http } = setup({ platform: 'server', url: previewUrl, server: { verifyPreview }, response });

    const result = firstValueFrom(content.page('/about'));
    await settle();
    const req = http.expectOne((r) => r.url === `${API}/v1/preview/pages`);
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${PREVIEW}`);
    expect(req.request.headers.get('X-Novan-Preview')).toBe('signed-by-admin');
    expect(req.request.cache).toBe('no-store');
    req.flush(page);
    await result;

    expect(verifyPreview).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(NovanPreview).active()).toBe(true);
    const headers = new Headers(response.headers);
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('X-Other')).toBe('kept');
    // The browser learns the verdict from the page, not by trusting the address.
    expect(TestBed.inject(TransferState).toJson()).toContain('"novan:preview":true');
  });

  it('in the browser, sends the signed token to the proxy and loads the bridge', async () => {
    const { content, http, bridge } = setup({ platform: 'browser', url: previewUrl });
    await settle();
    expect(bridge).toHaveBeenCalledTimes(1);

    const result = firstValueFrom(content.page('/about'));
    await settle();
    const req = http.expectOne((r) => r.url === '/_novan/preview/pages');
    expect(req.request.headers.get('X-Novan-Preview')).toBe('signed-by-admin');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(page);
    await result;
  });

  it('in the browser, follows the server when it refused the token', async () => {
    addPageState(JSON.stringify({ 'novan:preview': false }));


    const { content, http, bridge } = setup({ platform: 'browser', url: previewUrl });
    const result = firstValueFrom(content.page('/about'));
    await settle();
    http.expectOne((r) => r.url === '/_novan/delivery/pages').flush(page);
    await result;
    expect(bridge).not.toHaveBeenCalled();
  });

  it('does not load the bridge outside preview', async () => {
    const { bridge } = setup({ platform: 'browser' });
    await TestBed.inject(NovanPreview).resolve();
    await settle();
    expect(bridge).not.toHaveBeenCalled();
  });
});
