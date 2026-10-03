import type { HealthResponse } from './health';

describe('HealthResponse', () => {
  it('only allows the ok status', () => {
    expectTypeOf<HealthResponse['status']>().toEqualTypeOf<'ok'>();
  });
});
