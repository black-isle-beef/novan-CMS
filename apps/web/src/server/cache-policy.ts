/**
 * Marketing pages change only with a deploy. The CDN keeps them for an hour (the deploy also purges them) and may
 * serve a stale copy for a day while it fetches a new one; browsers revalidate every time.
 */
export const PAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
export const NO_STORE = 'no-store';

/** A rendered page keeps a `Cache-Control` set during the render; otherwise a 200 is cached and anything else is not. */
export function withCachePolicy(response: Response): Response {
  const headers = new Headers(response.headers);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', response.status === 200 ? PAGE_CACHE_CONTROL : NO_STORE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
