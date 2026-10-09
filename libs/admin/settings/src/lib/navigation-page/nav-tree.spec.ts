import { fieldListSchema } from '@novan/shared-schemas';
import { addItem, itemName, moveItem, navTrees, nestItem, removeItem, unnestItem } from './nav-tree';

const link = { id: 'link', apiId: 'link', label: 'Link', type: 'link' };
// The seeded navigation type (supabase/seed.sql), trimmed.
const fields = fieldListSchema.parse([
  {
    id: 'items',
    apiId: 'items',
    label: 'Main menu',
    type: 'group',
    multiple: true,
    max: 8,
    fields: [
      { id: 'label', apiId: 'label', label: 'Label', type: 'text' },
      link,
      { id: 'subItems', apiId: 'subItems', label: 'Sub-links', type: 'group', multiple: true, fields: [{ id: 'label', apiId: 'label', label: 'Label', type: 'text' }, link] },
    ],
  },
  {
    id: 'footerGroups',
    apiId: 'footerGroups',
    label: 'Footer links',
    type: 'group',
    multiple: true,
    fields: [
      { id: 'title', apiId: 'title', label: 'Title', type: 'text' },
      { id: 'links', apiId: 'links', label: 'Links', type: 'group', multiple: true, fields: [{ id: 'label', apiId: 'label', label: 'Label', type: 'text' }, link] },
    ],
  },
]);
const [menu, footer] = navTrees(fields);

const data = () => ({
  items: [
    { label: 'Home', link: { type: 'internal', entryId: 'h' } },
    { label: 'About', link: null, subItems: [{ label: 'Team', link: { type: 'internal', entryId: 't' } }] },
    { label: 'Blog', link: { type: 'external', url: 'https://blog.example.com' } },
  ],
  footerGroups: [{ title: 'More', links: [{ label: 'Email' }] }],
});

describe('navTrees', () => {
  it('finds each menu, what names its items, and whether items can nest', () => {
    expect(menu).toMatchObject({ field: { apiId: 'items' }, children: { apiId: 'subItems' }, nameKey: 'label', childNameKey: 'label', nests: true });
    expect(footer).toMatchObject({ field: { apiId: 'footerGroups' }, children: { apiId: 'links' }, nameKey: 'title', nests: false });
  });
});

describe('menu changes', () => {
  it('adds, moves and removes items at either level', () => {
    expect(addItem(data(), ['items', 1, 'subItems'])['items']).toMatchObject([{}, { subItems: [{ label: 'Team' }, {}] }, {}]);
    expect((moveItem(data(), ['items'], 2, -1)['items'] as { label: string }[]).map((i) => i.label)).toEqual(['Home', 'Blog', 'About']);
    expect(moveItem(data(), ['items'], 0, -1)).toEqual(data());
    expect((removeItem(data(), ['items'], 0)['items'] as { label: string }[]).map((i) => i.label)).toEqual(['About', 'Blog']);
  });

  it('makes an item a sub-link of the one above, and back', () => {
    const nested = nestItem(data(), menu, 2);
    expect(nested['items']).toEqual([
      data().items[0],
      { ...data().items[1], subItems: [{ label: 'Team', link: { type: 'internal', entryId: 't' } }, { label: 'Blog', link: { type: 'external', url: 'https://blog.example.com' } }] },
    ]);

    const back = unnestItem(nested, menu, 1, 1);
    expect(back['items']).toEqual([data().items[0], data().items[1], { label: 'Blog', link: { type: 'external', url: 'https://blog.example.com' } }]);
  });

  it('does not nest the first item, an item with sub-links, or footer columns', () => {
    expect(nestItem(data(), menu, 0)).toEqual(data());
    // "About" has a sub-link of its own.
    expect(nestItem(data(), menu, 1)).toEqual(data());
    expect(nestItem(data(), footer, 1)).toEqual(data());
  });

  it('names items by their label, or their position', () => {
    expect(itemName({ label: ' About ' }, 'label', 2)).toBe('“About”');
    expect(itemName({}, 'label', 3)).toBe('item 3');
  });
});
