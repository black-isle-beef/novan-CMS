import { spaceNav } from '../nav/space-nav';
import { agencyOnlyWordsPattern, copy } from './copy';

describe('plain-language copy', () => {
  it('never uses an agency-only word', () => {
    for (const text of Object.values(copy)) expect(text).not.toMatch(agencyOnlyWordsPattern);
  });

  it('keeps the client menu in plain language', () => {
    const client = spaceNav.filter((item) => ['space.read', 'content.read', 'media.read'].includes(item.permission));
    for (const item of client) expect(item.label).not.toMatch(agencyOnlyWordsPattern);
  });

  it('catches the words in any case and spacing, but not inside other words', () => {
    for (const text of ['New entry', 'ENTRIES', 'the main environment', 'Content  type', 'content types'])
      expect(text).toMatch(agencyOnlyWordsPattern);
    for (const text of ['entryway', 'Content', 'Page type', 'Environmental']) expect(text).not.toMatch(agencyOnlyWordsPattern);
  });
});
