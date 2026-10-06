import type { NovanServerOptions } from '@black-isle-beef/cms-angular';
import { createNovanPreviewVerifier } from '@black-isle-beef/cms-angular/server';

const apiUrl = process.env['NOVAN_API_URL'] || 'http://localhost:3000';
const previewToken = process.env['NOVAN_PREVIEW_TOKEN'] || undefined;

// Server only: imported by server.ts and app.config.server.ts, never by browser code.
export const novanServerOptions: NovanServerOptions = {
  apiUrl,
  deliveryToken: process.env['NOVAN_DELIVERY_TOKEN'] ?? '',
  previewToken,
  // Checks the admin's signed preview links with the Preview API.
  verifyPreview: createNovanPreviewVerifier({ apiUrl, previewToken }),
};
