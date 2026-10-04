import { createServer, type Server } from 'node:http';

/** Where `apps/api-e2e/api.e2e.env` points the API's Cloudflare client. */
export const FAKE_CLOUDFLARE_PORT = 54399;
export const fakeCloudflareUrl = `http://127.0.0.1:${FAKE_CLOUDFLARE_PORT}`;

export interface RecordedPurge {
  zone: string;
  authorization: string | undefined;
  body: { tags?: string[]; files?: string[] };
}

/**
 * Stands in for Cloudflare's purge API: records every `POST /client/v4/zones/:zone/purge_cache` and answers
 * success. Tests read the record with `GET /__purges` (they run in other workers than the global setup).
 */
export function startFakeCloudflare(): Promise<Server> {
  const purges: RecordedPurge[] = [];
  const server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/__purges') return json(200, purges);
    const zone = /^\/client\/v4\/zones\/([^/]+)\/purge_cache$/.exec(req.url ?? '')?.[1];
    if (req.method !== 'POST' || !zone) return json(404, { success: false, errors: [{ message: 'Not found' }] });

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      purges.push({ zone, authorization: req.headers.authorization, body: JSON.parse(raw || '{}') });
      json(200, { success: true, errors: [], result: { id: 'purge' } });
    });
  });
  return new Promise((resolve) => server.listen(FAKE_CLOUDFLARE_PORT, '127.0.0.1', () => resolve(server)));
}
