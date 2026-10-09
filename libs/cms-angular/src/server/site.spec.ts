// Tests the @black-isle-beef/cms-angular/server entry point; the unit-test runner only looks under src/.
import { createNovanNotFoundReporter, createNovanRedirects, type NovanRedirectResponse } from '@black-isle-beef/cms-angular/server';

const API = 'http://api.internal:3000';

const list = (items: object[], tags: string | null = 'space:s,redirects:s') =>
  new Response(JSON.stringify({ items }), { status: 200, headers: tags ? { 'Cache-Tag': tags } : {} });

function redirects(upstream: () => Promise<Response>, maxAgeMs?: number) {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(upstream);
  const handler = createNovanRedirects({ apiUrl: `${API}/`, deliveryToken: 'nv_del_secret', fetch: fetch as unknown as typeof globalThis.fetch, maxAgeMs });
  return { handler, fetch };
}

function response() {
  const headers: Record<string, string> = {};
  const res: NovanRedirectResponse & { headers: Record<string, string>; ended: boolean } = {
    statusCode: 200,
    headers,
    ended: false,
    setHeader: (name, value) => (headers[name.toLowerCase()] = value),
    end: () => (res.ended = true),
  };
  return res;
}

describe('createNovanRedirects', () => {
  const items = [
    { from: '/about-us', to: '/about', status: 301 },
    { from: '/café', to: '/coffee#menu', status: 302 },
    { from: '/campaign', to: 'https://shop.example.com/?ref=site', status: 302 },
  ];

  it('asks the Delivery API with the token and answers matching paths, with or without a trailing slash', async () => {
    const { handler, fetch } = redirects(async () => list(items));

    expect(await handler.match('/about-us/')).toEqual({ location: '/about', status: 301, cacheTags: 'space:s,redirects:s' });
    expect(await handler.match('/caf%C3%A9?x=1')).toEqual({ location: '/coffee?x=1#menu', status: 302, cacheTags: 'space:s,redirects:s' });
    expect(await handler.match('/campaign?utm=a')).toMatchObject({ location: 'https://shop.example.com/?ref=site' });
    expect(await handler.match('/about')).toBeNull();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${API}/v1/delivery/redirects`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer nv_del_secret' }) }),
    );
  });

  it('redirects GET and HEAD as middleware, cached at the edge under the list\'s tags, and passes the rest on', async () => {
    const { handler } = redirects(async () => list(items));
    const res = response();
    const next = vi.fn();

    await handler.handle({ method: 'GET', url: '/about-us?utm_source=mail', headers: {} }, res, next);
    expect(res).toMatchObject({ statusCode: 301, ended: true });
    expect(res.headers).toEqual({
      location: '/about?utm_source=mail',
      'cache-control': 'public, s-maxage=31536000, stale-while-revalidate=60',
      'cache-tag': 'space:s,redirects:s',
    });
    expect(next).not.toHaveBeenCalled();

    await handler.handle({ method: 'POST', url: '/about-us', headers: {} }, response(), next);
    await handler.handle({ method: 'GET', url: '/contact', headers: {} }, response(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('keeps the list for a while, keeps the last one when the API fails, and renders as usual without one', async () => {
    const answers = [async () => list(items), async () => new Response('down', { status: 503 })];
    const { handler, fetch } = redirects(() => (answers.shift() ?? (() => Promise.reject(new Error('gone'))))(), 0);

    expect(await handler.match('/about-us')).not.toBeNull();
    expect(await handler.match('/about-us')).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);

    const cold = redirects(() => Promise.reject(new Error('unreachable')));
    const res = response();
    const next = vi.fn();
    await cold.handler.handle({ method: 'GET', url: '/about-us', headers: {} }, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.ended).toBe(false);
  });

  it('is not cached at the edge when the API sent no tags, and ignores malformed items', async () => {
    const { handler } = redirects(async () => list([...items, { from: 'nope', to: '/x', status: 301 }, { from: '/y', to: '/z', status: 307 }], null));
    const res = response();

    await handler.handle({ url: '/about-us', headers: {} }, res, vi.fn());
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await handler.match('/y')).toBeNull();
  });
});

describe('createNovanNotFoundReporter', () => {
  it('posts the path and an http(s) referrer with the delivery token, and never throws', async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 202 }));
    const report = createNovanNotFoundReporter({ apiUrl: API, deliveryToken: 'nv_del_secret', fetch: fetch as unknown as typeof globalThis.fetch });

    await report('/missing', 'https://www.google.com/');
    await report('/other', 'android-app://com.google');
    await report('not-a-path');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(`${API}/v1/delivery/not-found`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer nv_del_secret' }) });
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ path: '/missing', referrer: 'https://www.google.com/' });
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual({ path: '/other', referrer: null });

    fetch.mockRejectedValue(new Error('down'));
    await expect(report('/missing')).resolves.toBeUndefined();
  });
});
