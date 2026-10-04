import type { NovanServerOptions } from '@black-isle-beef/cms-angular';

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
