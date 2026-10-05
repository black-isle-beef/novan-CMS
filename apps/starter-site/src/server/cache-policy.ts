/** CMS pages: kept by the CDN until a publish purges their tags; browsers revalidate every time. */
export const CMS_PAGE_CACHE_CONTROL = 'public, s-maxage=31536000, stale-while-revalidate=60';
export const NO_STORE = 'no-store';

/**
 * The caching headers of a server-rendered page. A page keeps a `Cache-Control` it was given during the
 * render (preview's `private, no-store`, or `no-store` after a failed API answer). Otherwise a 200 that
 * carries `Cache-Tag`s from the Delivery API is cached at the edge; anything else (404, 503, or a page with
 * no tags to purge it by) is not stored.
 */
export function withCachePolicy(response: Response): Response {
  const headers = new Headers(response.headers);
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', response.status === 200 && headers.get('Cache-Tag') ? CMS_PAGE_CACHE_CONTROL : NO_STORE);
  }
  // Tags only mean something on a response the CDN keeps.
  if (headers.get('Cache-Control') !== CMS_PAGE_CACHE_CONTROL) headers.delete('Cache-Tag');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
