import type { FieldDef } from '@novan/shared-schemas';
import { randomUUID } from 'node:crypto';
import type { NovanApi, Target } from './api';
import { ApiError, CliError } from './errors';
import type { SeedFile } from './kits';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isRef = (value: unknown): value is { $entry: string } => isObject(value) && typeof value['$entry'] === 'string';

/**
 * Seed data as the API stores it: each translated field's value becomes `{ "<locale>": value }`, inside groups and
 * blocks too (block fields from `blockTypes`), and every block gets a `_uid`. Values already in a locale map, and
 * fields the content type does not have, are left as they are.
 */
export function toStoredData(fields: readonly FieldDef[], data: Json, blockTypes: ReadonlyMap<string, readonly FieldDef[]>, locale: string): Json {
  const out: Json = { ...data };
  for (const field of fields) {
    const value = data[field.apiId];
    if (value === undefined || value === null) continue;
    if (field.type === 'group') {
      out[field.apiId] = Array.isArray(value)
        ? value.map((item) => (isObject(item) ? toStoredData(field.fields, item, blockTypes, locale) : item))
        : isObject(value)
          ? toStoredData(field.fields, value, blockTypes, locale)
          : value;
    } else if (field.type === 'blocks') {
      out[field.apiId] = Array.isArray(value) ? value.map((node) => storedBlock(node, blockTypes, locale)) : value;
    } else if (field.localised && !(isObject(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => /^[a-z]{2,3}(-[A-Z]{2})?$/.test(key)))) {
      out[field.apiId] = { [locale]: value };
    }
  }
  return out;
}

function storedBlock(node: unknown, blockTypes: ReadonlyMap<string, readonly FieldDef[]>, locale: string): unknown {
  if (!isObject(node) || typeof node['_block'] !== 'string') return node;
  const fields = blockTypes.get(node['_block']);
  const block: Json = { _uid: randomUUID(), ...(fields ? toStoredData(fields, node, blockTypes, locale) : node) };
  if (Array.isArray(node['children'])) block['children'] = node['children'].map((child) => storedBlock(child, blockTypes, locale));
  return block;
}

/** The object that directly holds a reference to a seed entry not created yet: it is left out (null) until then. */
const UNRESOLVED = Symbol('unresolved');

/**
 * Replaces each `{ "$entry": "<key>" }` with that entry's id. A key not in `ids` is an error, unless `pending` names
 * it: then the object holding the reference (e.g. the internal link) becomes null, to be filled in once it exists.
 * Answers whether anything was left out.
 */
export function resolveRefs(value: unknown, ids: ReadonlyMap<string, string>, pending: ReadonlySet<string>): { value: unknown; partial: boolean } {
  let partial = false;
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map((child) => nullIfUnresolved(walk(child)));
    if (!isObject(item)) return item;
    const out: Json = {};
    for (const [key, child] of Object.entries(item)) {
      if (isRef(child)) {
        const id = ids.get(child.$entry);
        if (id) {
          out[key] = id;
          continue;
        }
        if (!pending.has(child.$entry)) throw new CliError(`The seed points at "${child.$entry}", which is not one of its entries.`);
        partial = true;
        return UNRESOLVED;
      }
      out[key] = nullIfUnresolved(walk(child));
    }
    return out;
  };
  const nullIfUnresolved = (item: unknown) => (item === UNRESOLVED ? null : item);
  return { value: nullIfUnresolved(walk(value)), partial };
}

export interface SeedOptions {
  /** Publish the entries the seed marks for publishing (all, by default). */
  publish: boolean;
  /** The saved version's message, e.g. "Seeded from the blog kit". */
  message: string;
  log: (line: string) => void;
}

export interface SeedResult {
  created: number;
  published: number;
  skipped: number;
}

/**
 * Creates the seed's folders and entries in the space and publishes them. Entries are created first (links to
 * entries not made yet left out), then given their links, then published, so pages can link to each other in any
 * order. An entry whose address is taken (same content type, folder and slug) is left alone, so seeding again only
 * adds what is missing.
 */
export async function seed(api: NovanApi, target: Target, file: SeedFile, options: SeedOptions): Promise<SeedResult> {
  const [contentTypes, blockTypes, locales, folders, existing] = await Promise.all([
    api.contentTypes(target),
    api.blockTypes(target),
    api.locales(target.spaceId),
    api.folders(target),
    api.entries(target),
  ]);
  const locale = locales.locales.find((candidate) => candidate.isDefault)?.code ?? 'en-GB';
  const typeFields = new Map(contentTypes.map((type) => [type.apiId, type.fields]));
  const blockFields = new Map(blockTypes.map((type) => [type.apiId, type.fields]));
  const missingTypes = [...new Set(file.entries.map((entry) => entry.contentType))].filter((apiId) => !typeFields.has(apiId));
  if (missingTypes.length) throw new CliError(`The space has no content type ${missingTypes.join(', ')}. Run novan schema push first.`);

  // Folders, parents first (a seed lists them in that order).
  const folderIds = new Map<string, string>();
  for (const folder of file.folders ?? []) {
    const parentId = folder.parent ? folderIds.get(folder.parent) : null;
    if (folder.parent && !parentId) throw new CliError(`Folder "${folder.key}" is in "${folder.parent}", which the seed lists after it or not at all.`);
    const found = folders.find((candidate) => candidate.slug === folder.slug && candidate.parentId === (parentId ?? null));
    const id = found?.id ?? (await api.createFolder(target, { name: folder.name, slug: folder.slug, parentId: parentId ?? null })).id;
    if (!found) options.log(`Created folder ${folder.slug}.`);
    folderIds.set(folder.key, id);
  }

  const ids = new Map<string, string>();
  const created: { key: string; id: string; publish: boolean; partial: boolean }[] = [];
  let skipped = 0;
  const keys = new Set(file.entries.map((entry) => entry.key));

  // 1. Create: each entry with links to entries not created yet left out.
  for (const entry of file.entries) {
    const folderId = entry.folder ? folderIds.get(entry.folder) : null;
    if (entry.folder && !folderId) throw new CliError(`Entry "${entry.key}" is in folder "${entry.folder}", which the seed does not list.`);
    const taken = existing.find((e) => e.contentType === entry.contentType && e.slug === entry.slug && e.folderId === (folderId ?? null) && !e.deletedAt);
    if (taken) {
      ids.set(entry.key, taken.id);
      skipped++;
      options.log(`Kept ${taken.path}: it already exists.`);
      continue;
    }
    const pending = new Set([...keys].filter((key) => !ids.has(key)));
    const { value, partial } = resolveRefs(entry.data, ids, pending);
    const data = toStoredData(typeFields.get(entry.contentType) ?? [], value as Json, blockFields, locale);
    const made = await describeFailure(entry.key, () =>
      api.createEntry(target, { contentType: entry.contentType, slug: entry.slug, folderId: folderId ?? null, data, message: options.message }),
    );
    ids.set(entry.key, made.id);
    created.push({ key: entry.key, id: made.id, publish: entry.publish !== false, partial });
    options.log(`Created ${made.path}.`);
  }

  // 2. Fill in the links left out.
  for (const item of created.filter((c) => c.partial)) {
    const entry = file.entries.find((e) => e.key === item.key);
    if (!entry) continue;
    const { value } = resolveRefs(entry.data, ids, new Set());
    const data = toStoredData(typeFields.get(entry.contentType) ?? [], value as Json, blockFields, locale);
    await describeFailure(entry.key, () => api.updateEntry(target, item.id, data, options.message));
  }

  // 3. Publish.
  let published = 0;
  if (options.publish) {
    for (const item of created.filter((c) => c.publish)) {
      const entry = await describeFailure(item.key, () => api.publishEntry(target, item.id, options.message));
      published++;
      options.log(`Published ${entry.publishedPath ?? entry.path}.`);
    }
  }
  return { created: created.length, published, skipped };
}

async function describeFailure<T>(key: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) throw new CliError(`Seed entry "${key}": ${error.message}`);
    throw error;
  }
}
