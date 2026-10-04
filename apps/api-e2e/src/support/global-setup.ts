import { waitForPortOpen } from '@nx/node/utils';
import { startFakeCloudflare } from './fake-cloudflare';

// `nx e2e api-e2e` starts the API through its `serve-e2e` dependency; wait until it accepts connections.
// The fake Cloudflare API records the cache purges the API sends (see apps/api-e2e/api.e2e.env).
export default async function setup(): Promise<() => Promise<void>> {
  const host = process.env['HOST'] ?? 'localhost';
  const port = Number(process.env['PORT'] ?? 3000);
  const cloudflare = await startFakeCloudflare();
  await waitForPortOpen(port, { host });
  return () => new Promise((resolve) => cloudflare.close(() => resolve()));
}
