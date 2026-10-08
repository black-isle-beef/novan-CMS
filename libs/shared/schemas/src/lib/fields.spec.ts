import type { z } from 'zod';
import {
  type BlockTypeDef,
  buildEntrySchema,
  type FieldDef,
  type FieldDefInput,
  fieldDefSchema,
  fieldListSchema,
  type MediaAssetInfo,
  mediaRefs,
  REQUIRED_MESSAGE,
} from './fields';

const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Parses field definitions as the API does, filling defaults. */
const defs = (...fields: FieldDefInput[]): FieldDef[] => fieldListSchema.parse(fields);

/** Issues as `path: message`, for readable assertions. */
function issues(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const paragraph = (text: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});

describe('field definitions', () => {
  it('fills defaults for every type', () => {
    const parsed = defs(
      { id: 'f1', apiId: 'title', label: 'Title', type: 'text' },
      { id: 'f2', apiId: 'body', label: 'Body', type: 'richText' },
      { id: 'f3', apiId: 'count', label: 'Count', type: 'number' },
      { id: 'f4', apiId: 'flag', label: 'Flag', type: 'boolean' },
      { id: 'f5', apiId: 'when', label: 'When', type: 'date' },
      { id: 'f6', apiId: 'colour', label: 'Colour', type: 'select', options: [{ value: 'red', label: 'Red' }] },
      { id: 'f7', apiId: 'image', label: 'Image', type: 'media' },
      { id: 'f8', apiId: 'link', label: 'Link', type: 'link' },
      { id: 'f9', apiId: 'author', label: 'Author', type: 'reference' },
      { id: 'f10', apiId: 'content', label: 'Content', type: 'blocks' },
      { id: 'f11', apiId: 'extra', label: 'Extra', type: 'json' },
      {
        id: 'f12',
        apiId: 'seo',
        label: 'SEO',
        type: 'group',
        fields: [{ id: 'g1', apiId: 'metaTitle', label: 'Meta title', type: 'text' }],
      },
    );

    expect(parsed.map((f) => [f.type, f.required, f.localised])).toEqual(
      parsed.map((f) => [f.type, false, false]),
    );
    expect(parsed[0]).toMatchObject({ multiline: false });
    expect(parsed[1]).toMatchObject({ marks: ['bold', 'italic', 'link'], nodes: ['heading', 'bulletList', 'orderedList'] });
    expect(parsed[2]).toMatchObject({ integer: false });
    expect(parsed[4]).toMatchObject({ withTime: false });
    expect(parsed[5]).toMatchObject({ multiple: false });
    expect(parsed[6]).toMatchObject({ accept: ['image'], multiple: false, requireAlt: false });
    expect(parsed[7]).toMatchObject({ allowExternal: true, allowEmail: false });
    expect(parsed[8]).toMatchObject({ contentTypes: [], multiple: false });
    expect(parsed[9]).toMatchObject({ allowedBlocks: [] });
    expect(parsed[11]).toMatchObject({ multiple: false, fields: [{ apiId: 'metaTitle', required: false }] });
  });

  it.each([
    ['an api id that is not camelCase', { id: 'a', apiId: 'Meta_title', label: 'x', type: 'text' }, 'apiId'],
    ['an api id starting with a digit', { id: 'a', apiId: '1st', label: 'x', type: 'text' }, 'apiId'],
    ['an empty label', { id: 'a', apiId: 'x', label: '  ', type: 'text' }, 'label'],
    ['an unknown type', { id: 'a', apiId: 'x', label: 'x', type: 'colour' }, 'type'],
    ['min above max', { id: 'a', apiId: 'x', label: 'x', type: 'text', min: 5, max: 2 }, 'max'],
    ['an invalid pattern', { id: 'a', apiId: 'x', label: 'x', type: 'text', pattern: '([a-z' }, 'pattern'],
    ['a rich text node that does not exist', { id: 'a', apiId: 'x', label: 'x', type: 'richText', nodes: ['table'] }, 'nodes.0'],
    ['a select without options', { id: 'a', apiId: 'x', label: 'x', type: 'select', options: [] }, 'options'],
    [
      'duplicate select options',
      { id: 'a', apiId: 'x', label: 'x', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] },
      'options.1.value',
    ],
    ['media accepting nothing', { id: 'a', apiId: 'x', label: 'x', type: 'media', accept: [] }, 'accept'],
    ['a group without fields', { id: 'a', apiId: 'x', label: 'x', type: 'group', fields: [] }, 'fields'],
    [
      'a range on a single group',
      { id: 'a', apiId: 'x', label: 'x', type: 'group', min: 1, fields: [{ id: 'b', apiId: 'y', label: 'y', type: 'text' }] },
      'multiple',
    ],
  ])('rejects %s', (_, input, path) => {
    const result = fieldDefSchema.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(path);
  });

  it('rejects duplicate ids and api ids, also inside groups', () => {
    const result = fieldListSchema.safeParse([
      { id: 'a', apiId: 'title', label: 'Title', type: 'text' },
      { id: 'a', apiId: 'title', label: 'Again', type: 'text' },
      {
        id: 'g',
        apiId: 'seo',
        label: 'SEO',
        type: 'group',
        fields: [
          { id: 'm', apiId: 'meta', label: 'Meta', type: 'text' },
          { id: 'n', apiId: 'meta', label: 'Meta', type: 'text' },
        ],
      },
    ]);

    expect(result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)).toEqual([
      '2.fields.1.apiId: API id "meta" is used twice.',
      '1.id: Field id "a" is used twice.',
      '1.apiId: API id "title" is used twice.',
    ]);
  });

  it('rejects a hidden required field, unless it is a boolean with a default', () => {
    expect(issues(fieldListSchema, [{ id: 'a', apiId: 'x', label: 'x', type: 'text', required: true, hidden: true }])).toEqual([
      '0.hidden: A hidden field cannot be required: editors could not fill it in.',
    ]);
    expect(
      fieldListSchema.safeParse([{ id: 'a', apiId: 'x', label: 'x', type: 'boolean', required: true, hidden: true, default: false }])
        .success,
    ).toBe(true);
  });
});

describe('buildEntrySchema', () => {
  describe('required and optional', () => {
    const schema = buildEntrySchema(
      defs(
        { id: 'a', apiId: 'title', label: 'Title', type: 'text', required: true },
        { id: 'b', apiId: 'subtitle', label: 'Subtitle', type: 'text' },
      ),
    );

    it('reports a missing required value as required', () => {
      expect(issues(schema, {})).toEqual([`title: ${REQUIRED_MESSAGE}`]);
      expect(issues(schema, { title: null })).toEqual([`title: ${REQUIRED_MESSAGE}`]);
      expect(issues(schema, { title: '   ' })).toEqual([`title: ${REQUIRED_MESSAGE}`]);
    });

    it('lets optional values be missing, null or empty', () => {
      expect(schema.parse({ title: 'Home' })).toEqual({ title: 'Home' });
      expect(schema.parse({ title: 'Home', subtitle: null })).toEqual({ title: 'Home', subtitle: null });
      expect(schema.parse({ title: 'Home', subtitle: '' })).toEqual({ title: 'Home', subtitle: '' });
    });

    it('drops keys that are not fields, so removing a field never invalidates data', () => {
      expect(schema.parse({ title: 'Home', removedField: 'old' })).toEqual({ title: 'Home' });
    });

    it('rejects data that is not an object', () => {
      expect(schema.safeParse(['Home']).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(false);
    });
  });

  describe('localised fields', () => {
    // Locale maps ({ "en-GB": ... }) arrive with package 16; until then a localised field holds a plain
    // value and is validated exactly like any other field.
    const schema = buildEntrySchema(
      defs({ id: 'a', apiId: 'title', label: 'Title', type: 'text', required: true, localised: true, max: 10 }),
    );

    it('validates a plain value', () => {
      expect(schema.parse({ title: 'Bonjour' })).toEqual({ title: 'Bonjour' });
      expect(issues(schema, { title: 'Far too long a title' })).toEqual(['title: Use 10 characters or fewer.']);
    });

    it('does not accept a locale map yet', () => {
      expect(issues(schema, { title: { 'en-GB': 'Hello' } })).toEqual(['title: Expected text.']);
    });
  });

  describe('text', () => {
    const schema = buildEntrySchema(
      defs(
        { id: 'a', apiId: 'line', label: 'Line', type: 'text', min: 3, max: 8 },
        { id: 'b', apiId: 'para', label: 'Para', type: 'text', multiline: true },
        { id: 'c', apiId: 'slug', label: 'Slug', type: 'text', pattern: '[a-z0-9]+(-[a-z0-9]+)*' },
      ),
    );

    it('checks length, single line and type', () => {
      expect(issues(schema, { line: 'ab' })).toEqual(['line: Use at least 3 characters.']);
      expect(issues(schema, { line: 'abcdefghi' })).toEqual(['line: Use 8 characters or fewer.']);
      expect(issues(schema, { line: 'ab\ncd' })).toEqual(['line: Use a single line.']);
      expect(issues(schema, { line: 42 })).toEqual(['line: Expected text.']);
      expect(schema.parse({ para: 'one\ntwo' })).toEqual({ para: 'one\ntwo' });
    });

    it('requires the pattern to match the whole value', () => {
      expect(schema.parse({ slug: 'about-us' })).toEqual({ slug: 'about-us' });
      expect(issues(schema, { slug: 'About us' })).toEqual(['slug: This is not in the expected format.']);
      expect(issues(schema, { slug: 'about-us!' })).toEqual(['slug: This is not in the expected format.']);
    });

    it('does not apply min or the pattern to an empty optional value', () => {
      expect(schema.parse({ line: '', slug: '' })).toEqual({ line: '', slug: '' });
    });
  });

  describe('richText', () => {
    const schema = buildEntrySchema(
      defs({ id: 'a', apiId: 'body', label: 'Body', type: 'richText', required: true, marks: ['bold', 'link'], nodes: ['bulletList'] }),
    );

    it('accepts ProseMirror JSON using allowed nodes and marks', () => {
      const body = doc(paragraph('Hello', [{ type: 'bold' }]), {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [paragraph('One')] }],
      });
      expect(schema.parse({ body })).toEqual({ body });
    });

    it('rejects nodes and marks the field does not allow, with their path', () => {
      expect(issues(schema, { body: doc({ type: 'heading', attrs: { level: 2 }, content: [] }, paragraph('x', [{ type: 'italic' }])) })).toEqual([
        'body.content.0: "heading" is not allowed here.',
        'body.content.1.content.0.marks.0: "italic" formatting is not allowed here.',
      ]);
    });

    it('rejects unsafe link targets', () => {
      const link = (href: string) => ({ body: doc(paragraph('x', [{ type: 'link', attrs: { href } }])) });

      expect(schema.safeParse(link('https://example.com')).success).toBe(true);
      expect(schema.safeParse(link('/about')).success).toBe(true);
      expect(issues(schema, link('javascript:alert(1)'))).toEqual([
        'body.content.0.content.0.marks.0: Links must start with https://, http://, mailto:, tel:, / or #.',
      ]);
    });

    it('treats an empty document as missing', () => {
      expect(issues(schema, { body: doc({ type: 'paragraph' }) })).toEqual([`body: ${REQUIRED_MESSAGE}`]);
      expect(issues(schema, { body: doc(paragraph('  ')) })).toEqual([`body: ${REQUIRED_MESSAGE}`]);
    });

    it('rejects anything that is not a document', () => {
      expect(issues(schema, { body: '<p>Hello</p>' })).toEqual(['body: Expected a rich text document.']);
      expect(schema.safeParse({ body: { type: 'paragraph' } }).success).toBe(false);
    });
  });

  describe('number', () => {
    const schema = buildEntrySchema(defs({ id: 'a', apiId: 'qty', label: 'Qty', type: 'number', min: 1, max: 10, integer: true }));

    it('checks range and whole numbers', () => {
      expect(schema.parse({ qty: 5 })).toEqual({ qty: 5 });
      expect(issues(schema, { qty: 0 })).toEqual(['qty: Use 1 or more.']);
      expect(issues(schema, { qty: 11 })).toEqual(['qty: Use 10 or less.']);
      expect(issues(schema, { qty: 2.5 })).toEqual(['qty: Use a whole number.']);
      expect(issues(schema, { qty: '5' })).toEqual(['qty: Expected a number.']);
      expect(schema.safeParse({ qty: Number.NaN }).success).toBe(false);
    });
  });

  describe('boolean', () => {
    const schema = buildEntrySchema(
      defs(
        { id: 'a', apiId: 'noindex', label: 'Hide from search', type: 'boolean', default: false },
        { id: 'b', apiId: 'agreed', label: 'Agreed', type: 'boolean', required: true },
      ),
    );

    it('applies the default and accepts false as a required value', () => {
      expect(schema.parse({ agreed: false })).toEqual({ noindex: false, agreed: false });
      expect(issues(schema, {})).toEqual([`agreed: ${REQUIRED_MESSAGE}`]);
      expect(issues(schema, { agreed: 'yes' })).toEqual(['agreed: Expected true or false.']);
    });
  });

  describe('date', () => {
    const schema = buildEntrySchema(
      defs(
        { id: 'a', apiId: 'day', label: 'Day', type: 'date' },
        { id: 'b', apiId: 'at', label: 'At', type: 'date', withTime: true },
      ),
    );

    it('takes an ISO date, or a UTC date-time when withTime', () => {
      expect(schema.parse({ day: '2026-10-03', at: '2026-10-03T09:30:00Z' })).toEqual({
        day: '2026-10-03',
        at: '2026-10-03T09:30:00Z',
      });
      expect(issues(schema, { day: '03/10/2026' })).toEqual(['day: Expected a date like 2026-10-03.']);
      expect(issues(schema, { at: '2026-10-03' })).toEqual(['at: Expected a UTC date and time like 2026-10-03T09:30:00Z.']);
      expect(schema.safeParse({ at: '2026-10-03T09:30:00+01:00' }).success).toBe(false);
    });
  });

  describe('select', () => {
    const options = [
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
    ];
    const schema = buildEntrySchema(
      defs(
        { id: 'a', apiId: 'one', label: 'One', type: 'select', options },
        { id: 'b', apiId: 'many', label: 'Many', type: 'select', options, multiple: true, required: true },
      ),
    );

    it('allows only the options, once each', () => {
      expect(schema.parse({ one: 'red', many: ['red', 'blue'] })).toEqual({ one: 'red', many: ['red', 'blue'] });
      expect(issues(schema, { one: 'green', many: ['red'] })).toEqual(['one: Choose one of the options.']);
      expect(issues(schema, { many: ['red', 'red'] })).toEqual(['many.1: Value "red" is used twice.']);
      expect(issues(schema, { many: [] })).toEqual([`many: ${REQUIRED_MESSAGE}`]);
      expect(issues(schema, { many: 'red' })).toEqual(['many: Expected a list.']);
    });
  });

  describe('media', () => {
    const mediaFields = defs(
      { id: 'a', apiId: 'image', label: 'Image', type: 'media', requireAlt: true, required: true },
      { id: 'b', apiId: 'gallery', label: 'Gallery', type: 'media', multiple: true, requireAlt: true },
    );
    const schema = buildEntrySchema(mediaFields);

    it('takes an asset id with optional alt text', () => {
      expect(schema.parse({ image: { assetId: uid(1), alt: 'A red door' } })).toEqual({
        image: { assetId: uid(1), alt: 'A red door' },
      });
      // Without the library, alt text may come from the asset, so it is not asked for.
      expect(schema.parse({ image: { assetId: uid(1) } })).toEqual({ image: { assetId: uid(1) } });
      expect(issues(schema, { image: { assetId: 'nope', alt: 'x' } })).toEqual(['image.assetId: Expected an id (UUID).']);
    });

    it('takes a list when multiple', () => {
      const gallery = [{ assetId: uid(1) }, { assetId: uid(2), alt: '' }];
      expect(schema.parse({ image: { assetId: uid(3), alt: 'x' }, gallery })).toMatchObject({ gallery });
    });

    describe('with the media library', () => {
      const library = new Map<string, MediaAssetInfo>([
        [uid(1), { kind: 'image', alt: 'A red door' }],
        [uid(2), { kind: 'image', alt: null }],
        [uid(3), { kind: 'file', alt: null }],
      ]);
      const lookup = (id: string) => library.get(id) ?? (id === uid(9) ? undefined : null);
      const publish = buildEntrySchema(mediaFields, { assets: lookup });
      const draft = buildEntrySchema(mediaFields, { assets: lookup, draft: true });

      it('publishing needs alt text on the item or the asset when the field requires it', () => {
        expect(issues(publish, { image: { assetId: uid(1) } })).toEqual([]);
        expect(issues(publish, { image: { assetId: uid(2), alt: 'A blue door' } })).toEqual([]);
        expect(issues(publish, { image: { assetId: uid(2), alt: '  ' } })).toEqual([
          'image.alt: Describe the image for people who cannot see it.',
        ]);
        // A draft may still be missing it.
        expect(issues(draft, { image: { assetId: uid(2) } })).toEqual([]);
      });

      it('refuses a kind of file the field does not accept, even in a draft', () => {
        expect(issues(draft, { image: { assetId: uid(3), alt: 'x' } })).toEqual(['image.assetId: Choose an image.']);
      });

      it('publishing needs every file to still be in the library; unknown ones are left to the API', () => {
        expect(issues(publish, { image: { assetId: uid(1) }, gallery: [{ assetId: uid(4) }] })).toEqual([
          'gallery.0.assetId: This file is no longer in the media library. Choose another.',
        ]);
        expect(issues(draft, { image: { assetId: uid(4) } })).toEqual([]);
        expect(issues(publish, { image: { assetId: uid(9) } })).toEqual([]);
      });
    });
  });

  describe('mediaRefs', () => {
    const blocks = [
      { apiId: 'hero', fields: defs({ id: 'i', apiId: 'image', label: 'Image', type: 'media' }), allowedChildren: ['hero'] },
    ];
    const fields = defs(
      { id: 'a', apiId: 'image', label: 'Image', type: 'media' },
      { id: 'b', apiId: 'gallery', label: 'Gallery', type: 'media', multiple: true, requireAlt: true },
      {
        id: 'c',
        apiId: 'seo',
        label: 'SEO',
        type: 'group',
        fields: [{ id: 'o', apiId: 'ogImage', label: 'Image', type: 'media' }],
      },
      { id: 'd', apiId: 'body', label: 'Body', type: 'blocks' },
      { id: 'e', apiId: 'extra', label: 'Extra', type: 'json' },
    );

    it('finds media items in fields, lists, groups, blocks and their children, by block _uid', () => {
      const data = {
        image: { assetId: uid(1) },
        gallery: [{ assetId: uid(2), alt: 'A sunset' }, { assetId: uid(3), alt: ' ' }],
        seo: { ogImage: { assetId: uid(4) } },
        body: [{ _uid: uid(10), _block: 'hero', image: { assetId: uid(5) }, children: [{ _uid: uid(11), _block: 'hero', image: { assetId: uid(6) } }] }],
        extra: { assetId: uid(7) },
      };
      expect(mediaRefs(fields, data, blocks)).toEqual([
        { assetId: uid(1), path: 'image', requireAlt: false },
        { assetId: uid(2), path: 'gallery.0', alt: 'A sunset', requireAlt: true },
        { assetId: uid(3), path: 'gallery.1', requireAlt: true },
        { assetId: uid(4), path: 'seo.ogImage', requireAlt: false },
        { assetId: uid(5), path: `body.${uid(10)}.image`, requireAlt: false },
        { assetId: uid(6), path: `body.${uid(10)}.children.${uid(11)}.image`, requireAlt: false },
      ]);
    });

    it('skips values of the wrong shape', () => {
      expect(mediaRefs(fields, { image: 'x', gallery: { assetId: uid(1) }, seo: [], body: [null, { _block: 'hero' }] }, blocks)).toEqual([]);
    });
  });

  describe('link', () => {
    const internalOnly = buildEntrySchema(defs({ id: 'a', apiId: 'link', label: 'Link', type: 'link', allowExternal: false }));
    const all = buildEntrySchema(defs({ id: 'a', apiId: 'link', label: 'Link', type: 'link', allowEmail: true }));

    it('always allows internal links', () => {
      const link = { type: 'internal', entryId: uid(1), anchor: 'team', text: 'Meet the team' };
      expect(internalOnly.parse({ link })).toEqual({ link });
    });

    it('allows external and email links only when the field does', () => {
      expect(issues(internalOnly, { link: { type: 'external', url: 'https://example.com' } })).toEqual([
        'link.type: Use a link of type internal.',
      ]);
      expect(all.parse({ link: { type: 'external', url: 'https://example.com' } })).toMatchObject({ link: { type: 'external' } });
      expect(all.parse({ link: { type: 'email', email: 'hi@example.com' } })).toMatchObject({ link: { type: 'email' } });
    });

    it('rejects unsafe or partial web addresses', () => {
      expect(issues(all, { link: { type: 'external', url: 'javascript:alert(1)' } })).toEqual([
        'link.url: Use a full web address starting with https://.',
      ]);
      expect(all.safeParse({ link: { type: 'external', url: 'ftp://example.com' } }).success).toBe(false);
      expect(all.safeParse({ link: { type: 'email', email: 'not-an-email' } }).success).toBe(false);
    });
  });

  describe('reference', () => {
    const schema = buildEntrySchema(
      defs(
        { id: 'a', apiId: 'author', label: 'Author', type: 'reference' },
        { id: 'b', apiId: 'related', label: 'Related', type: 'reference', multiple: true },
      ),
    );

    it('takes entry ids, without duplicates', () => {
      expect(schema.parse({ author: uid(1), related: [uid(2), uid(3)] })).toEqual({ author: uid(1), related: [uid(2), uid(3)] });
      expect(issues(schema, { author: 'someone' })).toEqual(['author: Expected an id (UUID).']);
      expect(issues(schema, { related: [uid(2), uid(2)] })).toEqual([`related.1: Value "${uid(2)}" is used twice.`]);
    });
  });

  describe('json', () => {
    const schema = buildEntrySchema(defs({ id: 'a', apiId: 'data', label: 'Data', type: 'json', required: true }));

    it('takes any JSON value', () => {
      expect(schema.parse({ data: { a: [1, 'two', true, null] } })).toEqual({ data: { a: [1, 'two', true, null] } });
      expect(schema.parse({ data: 0 })).toEqual({ data: 0 });
      expect(issues(schema, {})).toEqual([`data: ${REQUIRED_MESSAGE}`]);
      expect(issues(schema, { data: { when: new Date() } })).toEqual(['data: Expected JSON.']);
    });
  });

  describe('group', () => {
    const schema = buildEntrySchema(
      defs(
        {
          id: 'g',
          apiId: 'seo',
          label: 'SEO',
          type: 'group',
          fields: [
            { id: 't', apiId: 'metaTitle', label: 'Meta title', type: 'text', max: 10 },
            { id: 'n', apiId: 'noindex', label: 'No index', type: 'boolean', default: false },
          ],
        },
        {
          id: 'f',
          apiId: 'features',
          label: 'Features',
          type: 'group',
          multiple: true,
          min: 1,
          max: 2,
          fields: [{ id: 'x', apiId: 'title', label: 'Title', type: 'text', required: true }],
        },
      ),
    );

    it('validates nested fields with their path, and fills nested defaults', () => {
      expect(schema.parse({ seo: { metaTitle: 'Home' } })).toEqual({ seo: { metaTitle: 'Home', noindex: false } });
      expect(issues(schema, { seo: { metaTitle: 'Far too long' } })).toEqual(['seo.metaTitle: Use 10 characters or fewer.']);
    });

    it('validates repeatable groups and their range', () => {
      expect(issues(schema, { features: [{ title: 'Fast' }, {}] })).toEqual([`features.1.title: ${REQUIRED_MESSAGE}`]);
      expect(issues(schema, { features: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] })).toEqual(['features: Add 2 or fewer.']);
    });
  });

  describe('blocks, shape only (no block types given)', () => {
    const schema = buildEntrySchema(
      defs({ id: 'b', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['hero', 'cta'], max: 3, required: true }),
    );

    it('keeps block fields and checks _uid, _block and allowedBlocks', () => {
      const body = [{ _uid: uid(1), _block: 'hero', heading: 'Welcome' }];
      expect(schema.parse({ body })).toEqual({ body });
      expect(issues(schema, { body: [{ _uid: 'x', _block: 'hero' }] })).toEqual(['body.0._uid: Expected an id (UUID).']);
      expect(issues(schema, { body: [{ _uid: uid(1), _block: 'gallery' }] })).toEqual(['body.0._block: This block is not allowed here.']);
    });

    it('keeps named style options', () => {
      const body = [{ _uid: uid(1), _block: 'hero', _style: { tone: 'dark' } }];
      expect(schema.parse({ body })).toEqual({ body });
      expect(issues(schema, { body: [{ _uid: uid(1), _block: 'hero', _style: { tone: 'rgb(0,0,0)' } }] })).toEqual([
        'body.0._style.tone: Use a named style option.',
      ]);
    });

    it('checks the range and requires at least one block', () => {
      const block = (n: number) => ({ _uid: uid(n), _block: 'cta' });
      expect(issues(schema, { body: [] })).toEqual([`body: ${REQUIRED_MESSAGE}`]);
      expect(issues(schema, { body: [block(1), block(2), block(3), block(4)] })).toEqual(['body: Add 3 or fewer.']);
    });

    it('rejects a _uid used twice anywhere in the tree', () => {
      expect(
        issues(schema, {
          body: [
            { _uid: uid(1), _block: 'hero', children: [{ _uid: uid(2), _block: 'cta' }] },
            { _uid: uid(2), _block: 'cta' },
          ],
        }),
      ).toEqual(['body.1._uid: Each block needs its own _uid.']);
    });
  });

  describe('blocks, with block types', () => {
    const blockTypes: BlockTypeDef[] = [
      { apiId: 'hero', fields: defs({ id: 'h', apiId: 'heading', label: 'Heading', type: 'text', required: true }) },
      { apiId: 'cta', fields: defs({ id: 'c', apiId: 'text', label: 'Text', type: 'text', max: 20 }) },
      {
        apiId: 'columns',
        fields: defs({ id: 'n', apiId: 'gap', label: 'Gap', type: 'number' }),
        allowedChildren: ['cta', 'columns'],
      },
      {
        apiId: 'tabs',
        // A block whose own field holds blocks of its own type.
        fields: defs({ id: 'p', apiId: 'panels', label: 'Panels', type: 'blocks', allowedBlocks: ['tabs', 'cta'] }),
      },
    ];
    const schema = buildEntrySchema(defs({ id: 'b', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['hero', 'columns', 'tabs'] }), {
      blockTypes,
    });

    it('validates each block against its type, and strips unknown block fields', () => {
      expect(schema.parse({ body: [{ _uid: uid(1), _block: 'hero', heading: 'Hi', stray: true }] })).toEqual({
        body: [{ _uid: uid(1), _block: 'hero', heading: 'Hi' }],
      });
      expect(issues(schema, { body: [{ _uid: uid(1), _block: 'hero' }] })).toEqual([`body.0.heading: ${REQUIRED_MESSAGE}`]);
    });

    it('keeps style options, and refuses raw values in them', () => {
      const styled = { _uid: uid(1), _block: 'hero', heading: 'Hi', _style: { tone: 'brand', rounded: true, retired: 'old-value' } };
      expect(schema.parse({ body: [styled] })).toEqual({ body: [styled] });
      expect(issues(schema, { body: [{ ...styled, _style: { tone: '#ff0000' } }] })).toEqual([
        'body.0._style.tone: Use a named style option.',
      ]);
      expect(issues(schema, { body: [{ ...styled, _style: { size: 12 } }] })).toHaveLength(1);
      expect(issues(schema, { body: [{ ...styled, _style: ['brand'] }] })).toHaveLength(1);
    });

    it('keeps hidden blocks hidden', () => {
      const hidden = { _uid: uid(1), _block: 'hero', heading: 'Hi', _hidden: true };
      expect(schema.parse({ body: [hidden] })).toEqual({ body: [hidden] });
      expect(issues(schema, { body: [{ ...hidden, _hidden: 'yes' }] })).toHaveLength(1);
    });

    it('rejects block types the field does not allow, or that do not exist', () => {
      expect(issues(schema, { body: [{ _uid: uid(1), _block: 'cta' }] })).toEqual([
        'body.0._block: Use one of these blocks: hero, columns, tabs.',
      ]);
      expect(issues(schema, { body: [{ _uid: uid(1), _block: 'gallery' }] })).toEqual([
        'body.0._block: Use one of these blocks: hero, columns, tabs.',
      ]);
    });

    it('validates children against allowedChildren, recursively', () => {
      const body = [
        {
          _uid: uid(1),
          _block: 'columns',
          gap: 2,
          children: [
            { _uid: uid(2), _block: 'cta', text: 'Buy' },
            { _uid: uid(3), _block: 'columns', children: [{ _uid: uid(4), _block: 'cta', text: 'This text is far too long' }] },
          ],
        },
      ];
      expect(issues(schema, { body })).toEqual(['body.0.children.1.children.0.text: Use 20 characters or fewer.']);
      expect(issues(schema, { body: [{ ...body[0], children: [{ _uid: uid(2), _block: 'hero', heading: 'x' }] }] })).toEqual([
        'body.0.children.0._block: Use one of these blocks: cta, columns.',
      ]);
    });

    it('rejects children on a block type that has none', () => {
      expect(
        issues(schema, { body: [{ _uid: uid(1), _block: 'hero', heading: 'Hi', children: [{ _uid: uid(2), _block: 'cta' }] }] }),
      ).toEqual(['body.0.children: This block cannot contain other blocks.']);
    });

    it('handles block types that contain themselves', () => {
      const body = [
        {
          _uid: uid(1),
          _block: 'tabs',
          panels: [{ _uid: uid(2), _block: 'tabs', panels: [{ _uid: uid(3), _block: 'cta', text: 'Deep' }] }],
        },
      ];
      expect(schema.parse({ body })).toEqual({ body });
    });

    it('allows every block type when allowedBlocks is empty', () => {
      const any = buildEntrySchema(defs({ id: 'b', apiId: 'body', label: 'Body', type: 'blocks' }), { blockTypes });
      expect(any.safeParse({ body: [{ _uid: uid(1), _block: 'cta' }] }).success).toBe(true);
    });
  });

  describe('drafts', () => {
    const fields = defs(
      { id: 't', apiId: 'title', label: 'Title', type: 'text', required: true, min: 5, max: 10 },
      { id: 'r', apiId: 'body', label: 'Body', type: 'richText', required: true },
      { id: 'n', apiId: 'count', label: 'Count', type: 'number', required: true },
      { id: 'f', apiId: 'flag', label: 'Flag', type: 'boolean', required: true },
      {
        id: 'g',
        apiId: 'items',
        label: 'Items',
        type: 'group',
        required: true,
        multiple: true,
        min: 2,
        fields: [{ id: 'gt', apiId: 'label', label: 'Label', type: 'text', required: true }],
      },
    );
    const draft = buildEntrySchema(fields, { draft: true });
    const full = buildEntrySchema(fields);

    it('accepts incomplete data: empty required fields, too few characters or items', () => {
      const incomplete = { title: 'Hi', body: doc(), items: [{ label: '' }] };
      expect(issues(draft, incomplete)).toEqual([]);
      expect(issues(draft, {})).toEqual([]);
      expect(issues(full, incomplete)).toEqual([
        'title: Use at least 5 characters.',
        `body: ${REQUIRED_MESSAGE}`,
        `count: ${REQUIRED_MESSAGE}`,
        `flag: ${REQUIRED_MESSAGE}`,
        `items.0.label: ${REQUIRED_MESSAGE}`,
        'items: Add at least 2.',
      ]);
    });

    it('still rejects malformed values', () => {
      expect(issues(draft, { title: 'Far too long a title', count: 'three', flag: 'yes', items: 'none' })).toEqual([
        'title: Use 10 characters or fewer.',
        'count: Expected a number.',
        'flag: Expected true or false.',
        'items: Expected a list.',
      ]);
    });

    it('relaxes required fields inside blocks too', () => {
      const blockTypes: BlockTypeDef[] = [
        { apiId: 'hero', fields: defs({ id: 'h', apiId: 'heading', label: 'Heading', type: 'text', required: true }) },
      ];
      const body = defs({ id: 'b', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['hero'] });
      const data = { body: [{ _uid: uid(1), _block: 'hero' }] };
      expect(issues(buildEntrySchema(body, { blockTypes, draft: true }), data)).toEqual([]);
      expect(issues(buildEntrySchema(body, { blockTypes }), data)).toEqual([`body.0.heading: ${REQUIRED_MESSAGE}`]);
    });
  });
});
