import { InjectionToken } from '@angular/core';
import type { NovanBlockRegistry } from './blocks';

/** Settings shared by the server and the browser. They end up in the browser bundle: no secrets here. */
export interface NovanCmsConfig {
  /**
   * The Novan API, e.g. `https://api.novan.example`. The server's own `apiUrl` (from
   * {@link provideNovanCmsServer}) wins on the server; the browser needs this only with `publicDeliveryToken`.
   */
  apiUrl?: string;
  /** The locale to ask for when a call does not give one; the space's default locale otherwise. */
  locale?: string;
  /** Block components by block type, from `defineBlocks(...)`. */
  blocks: NovanBlockRegistry;
  /**
   * Where the site's server mounts `createNovanProxy` (from `@black-isle-beef/cms-angular/server`), which the browser
   * fetches content through after the first page. Default `/_novan`.
   */
  proxyPath?: string;
  /**
   * Only for sites whose content is entirely public: a delivery token the browser may use to call the
   * Delivery API directly, instead of going through the site's server. It is in the browser bundle and can be
   * read by anyone, and the API must allow the site's origin (CORS). Preview never uses it.
   */
  publicDeliveryToken?: string;
}

/**
 * Settings only the site's server has. Provide them in `app.config.server.ts` (never `app.config.ts`) from
 * the server environment, so the tokens cannot reach the browser bundle.
 */
export interface NovanServerOptions {
  /** The Novan API as the site's server reaches it. */
  apiUrl: string;
  /** A delivery token (`nv_del_...`) for published content. */
  deliveryToken: string;
  /** A preview token (`nv_pre_...`) for drafts. Without one, preview mode is never on. */
  previewToken?: string;
  /**
   * Decides whether the signed token in `?novan_preview=` (issued by the admin) allows preview. Without
   * it, preview mode is never on, so a site cannot show drafts to anyone who adds the parameter. The
   * signed-token exchange of package 12 provides one.
   */
  verifyPreview?: (signedToken: string) => boolean | Promise<boolean>;
}

export const NOVAN_CMS_CONFIG = new InjectionToken<NovanCmsConfig>('NOVAN_CMS_CONFIG');
export const NOVAN_CMS_SERVER = new InjectionToken<NovanServerOptions>('NOVAN_CMS_SERVER');

/** Loads the visual editor bridge (package 12); replaced in tests. */
export const NOVAN_BRIDGE_LOADER = new InjectionToken<() => Promise<NovanBridgeModule>>('NOVAN_BRIDGE_LOADER', {
  providedIn: 'root',
  factory: () => () => import('@black-isle-beef/cms-angular/bridge'),
});

/** What the bridge entry point exports. */
export interface NovanBridgeModule {
  startNovanBridge(): () => void;
}

export const DEFAULT_PROXY_PATH = '/_novan';
