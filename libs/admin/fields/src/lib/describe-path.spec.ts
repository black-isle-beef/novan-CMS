import { type BlockType, type FieldDefInput, fieldListSchema } from '@novan/shared-schemas';
import { describePath } from './describe-path';

const fields = fieldListSchema.parse([
  { id: 't', apiId: 'title', label: 'Title', type: 'text' },
  { id: 'b', apiId: 'body', label: 'Content', type: 'blocks' },
  { id: 'l', apiId: 'cta', label: 'Button', type: 'link' },
  {
    id: 'g',
    apiId: 'features',
    label: 'Features',
    type: 'group',
    multiple: true,
    fields: [{ id: 'ft', apiId: 'title', label: 'Feature title', type: 'text' }],
  },
] satisfies FieldDefInput[]);

const block = (apiId: string, name: string, blockFields: FieldDefInput[], allowedChildren: string[] = []) =>
  ({ apiId, name, fields: fieldListSchema.parse(blockFields), allowedChildren }) as BlockType;
const blockTypes = [
  block('hero', 'Hero', [{ id: 'h', apiId: 'heading', label: 'Heading', type: 'text' }]),
  block('columns', 'Columns', [], ['hero']),
];

describe('describePath', () => {
  const data = {
    body: [
      { _uid: 'a', _block: 'columns', children: [{ _uid: 'b', _block: 'hero' }] },
      { _uid: 'c', _block: 'hero' },
    ],
  };

  it('names fields, blocks and their nested children', () => {
    expect(describePath('title', fields, data, blockTypes)).toBe('Title');
    expect(describePath('body.1.heading', fields, data, blockTypes)).toBe('Content › Hero block 2 › Heading');
    expect(describePath('body.0.children.0.heading', fields, data, blockTypes)).toBe(
      'Content › Columns block 1 › Blocks inside Columns › Hero block 1 › Heading',
    );
  });

  it('names parts of links and items of repeatable groups', () => {
    expect(describePath('cta.url', fields, data, blockTypes)).toBe('Button › Web address');
    expect(describePath('features.2.title', fields, data, blockTypes)).toBe('Features › Item 3 › Feature title');
    expect(describePath('body.0._block', fields, data, blockTypes)).toBe('Content › Columns block 1 › Block type');
  });
});
