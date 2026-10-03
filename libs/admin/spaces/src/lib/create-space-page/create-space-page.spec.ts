import { slugify } from './create-space-page';

describe('slugify', () => {
  it.each([
    ['Acme Ltd', 'acme-ltd'],
    ['  Smith & Sons  ', 'smith-and-sons'],
    ['Café Zoë', 'cafe-zoe'],
    ['---', ''],
    ['A'.repeat(80), 'a'.repeat(63)],
  ])('%s -> %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});
