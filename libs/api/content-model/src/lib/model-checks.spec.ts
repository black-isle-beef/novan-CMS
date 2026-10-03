import { type FieldDefInput, fieldListSchema } from '@novan/shared-schemas';
import { affectedEntries, type ModelSnapshot, referencesIn, unknownReferences } from './model-checks';

const defs = (...fields: FieldDefInput[]) => fieldListSchema.parse(fields);
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('referencesIn', () => {
  it('finds allowed blocks and referenced content types, including inside groups', () => {
    const fields = defs(
      { id: 'b', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['hero', 'cta'] },
      {
        id: 'g',
        apiId: 'more',
        label: 'More',
        type: 'group',
        fields: [{ id: 'r', apiId: 'author', label: 'Author', type: 'reference', contentTypes: ['person'] }],
      },
      { id: 't', apiId: 'title', label: 'Title', type: 'text' },
    );

    expect(referencesIn(fields)).toEqual([
      { kind: 'blockType', apiId: 'hero', path: 'fields.0.allowedBlocks.0' },
      { kind: 'blockType', apiId: 'cta', path: 'fields.0.allowedBlocks.1' },
      { kind: 'contentType', apiId: 'person', path: 'fields.1.fields.0.contentTypes.0' },
    ]);
  });
});

describe('unknownReferences', () => {
  it('reports each reference to a type that does not exist, by path', () => {
    const references = referencesIn(
      defs(
        { id: 'b', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['hero', 'gallery'] },
        { id: 'r', apiId: 'author', label: 'Author', type: 'reference', contentTypes: ['person'] },
      ),
    );

    expect(unknownReferences(references, { blockTypes: new Set(['hero']), contentTypes: new Set(['page']) })).toEqual({
      'fields.0.allowedBlocks.1': ['There is no block type "gallery" in this environment.'],
      'fields.1.contentTypes.0': ['There is no content type "person" in this environment.'],
    });
  });
});

describe('affectedEntries', () => {
  const before: ModelSnapshot = {
    contentTypes: [
      {
        id: 'page',
        fields: defs(
          { id: 't', apiId: 'title', label: 'Title', type: 'text' },
          { id: 'b', apiId: 'body', label: 'Body', type: 'blocks' },
        ),
      },
    ],
    blockTypes: [
      { apiId: 'hero', fields: defs({ id: 'h', apiId: 'heading', label: 'Heading', type: 'text' }) },
      { apiId: 'cta', fields: [] },
    ],
  };
  const entries = [
    { id: 'e1', contentTypeId: 'page', data: { title: 'Home', body: [{ _uid: uid(1), _block: 'hero' }] } },
    { id: 'e2', contentTypeId: 'page', data: { body: [{ _uid: uid(2), _block: 'cta' }] } },
    { id: 'e3', contentTypeId: 'page', data: { title: 42 } },
  ];

  it('is zero when there are no entries', () => {
    expect(affectedEntries([], before, before)).toBe(0);
  });

  it('counts entries a stricter field would invalidate, not those already invalid', () => {
    const after: ModelSnapshot = {
      ...before,
      contentTypes: [
        {
          id: 'page',
          fields: defs(
            { id: 't', apiId: 'title', label: 'Title', type: 'text', required: true },
            { id: 'b', apiId: 'body', label: 'Body', type: 'blocks' },
          ),
        },
      ],
    };
    // e2 loses its title; e3 was already invalid.
    expect(affectedEntries(entries, before, after)).toBe(1);
  });

  it('counts entries using a block whose fields became stricter or that was removed', () => {
    const stricterHero: ModelSnapshot = {
      ...before,
      blockTypes: [
        { apiId: 'hero', fields: defs({ id: 'h', apiId: 'heading', label: 'Heading', type: 'text', required: true }) },
        { apiId: 'cta', fields: [] },
      ],
    };
    const withoutCta: ModelSnapshot = { ...before, blockTypes: [before.blockTypes[0]] };

    expect(affectedEntries(entries, before, stricterHero)).toBe(1);
    expect(affectedEntries(entries, before, withoutCta)).toBe(1);
  });

  it('counts nothing for a change that loosens validation', () => {
    const looser: ModelSnapshot = { ...before, contentTypes: [{ id: 'page', fields: [] }] };
    expect(affectedEntries(entries, before, looser)).toBe(0);
  });
});
