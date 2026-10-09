/** A `<link rel="preload" as="font">`, as the critical CSS step (Beasties) writes it into the page's head. */
const FONT_PRELOAD = /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="font")[^>]*>/g;

/**
 * Inlining a page's critical CSS also preloads every font that CSS declares: all the design system's weights and
 * the icon font, about 320 KB, competing with the page itself on a slow connection. Angular does not let a site
 * turn that off, so the preloads are taken out here. The fonts still load from the CSS, and only the ones the page
 * uses (docs/build/14-seo-site-features.md).
 */
export async function withoutFontPreloads(response: Response): Promise<Response> {
  if (!response.headers.get('Content-Type')?.startsWith('text/html')) return response;
  const html = (await response.text()).replace(FONT_PRELOAD, '');
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
