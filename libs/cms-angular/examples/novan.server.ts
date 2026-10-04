import type { NovanServerOptions } from '@novan/cms-angular';

// Server only: imported by server.ts and app.config.server.ts, never by browser code.
export const novanServerOptions: NovanServerOptions = {
  apiUrl: process.env['NOVAN_API_URL'] || 'http://localhost:3000',
  deliveryToken: process.env['NOVAN_DELIVERY_TOKEN'] ?? '',
  previewToken: process.env['NOVAN_PREVIEW_TOKEN'] || undefined,
};
