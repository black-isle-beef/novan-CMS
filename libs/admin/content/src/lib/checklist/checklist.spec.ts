import { headingChecks, pageChecks } from './checklist';

const h = (level: number, text: string, uid: string | null = null) => ({ level, text, uid });

describe('headingChecks', () => {
  it('is quiet for a well-ordered page, and before the site has said anything', () => {
    expect(headingChecks([h(1, 'Home', 'a'), h(2, 'Features', 'b'), h(3, 'Fast', 'b'), h(2, 'Contact', 'c')])).toEqual([]);
    expect(headingChecks([])).toEqual([]);
  });

  it('asks for one main heading', () => {
    expect(headingChecks([h(2, 'Intro', 'a')])[0]).toMatchObject({ severity: 'warning', uid: 'a', message: expect.stringContaining('no main heading') });
    expect(headingChecks([h(1, 'One', 'a'), h(1, 'Two', 'b')])[0]).toMatchObject({ uid: 'b', message: expect.stringContaining('2 main headings') });
  });

  it('points at headings that skip a level', () => {
    expect(headingChecks([h(1, 'Home', 'a'), h(3, 'Fast', 'b'), h(5, '', null)])).toEqual([
      { severity: 'warning', message: '“Fast” is an H3 after an H1, skipping a level. Use an H2.', uid: 'b' },
      { severity: 'warning', message: '“A heading” is an H5 after an H3, skipping a level. Use an H4.', uid: null },
    ]);
  });
});

describe('pageChecks', () => {
  const base = {
    errors: {},
    describe: (path: string) => `Field ${path}`,
    blockAt: (path: string) => (path.startsWith('body.0') ? 'hero' : null),
    media: [],
    asset: () => undefined,
    describeMedia: () => ({ label: 'Hero › Image', uid: 'hero' }),
    headings: [h(1, 'Home', 'hero')],
  };

  it('lists publish errors first, with the block they are in', () => {
    const items = pageChecks({ ...base, errors: { 'body.0.heading': ['This field is required.'], title: ['Too long.'] }, headings: [h(2, 'x')] });
    expect(items.map((item) => [item.severity, item.message, item.uid])).toEqual([
      ['error', 'Field body.0.heading: This field is required.', 'hero'],
      ['error', 'Field title: Too long.', null],
      ['warning', expect.stringContaining('no main heading'), null],
    ]);
  });

  it('warns about images with no alternative text on the page or in the library', () => {
    const media = [
      { assetId: 'no-alt', path: 'body.hero.image', requireAlt: false },
      { assetId: 'library-alt', path: 'x', requireAlt: false },
      { assetId: 'no-alt', path: 'y', alt: 'Own text', requireAlt: false },
      { assetId: 'no-alt', path: 'z', requireAlt: true },
      { assetId: 'document', path: 'd', requireAlt: false },
      { assetId: 'loading', path: 'l', requireAlt: false },
    ];
    const assets: Record<string, { kind: 'image' | 'file'; alt: string | null }> = {
      'no-alt': { kind: 'image', alt: null },
      'library-alt': { kind: 'image', alt: 'Library text' },
      document: { kind: 'file', alt: null },
    };
    const items = pageChecks({ ...base, media, asset: (id) => assets[id] });
    expect(items).toEqual([
      { severity: 'warning', message: expect.stringContaining('Hero › Image: the image has no alternative text'), uid: 'hero' },
    ]);
  });
});
