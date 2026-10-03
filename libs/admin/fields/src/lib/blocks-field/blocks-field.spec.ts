import { TestBed } from '@angular/core/testing';
import { type BlockNode, type BlockType, type FieldDefInput, fieldDefSchema, fieldListSchema, type FieldDefOf } from '@novan/shared-schemas';
import { FieldFormContext } from '../field-form-context';
import { BlocksField } from './blocks-field';

const blockType = (apiId: string, name: string, fields: FieldDefInput[], allowedChildren: string[] = []): BlockType => ({
  id: apiId,
  spaceId: 's',
  environmentId: 'e',
  apiId,
  name,
  icon: 'box',
  previewImagePath: null,
  fields: fieldListSchema.parse(fields),
  allowedChildren,
  styleOptions: {},
  schemaVersion: 1,
  createdAt: '',
  updatedAt: '',
});

const hero = blockType('hero', 'Hero', [
  { id: 'h', apiId: 'heading', label: 'Heading', type: 'text', required: true },
  { id: 'd', apiId: 'dark', label: 'Dark', type: 'boolean', default: false },
]);
const columns = blockType('columns', 'Columns', [], ['hero']);
const field = fieldDefSchema.parse({ id: 'b', apiId: 'body', label: 'Content', type: 'blocks', allowedBlocks: ['hero', 'columns'] }) as FieldDefOf<'blocks'>;
const node = (uid: string, heading: string): BlockNode => ({ _uid: uid, _block: 'hero', heading });

async function render(value: BlockNode[] = []) {
  TestBed.configureTestingModule({ imports: [BlocksField], providers: [FieldFormContext] });
  const context = TestBed.inject(FieldFormContext);
  context.blockTypes.set([hero, columns]);
  const fixture = TestBed.createComponent(BlocksField);
  fixture.componentRef.setInput('field', field);
  fixture.componentRef.setInput('path', 'body');
  fixture.componentRef.setInput('value', value);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name) as HTMLButtonElement;
  const click = async (name: string) => {
    button(name).click();
    await fixture.whenStable();
  };
  const blocks = () => fixture.componentInstance.value() as BlockNode[];
  const rows = () => [...el.querySelectorAll(':scope > fieldset > ol > li .fw-semibold')].map((s) => s.textContent);
  return { fixture, el, context, button, click, blocks, rows };
}

describe('BlocksField', () => {
  it('adds a block with a fresh _uid and its defaults, opens it and focuses its first field', async () => {
    const { el, click, blocks } = await render();
    expect(el.textContent).toContain('No blocks yet.');
    expect([...el.querySelectorAll('select option')].map((o) => o.textContent)).toEqual(['Hero', 'Columns']);

    await click('Add block to Content');
    await new Promise((resolve) => setTimeout(resolve));

    expect(blocks()).toEqual([{ _uid: expect.stringMatching(/^[0-9a-f-]{36}$/), _block: 'hero', dark: false }]);
    expect(el.querySelector('[aria-expanded=true]')?.textContent).toContain('Edit Hero block 1');
    expect(document.activeElement?.closest('label, div')?.textContent).toContain('Heading');
    expect(el.querySelector('[role=status]')?.textContent).toBe('Added a Hero block at position 1 of 1. Its fields are open.');
  });

  it('edits a block\'s fields without losing its _uid', async () => {
    const { fixture, el, click, blocks } = await render([node('a', 'One')]);
    await click('Edit Hero block 1');
    const input = el.querySelector<HTMLInputElement>('section input[type=text]') as HTMLInputElement;
    input.value = 'Changed';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(blocks()).toEqual([{ _uid: 'a', _block: 'hero', heading: 'Changed' }]);
  });

  it('reorders with the arrow buttons, keeping focus on a usable button, and announces it', async () => {
    const { el, click, blocks, rows, button } = await render([node('a', 'One'), node('b', 'Two'), node('c', 'Three')]);
    expect(rows()).toEqual(['Hero', 'Hero', 'Hero']);

    await click('Move Hero block 3 up');
    expect(blocks().map((b) => b._uid)).toEqual(['a', 'c', 'b']);
    await click('Move Hero block 2 up');
    await new Promise((resolve) => setTimeout(resolve));
    expect(blocks().map((b) => b._uid)).toEqual(['c', 'a', 'b']);
    expect(el.querySelector('[role=status]')?.textContent).toBe('Hero block moved to position 1 of 3.');
    expect(button('Move Hero block 1 up').disabled).toBe(true);
    expect(document.activeElement).toBe(button('Move Hero block 1 down'));
  });

  it('removes a block', async () => {
    const { click, blocks, el } = await render([node('a', 'One'), node('b', 'Two')]);
    await click('Remove Hero block 1');
    expect(blocks().map((b) => b._uid)).toEqual(['b']);
    expect(el.querySelector('[role=status]')?.textContent).toBe('Removed the Hero block.');
  });

  it('shows a summary, and flags blocks with errors inside them', async () => {
    const { fixture, el, context } = await render([node('a', 'Welcome to the site')]);
    expect(el.textContent).toContain('Welcome to the site');
    context.errors.set({ 'body.0.heading': ['Too long.'] });
    await fixture.whenStable();
    expect(el.textContent).toContain('Needs attention');
  });

  it('nests the blocks a block type allows as children', async () => {
    const { fixture, el, click, blocks } = await render([{ _uid: 'p', _block: 'columns' }]);
    await click('Edit Columns block 1');
    const nested = el.querySelector('section fieldset legend');
    expect(nested?.textContent).toContain('Blocks inside Columns');
    expect([...el.querySelectorAll('section select option')].map((o) => o.textContent)).toEqual(['Hero']);

    await click('Add block to Blocks inside Columns');
    await fixture.whenStable();
    expect(blocks()).toEqual([{ _uid: 'p', _block: 'columns', children: [expect.objectContaining({ _block: 'hero' })] }]);
  });

  it('only shows blocks when read-only', async () => {
    const { fixture, el, context } = await render([node('a', 'One')]);
    context.readonly.set(true);
    await fixture.whenStable();
    const names = [...el.querySelectorAll('button')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(names).toEqual(['View Hero block 1']);
    expect(el.querySelector('select')).toBeNull();
  });
});
