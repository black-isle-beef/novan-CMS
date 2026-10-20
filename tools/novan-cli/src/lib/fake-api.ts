// A stand-in for the Novan API in the CLI's specs: an in-memory content model and entries, with the API's checks
// that matter to the CLI (references must exist; a type in use cannot be deleted).
import type { BlockType, ContentType, Entry, EntrySummary, Folder } from '@novan/shared-schemas';
import { randomUUID } from 'node:crypto';
import type { NovanApi, Target } from './api';
import { ApiError } from './errors';
import { referencesOf } from '@novan/schema-sync';
import { type BlockTypeFile, type ContentTypeFile, toBlockTypeFile, toContentTypeFile } from './schema-files';

export interface FakeState {
  contentTypes: ContentTypeFile[];
  blockTypes: BlockTypeFile[];
  folders: Folder[];
  entries: (Entry & { published: boolean })[];
  calls: string[];
}

export const target: Target = { apiUrl: 'http://api.test', spaceId: '00000000-0000-4000-8000-000000000200', environment: 'main' };

const now = '2026-01-01T00:00:00Z';

export function fakeApi(initial: Partial<Pick<FakeState, 'contentTypes' | 'blockTypes'>> = {}): { api: NovanApi; state: FakeState } {
  const state: FakeState = { contentTypes: initial.contentTypes ?? [], blockTypes: initial.blockTypes ?? [], folders: [], entries: [], calls: [] };
  const missingRefs = (kind: 'contentType' | 'blockType', type: ContentTypeFile | BlockTypeFile) =>
    referencesOf(kind, type).filter((ref) =>
      ref.kind === 'contentType' ? !state.contentTypes.some((t) => t.apiId === ref.apiId) : !state.blockTypes.some((t) => t.apiId === ref.apiId),
    );
  const check = (kind: 'contentType' | 'blockType', type: ContentTypeFile | BlockTypeFile) => {
    const missing = missingRefs(kind, type).filter((ref) => !(ref.kind === kind && ref.apiId === type.apiId));
    if (missing.length) throw new ApiError(400, 'validation_failed', `Unknown ${missing.map((m) => m.apiId).join(', ')}`, {});
  };
  const remoteType = <T>(type: T) => ({ ...type, id: randomUUID(), spaceId: target.spaceId, environmentId: randomUUID(), createdAt: now, updatedAt: now, schemaVersion: 1 });
  const summary = (entry: Entry): EntrySummary => entry;

  const api = {
    apiUrl: target.apiUrl,
    contentTypes: async () => state.contentTypes.map(remoteType) as unknown as ContentType[],
    blockTypes: async () => state.blockTypes.map(remoteType) as unknown as BlockType[],
    createContentType: async (_t: Target, body: unknown) => {
      const type = toContentTypeFile(body);
      check('contentType', type);
      state.contentTypes.push(type);
      state.calls.push(`create contentType ${type.apiId}${type.fields.length ? '' : ' (empty)'}`);
      return remoteType(type);
    },
    createBlockType: async (_t: Target, body: unknown) => {
      const type = toBlockTypeFile(body);
      check('blockType', type);
      state.blockTypes.push(type);
      state.calls.push(`create blockType ${type.apiId}${type.fields.length ? '' : ' (empty)'}`);
      return remoteType(type);
    },
    updateContentType: async (_t: Target, apiId: string, body: object, force: boolean) => {
      const index = state.contentTypes.findIndex((t) => t.apiId === apiId);
      const type = toContentTypeFile({ ...state.contentTypes[index], ...body });
      check('contentType', type);
      state.contentTypes[index] = type;
      state.calls.push(`update contentType ${apiId}${force ? ' (force)' : ''}`);
      return remoteType(type);
    },
    updateBlockType: async (_t: Target, apiId: string, body: object, force: boolean) => {
      const index = state.blockTypes.findIndex((t) => t.apiId === apiId);
      const type = toBlockTypeFile({ ...state.blockTypes[index], ...body });
      check('blockType', type);
      state.blockTypes[index] = type;
      state.calls.push(`update blockType ${apiId}${force ? ' (force)' : ''}`);
      return remoteType(type);
    },
    deleteContentType: async (_t: Target, apiId: string) => {
      state.contentTypes = state.contentTypes.filter((t) => t.apiId !== apiId);
      state.calls.push(`delete contentType ${apiId}`);
    },
    deleteBlockType: async (_t: Target, apiId: string) => {
      const users = [...state.contentTypes.map((t) => ['contentType', t] as const), ...state.blockTypes.map((t) => ['blockType', t] as const)].filter(
        ([kind, t]) => t.apiId !== apiId && referencesOf(kind, t).some((ref) => ref.kind === 'blockType' && ref.apiId === apiId),
      );
      if (users.length) throw new ApiError(409, 'block_type_in_use', `${users.map(([, t]) => t.apiId).join(', ')} still allow this block.`, {});
      state.blockTypes = state.blockTypes.filter((t) => t.apiId !== apiId);
      state.calls.push(`delete blockType ${apiId}`);
    },
    locales: async () => ({ locales: [{ code: 'en-GB', name: 'English (UK)', fallback: null, isDefault: true, prefix: 'en-gb' }], prefixes: false, machineTranslation: false }),
    folders: async () => state.folders,
    createFolder: async (_t: Target, body: { name: string; slug: string; parentId?: string | null }) => {
      const folder: Folder = { id: randomUUID(), parentId: body.parentId ?? null, name: body.name, slug: body.slug, path: `/${body.slug}`, createdAt: now, updatedAt: now };
      state.folders.push(folder);
      return folder;
    },
    entries: async () => state.entries.map(summary),
    createEntry: async (_t: Target, body: { contentType: string; slug: string; folderId?: string | null; data: Record<string, unknown> }) => {
      const folder = state.folders.find((f) => f.id === body.folderId);
      const path = `${folder?.path ?? ''}/${body.slug}`;
      const id = randomUUID();
      const entry = {
        id,
        contentType: body.contentType,
        contentTypeName: body.contentType,
        kind: 'page',
        folderId: body.folderId ?? null,
        slug: body.slug,
        path,
        title: body.slug,
        missingTranslations: [],
        status: 'draft',
        hasUnpublishedChanges: false,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
        deletedAt: null,
        data: body.data,
        currentVersionId: randomUUID(),
        publishedVersionId: null,
        publishedPath: null,
        published: false,
      } as Entry & { published: boolean };
      state.entries.push(entry);
      state.calls.push(`create entry ${path}`);
      return entry;
    },
    updateEntry: async (_t: Target, id: string, data: Record<string, unknown>) => {
      const entry = state.entries.find((e) => e.id === id);
      if (!entry) throw new ApiError(404, 'entry_not_found', 'No such entry', {});
      entry.data = data;
      state.calls.push(`update entry ${entry.path}`);
      return entry;
    },
    publishEntry: async (_t: Target, id: string) => {
      const entry = state.entries.find((e) => e.id === id);
      if (!entry) throw new ApiError(404, 'entry_not_found', 'No such entry', {});
      entry.published = true;
      entry.publishedPath = entry.path;
      state.calls.push(`publish ${entry.path}`);
      return entry;
    },
  };
  return { api: api as unknown as NovanApi, state };
}
