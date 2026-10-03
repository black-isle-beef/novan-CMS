import { type BlockType, fieldListSchema } from '@novan/shared-schemas';
import { describeChange } from './change-text';

const fields = fieldListSchema.parse([
  { id: 't', apiId: 'title', label: 'Title', type: 'text' },
  { id: 'f', apiId: 'featured', label: 'Featured', type: 'boolean' },
  { id: 'b', apiId: 'body', label: 'Content', type: 'blocks' },
  { id: 's', apiId: 'seo', label: 'SEO', type: 'group', fields: [{ id: 'm', apiId: 'metaTitle', label: 'Search title', type: 'text' }] },
]);
const blockTypes = [
  { apiId: 'hero', name: 'Hero', fields: fieldListSchema.parse([{ id: 'h', apiId: 'heading', label: 'Heading', type: 'text' }]) },
] as BlockType[];
const uid = '00000000-0000-4000-8000-000000000001';

describe('describeChange', () => {
  it('describes field changes with labels and short values', () => {
    expect(describeChange({ kind: 'changed', path: ['title'], before: 'Home', after: 'Welcome' }, fields, blockTypes)).toBe(
      'Changed Title from “Home” to “Welcome”',
    );
    expect(describeChange({ kind: 'added', path: ['featured'], after: true }, fields, blockTypes)).toBe('Set Featured to yes');
    expect(describeChange({ kind: 'removed', path: ['seo', 'metaTitle'], before: 'Old' }, fields, blockTypes)).toBe(
      'Cleared SEO › Search title (was “Old”)',
    );
    expect(describeChange({ kind: 'changed', path: ['body'], before: {}, after: {} }, fields, blockTypes)).toBe('Changed Content');
  });

  it('describes blocks by type and position', () => {
    expect(describeChange({ kind: 'added', path: ['body', uid], block: 'hero' }, fields, blockTypes)).toBe('Added a Hero block to Content');
    expect(describeChange({ kind: 'removed', path: ['body', uid], block: 'hero' }, fields, blockTypes)).toBe(
      'Removed a Hero block from Content',
    );
    expect(describeChange({ kind: 'moved', path: ['body', uid], block: 'hero', from: 1, to: 0 }, fields, blockTypes)).toBe(
      'Moved a Hero block in Content from position 2 to 1',
    );
    expect(
      describeChange({ kind: 'changed', path: ['body', uid, 'heading'], block: 'hero', before: 'A', after: 'B' }, fields, blockTypes),
    ).toBe('Changed Content › Hero block › Heading from “A” to “B”');
  });
});
