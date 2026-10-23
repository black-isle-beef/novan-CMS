import { existsSync } from 'node:fs';
import { type ContactFormTarget, LOCAL_CMS_LOGIN_URL } from './app/config/site-config';

// Local development reads .env.local (never committed) from the workspace root; deployed servers get real
// environment variables.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

/**
 * What the marketing site's server reads from its environment when it starts. Imported only by server code
 * (`server.ts`, `app.config.server.ts`), so the delivery token never reaches the browser bundle.
 */
export interface WebServerConfig {
  /** `MARKETING_SITE_URL`; the request's own origin when unset. */
  siteUrl: string | null;
  /** `CMS_LOGIN_URL`, else `ADMIN_URL` + `/sign-in`. */
  cmsLoginUrl: string;
  /** `NOVAN_API_URL`: the API as this server reaches it. */
  apiUrl: string;
  /** `MARKETING_DELIVERY_TOKEN`: the Novan space's delivery token, used only to send enquiries. */
  deliveryToken: string;
  /** `MARKETING_CONTACT_ENTRY_ID` and `MARKETING_CONTACT_FORM_UID`; `null` unless both are set. */
  contactForm: ContactFormTarget | null;
}

export function webServerConfig(env: NodeJS.ProcessEnv = process.env): WebServerConfig {
  const admin = env['ADMIN_URL']?.trim();
  const entryId = env['MARKETING_CONTACT_ENTRY_ID']?.trim();
  const formUid = env['MARKETING_CONTACT_FORM_UID']?.trim();
  const deliveryToken = env['MARKETING_DELIVERY_TOKEN']?.trim() ?? '';
  return {
    siteUrl: trimSlash(env['MARKETING_SITE_URL']) || null,
    cmsLoginUrl: env['CMS_LOGIN_URL']?.trim() || (admin ? `${trimSlash(admin)}/sign-in` : LOCAL_CMS_LOGIN_URL),
    apiUrl: trimSlash(env['NOVAN_API_URL']) || 'http://localhost:3000',
    deliveryToken,
    // Without a token the API would refuse every enquiry, so the page offers email instead.
    contactForm: entryId && formUid && deliveryToken ? { entryId, formUid } : null,
  };
}

/** The site's public origin: `MARKETING_SITE_URL`, else the request's. */
export function siteUrl(config: WebServerConfig, requestOrigin: string): string {
  return config.siteUrl ?? trimSlash(requestOrigin);
}

/**
 * Host names the server renders for: `NG_ALLOWED_HOSTS` (comma-separated) and the host of `MARKETING_SITE_URL`.
 * Undefined, Angular's own default (localhost) applies.
 */
export function allowedHosts(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const hosts = (env['NG_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (env['MARKETING_SITE_URL']) hosts.push(new URL(env['MARKETING_SITE_URL']).hostname);
  return hosts.length ? [...new Set(hosts)] : undefined;
}

function trimSlash(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}
