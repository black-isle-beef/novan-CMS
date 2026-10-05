import type { NovanServerOptions } from '@black-isle-beef/cms-angular';
import { existsSync } from 'node:fs';

// Local development reads .env.local (never committed) from the workspace root; deployed servers get real
// environment variables.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

/**
 * How the site's server reaches the Novan API, read from the server environment when it starts. Imported
 * only by server code (`server.ts`, `app.config.server.ts`), so the tokens never reach the browser bundle
 * (`tools/browser-bundle.test.mjs` checks).
 */
export const novanServerOptions: NovanServerOptions = {
  apiUrl: process.env['NOVAN_API_URL'] || 'http://localhost:3000',
  deliveryToken: process.env['NOVAN_DELIVERY_TOKEN'] ?? '',
  previewToken: process.env['NOVAN_PREVIEW_TOKEN'] || undefined,
};

/** The site's public address (`SITE_URL`), for sitemap.xml and robots.txt; the request's own origin when unset. */
export function siteUrl(requestOrigin: string): string {
  return (process.env['SITE_URL'] || requestOrigin).replace(/\/+$/, '');
}

/**
 * Host names Angular's server renders for (it refuses others, against server-side request forgery): the host
 * of `SITE_URL` plus those in `NG_ALLOWED_HOSTS` (comma-separated, e.g. a staging host). Undefined leaves
 * Angular's default, which allows only `localhost`.
 */
export function allowedHosts(): string[] | undefined {
  const hosts = (process.env['NG_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (process.env['SITE_URL']) hosts.push(new URL(process.env['SITE_URL']).hostname);
  return hosts.length ? [...new Set(hosts)] : undefined;
}
