/**
 * The grooming-report app stays on Firebase at its own subdomain (docs/clients/laws-paws-launch.md). Report links
 * already sent to customers (`/report/<token>`) and the staff area (`/admin`) were on the old site's domain, so the
 * site sends those addresses on, path and query unchanged. The CMS's own redirects match whole addresses only, and
 * every report has its own token, so these are matched by prefix here instead.
 */
const isReportsPath = (path: string): boolean =>
  (path.startsWith('/report/') && path.length > '/report/'.length) || path === '/admin' || path.startsWith('/admin/');

/**
 * Where an address moved to on the reports app, or null when it is the site's own. `origin` is `REPORTS_ORIGIN`, e.g.
 * `https://reports.laws-paws.co.uk`; without it nothing is redirected.
 */
export function reportsRedirect(originalUrl: string, origin: string | undefined): string | null {
  const base = origin?.trim().replace(/\/+$/, '');
  if (!base || !/^https:\/\/[^/]+$/i.test(base)) return null;
  return isReportsPath(originalUrl.split('?')[0]) ? `${base}${originalUrl}` : null;
}
