import { waitForPortOpen } from '@nx/node/utils';

// `nx e2e api-e2e` starts the API through its `serve` dependency; wait until it accepts connections.
export default async function setup(): Promise<void> {
  const host = process.env['HOST'] ?? 'localhost';
  const port = Number(process.env['PORT'] ?? 3000);
  await waitForPortOpen(port, { host });
}
