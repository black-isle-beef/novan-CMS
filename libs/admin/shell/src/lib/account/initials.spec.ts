import { initialsFromEmail } from './initials';

describe('initialsFromEmail', () => {
  it('takes one letter from each of the first two words', () => {
    expect(initialsFromEmail('sam.lee@example.com')).toBe('SL');
    expect(initialsFromEmail('jo_ann-smith@example.com')).toBe('JA');
  });

  it('takes the first two letters of a single word', () => {
    expect(initialsFromEmail('editor@example.com')).toBe('ED');
  });

  it('falls back to a question mark without an address', () => {
    expect(initialsFromEmail(null)).toBe('?');
    expect(initialsFromEmail('@example.com')).toBe('?');
  });
});
