import { healthResponseSchema } from '@novan/shared-schemas';

const baseUrl = `http://${process.env['HOST'] ?? 'localhost'}:${process.env['PORT'] ?? '3000'}`;

describe('GET /health', () => {
  it('reports the API is up', async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    expect(healthResponseSchema.safeParse(await res.json()).success).toBe(true);
  });
});
