import { BLOCK_NAMES } from './block-names';

describe('BLOCK_NAMES', () => {
  it('has no duplicate block names', () => {
    expect(new Set(BLOCK_NAMES).size).toBe(BLOCK_NAMES.length);
  });
});
