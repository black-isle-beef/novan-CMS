import { Injectable } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '@novan/api-common';
import type { AuthUser, SpaceAccess } from '@novan/api-auth';
import {
  assetUsages,
  contentTypes,
  DbService,
  type DbTransaction,
  entries,
  entryVersions,
  folders,
  profiles,
  publishedContent,
  recordAudit,
  spaces,
} from '@novan/api-db';
import {
  type autosaveEntryRequestSchema,
  type ContentTypeKind,
  type createEntryRequestSchema,
  diffEntryData,
  type Entry,
  type EntryData,
  type EntryDiff,
  type EntryStatus,
  type EntrySummary,
  type EntryVersion,
  entryTitle,
  type listEntriesQuerySchema,
  type MediaRef,
  mediaRefs,
  type moveEntryRequestSchema,
  slugify,
  type updateEntryRequestSchema,
} from '@novan/shared-schemas';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { canPublish } from './content-access';
import { contentProblem } from './content-errors';
import { type ContentEvent, ContentEvents } from './content-events';
import {
  contentTypeByApiId,
  contentTypeById,
  type EntryModel,
  environmentId,
  hasSlugField,
  loadAssets,
  loadModel,
  slugInData,
  validateData,
} from './entry-model';
import { cacheTags, entryPath, lastSegment } from './paths';

type ListQuery = z.output<typeof listEntriesQuerySchema>;
type CreateBody = z.output<typeof createEntryRequestSchema>;
type UpdateBody = z.output<typeof updateEntryRequestSchema>;
type AutosaveBody = z.output<typeof autosaveEntryRequestSchema>;
type MoveBody = z.output<typeof moveEntryRequestSchema>;

type EntryRow = typeof entries.$inferSelect;

/** How long autosave keeps overwriting its own version before starting a new one (see 0006_entries.sql). */
const AUTOSAVE_WINDOW_MS = 2 * 60 * 1000;

/** Title shown in lists: the current version's `title` or `name`, else the slug (as `entryTitle`). */
const titleSql = sql<string>`coalesce(
  nullif(btrim(${entryVersions.data} ->> 'title'), ''),
  nullif(btrim(${entryVersions.data} ->> 'name'), ''),
  ${entries.slug}
)`;

const summaryColumns = {
  entry: entries,
  contentType: { apiId: contentTypes.apiId, name: contentTypes.name, kind: contentTypes.kind },
  folderPath: folders.path,
  title: titleSql,
};

/**
 * Entries of an environment and their versions. Every query runs as the caller under RLS
 * (`DbService.userDb`). Saving creates a new immutable version and points the entry at it; publishing
 * and restoring only move pointers and copy the version into `published_content`. Publish, unpublish,
 * restore, bin and move are audited in the same transaction; publish and unpublish are announced on
 * {@link ContentEvents} once committed.
 */
@Injectable()
export class EntriesService {
  constructor(
    private readonly db: DbService,
    private readonly events: ContentEvents,
  ) {}

  list(user: AuthUser, spaceId: string, env: string, query: ListQuery): Promise<EntrySummary[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const filters: (SQL | undefined)[] = [
        eq(entries.environmentId, envId),
        query.deleted ? isNotNull(entries.deletedAt) : isNull(entries.deletedAt),
        query.contentType ? eq(contentTypes.apiId, query.contentType) : undefined,
        query.folderId === 'root' ? isNull(entries.folderId) : query.folderId ? eq(entries.folderId, query.folderId) : undefined,
      ];
      if (query.search) {
        const pattern = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        filters.push(or(ilike(titleSql, pattern), ilike(entries.slug, pattern)));
      }
      const rows = await tx
        .select(summaryColumns)
        .from(entries)
        .innerJoin(contentTypes, eq(contentTypes.id, entries.contentTypeId))
        .innerJoin(entryVersions, eq(entryVersions.id, entries.currentVersionId))
        .leftJoin(folders, eq(folders.id, entries.folderId))
        .where(and(...filters))
        .orderBy(asc(folders.path), asc(entries.slug));
      return rows.map(toSummary);
    });
  }

  get(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      return readEntry(tx, envId, id);
    });
  }

  async create(user: AuthUser, spaceId: string, env: string, body: CreateBody): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const type = contentTypeByApiId(model, body.contentType);
        if (body.folderId) await folderPath(tx, model.environmentId, body.folderId);

        // The slug comes from the data's slug field, else the request, else the title.
        const slug = slugInData(type, body.data) ?? body.slug ?? (slugify(entryTitle(body.data, '')) || null);
        if (!slug) throw badRequest('slug_required', 'Give it a title or a slug, so it has an address.');
        const input = hasSlugField(type) ? { ...body.data, slug } : body.data;
        const data = validateData(model, type, input, 'draft', await loadAssets(tx, spaceId, model, type, input));

        const [{ locale }] = await tx.select({ locale: spaces.defaultLocale }).from(spaces).where(eq(spaces.id, spaceId));
        const [entry] = await tx
          .insert(entries)
          .values({
            spaceId,
            environmentId: model.environmentId,
            contentTypeId: type.id,
            folderId: body.folderId ?? null,
            slug,
            locale,
            createdBy: user.id,
          })
          .returning();
        await saveVersion(tx, entry, user, data, { message: body.message ?? null, autosave: false, slug });
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.created',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, contentType: type.apiId, slug },
        });
        return readEntry(tx, model.environmentId, entry.id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Saves the data as a new version and makes it the current one. */
  async update(user: AuthUser, spaceId: string, env: string, id: string, body: UpdateBody): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        const type = contentTypeById(model, entry.contentTypeId);
        const data = validateData(model, type, body.data, 'draft', await loadAssets(tx, spaceId, model, type, body.data));
        await saveVersion(tx, entry, user, data, {
          message: body.message ?? null,
          autosave: false,
          slug: slugInData(type, data) ?? entry.slug,
        });
        return readEntry(tx, model.environmentId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /**
   * Overwrites the caller's own autosave when it is the current, unpublished version and less than two
   * minutes old; otherwise saves a new autosave version. Keeps autosave from creating a version every
   * few seconds.
   */
  async autosave(user: AuthUser, spaceId: string, env: string, id: string, body: AutosaveBody): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        const type = contentTypeById(model, entry.contentTypeId);
        const data = validateData(model, type, body.data, 'draft', await loadAssets(tx, spaceId, model, type, body.data));
        const slug = slugInData(type, data) ?? entry.slug;

        const [current] = await tx.select().from(entryVersions).where(eq(entryVersions.id, entry.currentVersionId as string));
        const overwrite =
          current.autosave &&
          current.createdBy === user.id &&
          current.id !== entry.publishedVersionId &&
          Date.now() - Date.parse(current.createdAt) < AUTOSAVE_WINDOW_MS;
        // The database applies the same window (now() is the transaction's start), so a version that
        // just aged out is not overwritten.
        const overwritten = overwrite
          ? await tx
              .update(entryVersions)
              .set({ data })
              .where(and(eq(entryVersions.id, current.id), sql`${entryVersions.createdAt} > now() - interval '2 minutes'`))
              .returning({ id: entryVersions.id })
          : [];

        if (overwritten.length) {
          await tx.update(entries).set({ slug }).where(eq(entries.id, entry.id));
        } else {
          await saveVersion(tx, entry, user, data, { message: null, autosave: true, slug });
        }
        return readEntry(tx, model.environmentId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Validates the current version in full, copies it into `published_content` and points `published_version_id` at it. */
  async publish(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    let event: ContentEvent | null = null;
    try {
      const result = await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        const type = contentTypeById(model, entry.contentTypeId);
        const versionId = entry.currentVersionId as string;
        const [version] = await tx.select({ data: entryVersions.data }).from(entryVersions).where(eq(entryVersions.id, versionId));
        const data = validateData(model, type, version.data, 'publish', await loadAssets(tx, spaceId, model, type, version.data));

        const path = entryPath(entry.folderId ? await folderPath(tx, model.environmentId, entry.folderId) : null, entry.slug);
        const tags = cacheTags({ id: entry.id, contentType: type.apiId, path });
        // now() is the transaction's start, so both rows get the same time.
        const published = {
          spaceId,
          environmentId: model.environmentId,
          contentTypeApiId: type.apiId,
          fullPath: path,
          locale: entry.locale,
          data,
          publishedAt: sql`now()`,
          cacheTags: tags,
        };
        await tx
          .insert(publishedContent)
          .values({ entryId: entry.id, ...published })
          .onConflictDoUpdate({ target: publishedContent.entryId, set: published });
        await tx
          .update(entries)
          .set({ status: 'published', publishedVersionId: versionId, publishedAt: sql`now()` })
          .where(eq(entries.id, entry.id));
        await recordUsages(tx, entry, mediaRefs(type.fields, data, model.blockTypes));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.published',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, versionId, path, ...(entry.publishedVersionId ? { previousVersionId: entry.publishedVersionId } : {}) },
        });

        const saved = await readEntry(tx, model.environmentId, id);
        event = {
          type: 'entry.published',
          spaceId,
          environmentId: model.environmentId,
          entryId: entry.id,
          contentType: type.apiId,
          locale: entry.locale,
          path,
          cacheTags: tags,
          actorId: user.id,
          versionId,
          publishedAt: saved.publishedAt as string,
        };
        return saved;
      });
      this.emit(event);
      return result;
    } catch (error) {
      throw contentProblem(error);
    }
  }

  async unpublish(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    let event: ContentEvent | null = null;
    try {
      const result = await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        if (!entry.publishedVersionId) throw conflict('not_published', 'This is not published.');

        event = await takeOffline(tx, model, entry, user);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.unpublished',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, versionId: entry.publishedVersionId, path: event.path },
        });
        return readEntry(tx, model.environmentId, id);
      });
      this.emit(event);
      return result;
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Makes an earlier version the current one again. It is checked against today's content model first. */
  async restoreVersion(user: AuthUser, spaceId: string, env: string, id: string, versionId: string): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        const [version] = await tx
          .select({ id: entryVersions.id, data: entryVersions.data })
          .from(entryVersions)
          .where(and(eq(entryVersions.id, versionId), eq(entryVersions.entryId, entry.id)));
        if (!version) throw notFound('version_not_found', 'This version does not belong to this entry.');
        if (version.id === entry.currentVersionId) return readEntry(tx, model.environmentId, id);

        const type = contentTypeById(model, entry.contentTypeId);
        const data = validateData(model, type, version.data, 'draft', await loadAssets(tx, spaceId, model, type, version.data));
        await tx
          .update(entries)
          .set({ currentVersionId: version.id, slug: slugInData(type, data) ?? entry.slug })
          .where(eq(entries.id, entry.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.version_restored',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, versionId: version.id, previousVersionId: entry.currentVersionId },
        });
        return readEntry(tx, model.environmentId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Moves the entry to the bin, taking it off the site first if it is published. */
  async remove(user: AuthUser, spaceId: string, env: string, id: string): Promise<void> {
    let event: ContentEvent | null = null;
    try {
      await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        if (entry.publishedVersionId) event = await takeOffline(tx, model, entry, user);
        await tx.update(entries).set({ deletedAt: sql`now()` }).where(eq(entries.id, entry.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.deleted',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, slug: entry.slug, wasPublished: Boolean(entry.publishedVersionId) },
        });
      });
      this.emit(event);
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Takes the entry out of the bin, as a draft. */
  async restore(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const entry = await findEntry(tx, envId, id);
        if (!entry.deletedAt) throw conflict('entry_not_deleted', 'This is not in the bin.');
        await tx.update(entries).set({ deletedAt: null }).where(eq(entries.id, entry.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.restored',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, slug: entry.slug },
        });
        return readEntry(tx, envId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Moves the entry to another folder. A published entry's address moves straight away, so that needs an editor. */
  async move(user: AuthUser, space: SpaceAccess, env: string, id: string, body: MoveBody): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, space.id, env);
        const entry = await liveEntry(tx, envId, id);
        if (entry.publishedVersionId && !canPublish(user, space)) {
          throw forbidden('insufficient_role', 'Moving a published page changes its address, so it needs an editor.');
        }
        if (entry.folderId === body.folderId) return readEntry(tx, envId, id);

        const target = body.folderId ? await folderPath(tx, envId, body.folderId) : null;
        await tx.update(entries).set({ folderId: body.folderId }).where(eq(entries.id, entry.id));

        let path: string | null = null;
        if (entry.publishedVersionId) {
          const [published] = await tx
            .select({ fullPath: publishedContent.fullPath })
            .from(publishedContent)
            .where(eq(publishedContent.entryId, entry.id));
          // The published slug can differ from a newer draft's, so keep it.
          path = entryPath(target, lastSegment(published.fullPath));
          await tx.update(publishedContent).set({ fullPath: path }).where(eq(publishedContent.entryId, entry.id));
        }
        await recordAudit(tx, {
          spaceId: space.id,
          actorId: user.id,
          action: 'entry.moved',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, fromFolderId: entry.folderId, toFolderId: body.folderId, ...(path ? { publishedPath: path } : {}) },
        });
        return readEntry(tx, envId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Newest first, with who saved each and whether it is the current or published one. */
  versions(user: AuthUser, spaceId: string, env: string, id: string): Promise<EntryVersion[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const entry = await findEntry(tx, envId, id);
      const rows = await tx
        .select({ version: entryVersions, createdByName: profiles.displayName })
        .from(entryVersions)
        .leftJoin(profiles, eq(profiles.userId, entryVersions.createdBy))
        .where(eq(entryVersions.entryId, entry.id))
        .orderBy(desc(entryVersions.createdAt), desc(entryVersions.id));
      return rows.map(({ version, createdByName }) => ({
        id: version.id,
        entryId: version.entryId,
        message: version.message,
        autosave: version.autosave,
        createdBy: version.createdBy,
        createdByName,
        createdAt: version.createdAt,
        current: version.id === entry.currentVersionId,
        published: version.id === entry.publishedVersionId,
      }));
    });
  }

  /** What changed from version `from` to version `to` of the same entry, with blocks matched by `_uid`. */
  diff(user: AuthUser, spaceId: string, env: string, from: string, to: string): Promise<EntryDiff> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const rows = await tx
        .select({ id: entryVersions.id, entryId: entryVersions.entryId, data: entryVersions.data })
        .from(entryVersions)
        .innerJoin(entries, eq(entries.id, entryVersions.entryId))
        .where(and(inArray(entryVersions.id, [from, to]), eq(entries.environmentId, envId)));
      const before = rows.find((row) => row.id === from);
      const after = rows.find((row) => row.id === to);
      if (!before || !after) throw notFound('version_not_found', 'One of these versions does not exist here.');
      if (before.entryId !== after.entryId) throw badRequest('versions_differ', 'Both versions must belong to the same entry.');
      return { from, to, changes: diffEntryData(before.data as EntryData, after.data as EntryData) };
    });
  }

  private emit(event: ContentEvent | null): void {
    if (event) this.events.emit(event);
  }
}

// --- Helpers -------------------------------------------------------------------------------------

/** Inserts a version and points the entry at it (and at the slug its data holds). */
async function saveVersion(
  tx: DbTransaction,
  entry: EntryRow,
  user: AuthUser,
  data: EntryData,
  options: { message: string | null; autosave: boolean; slug: string },
): Promise<void> {
  const [version] = await tx
    .insert(entryVersions)
    .values({ entryId: entry.id, spaceId: entry.spaceId, data, message: options.message, autosave: options.autosave, createdBy: user.id })
    .returning({ id: entryVersions.id });
  await tx.update(entries).set({ currentVersionId: version.id, slug: options.slug }).where(eq(entries.id, entry.id));
}

/** Records which files the published version uses (the library's "in use" warning and the image route read it). */
async function recordUsages(tx: DbTransaction, entry: EntryRow, refs: readonly MediaRef[]): Promise<void> {
  await tx.delete(assetUsages).where(eq(assetUsages.entryId, entry.id));
  if (!refs.length) return;
  await tx
    .insert(assetUsages)
    .values(refs.map((ref) => ({ assetId: ref.assetId, entryId: entry.id, spaceId: entry.spaceId, fieldPath: ref.path })))
    .onConflictDoNothing();
}

/**
 * Removes the published copy and its record of files used, and marks the entry as a draft; returns the
 * event to announce after commit.
 */
async function takeOffline(tx: DbTransaction, model: EntryModel, entry: EntryRow, user: AuthUser): Promise<ContentEvent> {
  const [removed] = await tx
    .delete(publishedContent)
    .where(eq(publishedContent.entryId, entry.id))
    .returning({ fullPath: publishedContent.fullPath, cacheTags: publishedContent.cacheTags });
  await tx.delete(assetUsages).where(eq(assetUsages.entryId, entry.id));
  await tx
    .update(entries)
    .set({ status: 'draft', publishedVersionId: null, publishedAt: null })
    .where(eq(entries.id, entry.id));
  const type = contentTypeById(model, entry.contentTypeId);
  const path = removed?.fullPath ?? '';
  return {
    type: 'entry.unpublished',
    spaceId: entry.spaceId,
    environmentId: entry.environmentId,
    entryId: entry.id,
    contentType: type.apiId,
    locale: entry.locale,
    path,
    cacheTags: removed?.cacheTags ?? cacheTags({ id: entry.id, contentType: type.apiId, path }),
    actorId: user.id,
  };
}

async function findEntry(tx: DbTransaction, envId: string, id: string): Promise<EntryRow> {
  const [entry] = await tx
    .select()
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.environmentId, envId)));
  if (!entry) throw notFound('entry_not_found', 'There is no such page or entry here.');
  return entry;
}

/** An entry that is not in the bin. */
async function liveEntry(tx: DbTransaction, envId: string, id: string): Promise<EntryRow> {
  const entry = await findEntry(tx, envId, id);
  if (entry.deletedAt) throw conflict('entry_deleted', 'This is in the bin. Restore it first.');
  return entry;
}

async function folderPath(tx: DbTransaction, envId: string, folderId: string): Promise<string> {
  const [folder] = await tx
    .select({ path: folders.path })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.environmentId, envId)));
  if (!folder) throw badRequest('folder_not_found', 'That folder does not exist here.');
  return folder.path;
}

async function readEntry(tx: DbTransaction, envId: string, id: string): Promise<Entry> {
  const [row] = await tx
    .select({ ...summaryColumns, data: entryVersions.data, publishedPath: publishedContent.fullPath })
    .from(entries)
    .innerJoin(contentTypes, eq(contentTypes.id, entries.contentTypeId))
    .innerJoin(entryVersions, eq(entryVersions.id, entries.currentVersionId))
    .leftJoin(folders, eq(folders.id, entries.folderId))
    .leftJoin(publishedContent, eq(publishedContent.entryId, entries.id))
    .where(and(eq(entries.id, id), eq(entries.environmentId, envId)));
  if (!row) throw notFound('entry_not_found', 'There is no such page or entry here.');
  return {
    ...toSummary(row),
    data: row.data as EntryData,
    currentVersionId: row.entry.currentVersionId as string,
    publishedVersionId: row.entry.publishedVersionId,
    publishedPath: row.publishedPath,
  };
}

interface SummaryRow {
  entry: EntryRow;
  contentType: { apiId: string; name: string; kind: string };
  folderPath: string | null;
  title: string;
}

function toSummary({ entry, contentType, folderPath: path, title }: SummaryRow): EntrySummary {
  return {
    id: entry.id,
    contentType: contentType.apiId,
    contentTypeName: contentType.name,
    kind: contentType.kind as ContentTypeKind,
    folderId: entry.folderId,
    slug: entry.slug,
    path: entryPath(path, entry.slug),
    locale: entry.locale,
    title,
    status: entry.status as EntryStatus,
    hasUnpublishedChanges: entry.publishedVersionId !== null && entry.publishedVersionId !== entry.currentVersionId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    publishedAt: entry.publishedAt,
    deletedAt: entry.deletedAt,
  };
}
