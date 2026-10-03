import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('accepts a healthy response', () => {
    expect(healthResponseSchema.parse({ status: 'ok', version: '1.0.0' })).toEqual({ status: 'ok', version: '1.0.0' });
  });

  it('rejects an unknown status', () => {
    expect(healthResponseSchema.safeParse({ status: 'down', version: '1.0.0' }).success).toBe(false);
  });
});
