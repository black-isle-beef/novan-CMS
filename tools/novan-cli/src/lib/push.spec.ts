import { planBlockSync } from './blocks';
import { diffSchemas } from '@novan/schema-sync';
import { fakeApi, target } from './fake-api';
import { applyChanges } from '@novan/schema-sync';
import { type SchemaSet, toBlockTypeFile, toContentTypeFile } from './schema-files';

const text = (apiId: string) => ({ id: apiId, apiId, label: apiId, type: 'text' });
const blocks = (apiId: string, allowedBlocks: string[]) => ({ id: apiId, apiId, label: apiId, type: 'blocks', allowedBlocks });
const block = (apiId: string, fields: object[] = [text('heading')], allowedChildren: string[] = []) => toBlockTypeFile({ apiId, name: apiId, fields, allowedChildren });
const page = (fields: object[]) => toContentTypeFile({ apiId: 'page', name: 'Page', kind: 'page', fields });

async function push(local: SchemaSet, remote: SchemaSet, options: { force?: boolean; dryRun?: boolean } = {}) {
  const { api, state } = fakeApi(structuredClone(remote));
  const lines: string[] = [];
  await applyChanges(api, target, local, remote, diffSchemas(local, remote), { force: false, dryRun: false, log: (line) => lines.push(line), ...options });
  return { state, lines };
}

describe('applyChanges', () => {
  it('creates block types before the content types that allow them', async () => {
    const local = { contentTypes: [page([text('title'), blocks('body', ['hero'])])], blockTypes: [block('hero')] };
    const { state } = await push(local, { contentTypes: [], blockTypes: [] });

    expect(state.calls).toEqual(['create blockType hero', 'create contentType page']);
    expect(diffSchemas(local, state)).toEqual([]);
  });

  it('creates blocks that allow each other empty, then fills them in', async () => {
    const local = { contentTypes: [], blockTypes: [block('columns', [text('a')], ['column']), block('column', [text('b')], ['columns'])] };
    const { state } = await push(local, { contentTypes: [], blockTypes: [] });

    expect(state.calls).toEqual(['create blockType columns (empty)', 'create blockType column', 'update blockType columns']);
    expect(diffSchemas(local, state)).toEqual([]);
  });

  it('refuses destructive changes without --force, before changing anything', async () => {
    const remote = { contentTypes: [page([text('title'), text('old')])], blockTypes: [block('hero')] };
    const local = { contentTypes: [page([text('title')]), toContentTypeFile({ apiId: 'post', name: 'Post', kind: 'page', fields: [] })], blockTypes: [block('hero')] };

    await expect(push(local, remote)).rejects.toThrow(/fields\.old removed[\s\S]*Nothing was changed/);
  });

  it('applies destructive changes with --force, removing what still allows a block first', async () => {
    const remote = { contentTypes: [page([blocks('body', ['hero', 'old'])])], blockTypes: [block('hero'), block('old')] };
    const local = { contentTypes: [page([blocks('body', ['hero'])])], blockTypes: [block('hero')] };
    const { state } = await push(local, remote, { force: true });

    expect(state.calls).toEqual(['update contentType page (force)', 'delete blockType old']);
  });

  it('changes nothing on a dry run', async () => {
    const { state, lines } = await push({ contentTypes: [], blockTypes: [block('hero')] }, { contentTypes: [], blockTypes: [] }, { dryRun: true });

    expect(state.calls).toEqual([]);
    expect(lines).toEqual(['Dry run: nothing was changed.']);
  });
});

describe('planBlockSync', () => {
  const manifest = [block('hero', [text('heading'), text('subheading')]), block('listing')];
  const remote = { contentTypes: [], blockTypes: [block('hero')] };

  it('updates only the blocks the space has, and says which it left out', () => {
    const plan = planBlockSync(manifest, remote, []);

    expect(plan.changes.map((c) => `${c.action} ${c.apiId}`)).toEqual(['update hero']);
    expect(plan.skipped).toEqual(['listing']);
  });

  it('adds blocks named on the command line', () => {
    expect(planBlockSync(manifest, remote, ['listing']).changes.map((c) => `${c.action} ${c.apiId}`)).toEqual(['create listing']);
  });

  it('never deletes block types the manifest lacks', () => {
    const plan = planBlockSync(manifest, { contentTypes: [], blockTypes: [block('hero'), block('custom')] }, []);

    expect(plan.changes.some((c) => c.action === 'delete')).toBe(false);
  });

  it('refuses a block the manifest does not have', () => {
    expect(() => planBlockSync(manifest, remote, ['carousel'])).toThrow('@novan/blocks has no block carousel');
  });
});
