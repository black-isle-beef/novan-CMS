// Tests the @novan/cms-angular/server entry point; the unit-test runner only looks under src/.
import { createNovanProxy, type NovanProxyOptions, type NovanProxyResponse } from '@novan/cms-angular/server';

const API = 'http://api.internal:3000';

function proxy(options: Partial<NovanProxyOptions> = {}, upstream = new Response('{"ok":true}', { status: 200 })) {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(upstream.clone()));
  const handler = createNovanProxy({
    apiUrl: `${API}/`,
    deliveryToken: 'nv_del_secret',
    previewToken: 'nv_pre_secret',
    fetch: fetch as unknown as typeof globalThis.fetch,
    ...options,
  });
  return { handler, fetch };
}

function response() {
  const headers: Record<string, string> = {};
  let body: Uint8Array | undefined;
  const res: NovanProxyResponse & { headers: typeof headers; text: () => string } = {
    statusCode: 200,
    headers,
    setHeader: (name, value) => (headers[name.toLowerCase()] = value),
    end: (chunk) => (body = chunk),
    text: () => (body ? new TextDecoder().decode(body) : ''),
  };
  return res;
}

describe('createNovanProxy', () => {
  it('adds the delivery token and passes the answer back', async () => {
    const { handler, fetch } = proxy(
      {},
      new Response('{"title":"About"}', {
        status: 200,
        headers: { 'content-type': 'application/json', etag: 'W/"1"', 'cache-control': 'public, s-maxage=1', 'cache-tag': 'space:s', 'set-cookie': 'x=1' },
      }),
    );
    const res = response();
    await handler({ method: 'GET', url: '/delivery/pages?path=%2Fabout&locale=en-GB', headers: { 'if-none-match': 'W/"0"' } }, res);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${API}/v1/delivery/pages?path=%2Fabout&locale=en-GB`);
    expect(init.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer nv_del_secret', 'If-None-Match': 'W/"0"' });
    expect(res.statusCode).toBe(200);
    expect(res.text()).toBe('{"title":"About"}');
    expect(res.headers).toEqual({
      'content-type': 'application/json',
      etag: 'W/"1"',
      'cache-control': 'public, s-maxage=1',
      'cache-tag': 'space:s',
    });
  });

  it.each([
    '/management/spaces',
    '/delivery/pages/../../management/spaces',
    '/delivery/entries/not-an-id',
    '/delivery/singletons/Bad-Name',
    '/v1/delivery/pages',
    '/delivery',
    '/assets/x',
  ])('passes %s on to the next handler without calling the API', async (url) => {
    const { handler, fetch } = proxy();
    const next = vi.fn();
    await handler({ method: 'GET', url, headers: {} }, response(), next);
    expect(next).toHaveBeenCalledWith();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows the read routes only', async () => {
    const { handler, fetch } = proxy();
    for (const url of ['/delivery/entries', '/delivery/entries/00000000-0000-4000-8000-000000000001', '/delivery/singletons/siteSettings', '/delivery/sitemap']) {
      await handler({ method: 'GET', url, headers: {} }, response());
    }
    expect(fetch).toHaveBeenCalledTimes(4);

    const res = response();
    await handler({ method: 'POST', url: '/delivery/pages', headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('refuses preview without a signed token the site accepts', async () => {
    const verifyPreview = vi.fn((token: string) => token === 'good');
    const cases: [Partial<NovanProxyOptions>, Record<string, string>][] = [
      [{ verifyPreview }, {}],
      [{ verifyPreview }, { 'x-novan-preview': 'bad' }],
      [{}, { 'x-novan-preview': 'good' }],
      [{ verifyPreview, previewToken: undefined }, { 'x-novan-preview': 'good' }],
      [{ verifyPreview: () => Promise.reject(new Error('down')) }, { 'x-novan-preview': 'good' }],
    ];
    for (const [options, headers] of cases) {
      const { handler, fetch } = proxy(options);
      const res = response();
      await handler({ method: 'GET', url: '/preview/pages?path=%2F', headers }, res);
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.text())).toMatchObject({ code: 'preview_not_allowed' });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('reads drafts with the preview token and never lets them be cached', async () => {
    const { handler, fetch } = proxy(
      { verifyPreview: (token) => token === 'good' },
      new Response('{}', { headers: { 'cache-control': 'public, max-age=60', 'cache-tag': 'space:s' } }),
    );
    const res = response();
    await handler({ method: 'GET', url: '/preview/pages?path=%2F', headers: { 'x-novan-preview': 'good' } }, res);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${API}/v1/preview/pages?path=%2F`);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer nv_pre_secret', 'X-Novan-Preview': 'good' });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('reports an unreachable API', async () => {
    const handler = createNovanProxy({ apiUrl: API, deliveryToken: 'nv_del_x', fetch: () => Promise.reject(new Error('ECONNREFUSED')) });
    const res = response();
    await handler({ method: 'GET', url: '/delivery/sitemap', headers: {} }, res);
    expect(res.statusCode).toBe(502);
    expect(res.text()).not.toContain('nv_del_x');

    const next = vi.fn();
    await handler({ method: 'GET', url: '/delivery/sitemap', headers: {} }, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
