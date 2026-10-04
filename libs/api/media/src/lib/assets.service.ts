import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '@novan/api-common';
import type { AuthUser } from '@novan/api-auth';
import {
  assets,
  assetUsages,
  DbService,
  type DbTransaction,
  organisations,
  profiles,
  publishedContent,
  recordAudit,
  spaces,
} from '@novan/api-db';
import {
  type Asset,
  type AssetDetail,
  type AssetFolderSummary,
  type AssetKind,
  type completeReplaceRequestSchema,
  type completeUploadRequestSchema,
  fileTypeOf,
  formatBytes,
  kindOfMime,
  type listAssetsQuerySchema,
  safeFilename,
  SVG_MIME,
  titleFromFilename,
  type updateAssetRequestSchema,
  uploadLimit,
  type UploadUrlRequest,
  type UploadUrlResponse,
} from '@novan/shared-schemas';
import {
  and,
  arrayContains,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  notLike,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import { type ExpectedType, inspectFile, type InspectedFile } from './file-inspector';
import { withMediaProblems } from './media-errors';
import { type MediaEvent, MediaEvents } from './media-events';
import { assetPath, MediaStorage, pendingPath } from './media-storage';

type ListQuery = z.output<typeof listAssetsQuerySchema>;
type CompleteBody = z.output<typeof completeUploadRequestSchema>;
type UpdateBody = z.output<typeof updateAssetRequestSchema>;
type ReplaceBody = z.output<typeof completeReplaceRequestSchema>;

type AssetRow = typeof assets.$inferSelect;

/** What the space allows: its organisation's plan sets the size limits, its settings may allow SVG. */
interface SpacePolicy {
  plan: string | null;
  allowSvg: boolean;
}

/** Published entries using the asset (several fields of one entry count once). */
const usageCountSql = sql<number>`(
  select count(distinct ${assetUsages.entryId})::int from ${assetUsages} where ${assetUsages.assetId} = ${assets.id}
)`;

const assetColumns = { asset: assets, uploadedByName: profiles.displayName, usageCount: usageCountSql };

/**
 * The media library of a space. Every query runs as the caller under RLS (`DbService.userDb`); files
 * go through {@link MediaStorage}. Uploads are two steps: the API signs an upload to a pending path,
 * then checks what arrived (type from the bytes, size against the plan, image dimensions, SVG
 * sanitised) before writing it into place and adding the row. Replacing works the same way and keeps
 * the asset id. Upload, replace, bin and restore are audited.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly db: DbService,
    private readonly storage: MediaStorage,
    private readonly events: MediaEvents,
  ) {}

  list(user: AuthUser, spaceId: string, query: ListQuery): Promise<Asset[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(assets.spaceId, spaceId),
        query.deleted ? isNotNull(assets.deletedAt) : isNull(assets.deletedAt),
        query.ids ? inArray(assets.id, query.ids) : undefined,
        query.tag ? arrayContains(assets.tags, [query.tag]) : undefined,
        query.kind ? kindFilter(query.kind) : undefined,
      ];
      if (query.folder === 'root') filters.push(isNull(assets.folder));
      else if (query.folder)
        filters.push(or(eq(assets.folder, query.folder), like(assets.folder, `${escapeLike(query.folder)}/%`)));
      if (query.search) {
        const pattern = `%${escapeLike(query.search)}%`;
        filters.push(
          or(
            ilike(assets.filename, pattern),
            ilike(assets.title, pattern),
            ilike(assets.alt, pattern),
            arrayContains(assets.tags, [query.search.toLowerCase()]),
          ),
        );
      }
      const rows = await tx
        .select(assetColumns)
        .from(assets)
        .leftJoin(profiles, eq(profiles.userId, assets.uploadedBy))
        .where(and(...filters))
        .orderBy(desc(assets.createdAt), desc(assets.id));
      return rows.map(toAsset);
    });
  }

  /** Folders in use, with how many live files each holds directly. */
  folders(user: AuthUser, spaceId: string): Promise<AssetFolderSummary[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const rows = await tx
        .select({ folder: assets.folder, count: sql<number>`count(*)::int` })
        .from(assets)
        .where(and(eq(assets.spaceId, spaceId), isNull(assets.deletedAt), isNotNull(assets.folder)))
        .groupBy(assets.folder)
        .orderBy(assets.folder);
      return rows.map((row) => ({ folder: row.folder as string, count: row.count }));
    });
  }

  get(user: AuthUser, spaceId: string, id: string): Promise<AssetDetail> {
    return this.db.userDb(user.claims, (tx) => readAsset(tx, spaceId, id));
  }

  /**
   * Checks the file's type and size against the plan and signs an upload for it. Nothing is stored
   * until {@link complete}. With `replacing`, the upload is a new file for that asset.
   */
  async uploadUrl(
    user: AuthUser,
    spaceId: string,
    body: UploadUrlRequest,
    replacing?: string,
  ): Promise<UploadUrlResponse> {
    const filename = safeFilename(body.filename);
    const { type, limit } = await this.db.userDb(user.claims, async (tx) => {
      const policy = await spacePolicy(tx, spaceId);
      const type = allowedType(filename, policy);
      if (replacing) sameKind(await liveAsset(tx, spaceId, replacing), type);
      return { type, limit: uploadLimit(policy.plan, type.kind) };
    });
    if (body.sizeBytes > limit) throw tooLarge(type.kind, limit);

    const assetId = replacing ?? randomUUID();
    const uploadUrl = await this.storage.signedUploadUrl(pendingPath(spaceId, assetId, filename));
    return { assetId, filename, mime: type.mime, uploadUrl, maxBytes: limit };
  }

  /** Checks the uploaded file and adds it to the library. */
  complete(user: AuthUser, spaceId: string, body: CompleteBody): Promise<AssetDetail> {
    return withMediaProblems(() => this.add(user, spaceId, body));
  }

  private async add(user: AuthUser, spaceId: string, body: CompleteBody): Promise<AssetDetail> {
    const filename = safeFilename(body.filename);
    const pending = pendingPath(spaceId, body.assetId, filename);
    const { type, limit } = await this.db.userDb(user.claims, async (tx) => {
      const [existing] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, body.assetId));
      if (existing) throw conflict('asset_exists', 'This upload has already been added to the library.');
      const policy = await spacePolicy(tx, spaceId);
      const type = allowedType(filename, policy);
      return { type, limit: uploadLimit(policy.plan, type.kind) };
    });

    const file = await this.check(pending, type, limit);
    return this.db.userDb(user.claims, async (tx) => {
      await tx.insert(assets).values({
        id: body.assetId,
        spaceId,
        path: assetPath(spaceId, body.assetId, filename),
        filename,
        mime: file.mime,
        sizeBytes: file.bytes.length,
        width: file.width,
        height: file.height,
        title: body.title ?? (titleFromFilename(body.filename) || null),
        alt: body.alt || null,
        tags: body.tags ?? [],
        folder: body.folder ?? null,
        uploadedBy: user.id,
      });
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'asset.uploaded',
        targetType: 'asset',
        targetId: body.assetId,
        diff: { filename, mime: file.mime, sizeBytes: file.bytes.length },
      });
      // Last, so a refused row leaves the file pending rather than placed.
      await this.storage.place(pending, assetPath(spaceId, body.assetId, filename), file.bytes, file.mime);
      return readAsset(tx, spaceId, body.assetId);
    });
  }

  /** Describes an asset. Authors may describe only the files they uploaded (RLS and the trigger agree). */
  update(user: AuthUser, spaceId: string, id: string, body: UpdateBody): Promise<AssetDetail> {
    return withMediaProblems(() => this.describe(user, spaceId, id, body));
  }

  private describe(user: AuthUser, spaceId: string, id: string, body: UpdateBody): Promise<AssetDetail> {
    return this.db.userDb(user.claims, async (tx) => {
      const current = await liveAsset(tx, spaceId, id);
      const changes: Partial<typeof assets.$inferInsert> = {};
      if (body.title !== undefined) changes.title = body.title || null;
      if (body.alt !== undefined) changes.alt = body.alt || null;
      if (body.tags !== undefined) changes.tags = body.tags;
      if (body.folder !== undefined) changes.folder = body.folder ?? null;
      if (body.focal !== undefined) {
        if (body.focal && kindOfMime(current.mime) !== 'image')
          throw badRequest('not_an_image', 'Only images have a focal point.');
        changes.focalX = body.focal?.x ?? null;
        changes.focalY = body.focal?.y ?? null;
      }
      const updated = await tx.update(assets).set(changes).where(eq(assets.id, id)).returning({ id: assets.id });
      if (!updated.length) throw forbidden('insufficient_role', 'Authors can describe only the files they uploaded.');
      return readAsset(tx, spaceId, id);
    });
  }

  /** Swaps in the uploaded file and keeps the id, so every page using the asset shows the new file. */
  replace(user: AuthUser, spaceId: string, id: string, body: ReplaceBody): Promise<AssetDetail> {
    return withMediaProblems(() => this.swap(user, spaceId, id, body));
  }

  private async swap(user: AuthUser, spaceId: string, id: string, body: ReplaceBody): Promise<AssetDetail> {
    const filename = safeFilename(body.filename);
    const pending = pendingPath(spaceId, id, filename);
    const { type, limit, current } = await this.db.userDb(user.claims, async (tx) => {
      const current = await liveAsset(tx, spaceId, id);
      const policy = await spacePolicy(tx, spaceId);
      const type = allowedType(filename, policy);
      sameKind(current, type);
      return { type, limit: uploadLimit(policy.plan, type.kind), current };
    });

    const file = await this.check(pending, type, limit);
    const result = await this.db.userDb(user.claims, async (tx) => {
      const path = assetPath(spaceId, id, filename);
      await tx
        .update(assets)
        .set({
          path,
          filename,
          mime: file.mime,
          sizeBytes: file.bytes.length,
          width: file.width,
          height: file.height,
          revision: sql`${assets.revision} + 1`,
        })
        .where(eq(assets.id, id));
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'asset.replaced',
        targetType: 'asset',
        targetId: id,
        diff: { from: current.filename, to: filename, revision: current.revision + 1 },
      });
      await this.storage.place(pending, path, file.bytes, file.mime);
      if (path !== current.path) await this.storage.remove([current.path]);
      return readAsset(tx, spaceId, id);
    });
    this.emit({ type: 'asset.replaced', spaceId, assetId: id, cacheTags: [`asset:${id}`], actorId: user.id });
    return result;
  }

  /** Moves the asset to the bin. Pages using it stop showing it on the site. */
  async remove(user: AuthUser, spaceId: string, id: string): Promise<void> {
    await withMediaProblems(() =>
      this.db.userDb(user.claims, async (tx) => {
        const current = await liveAsset(tx, spaceId, id);
        const [{ count }] = await tx
          .select({ count: sql<number>`count(distinct ${assetUsages.entryId})::int` })
          .from(assetUsages)
          .where(eq(assetUsages.assetId, id));
        await tx
          .update(assets)
          .set({ deletedAt: sql`now()` })
          .where(eq(assets.id, id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'asset.deleted',
          targetType: 'asset',
          targetId: id,
          diff: { filename: current.filename, usedOnPages: count },
        });
      }),
    );
    this.emit({ type: 'asset.deleted', spaceId, assetId: id, cacheTags: [`asset:${id}`], actorId: user.id });
  }

  /** Takes the asset out of the bin. */
  restore(user: AuthUser, spaceId: string, id: string): Promise<AssetDetail> {
    return withMediaProblems(() =>
      this.db.userDb(user.claims, async (tx) => {
        const current = await findAsset(tx, spaceId, id);
        if (!current.deletedAt) throw conflict('asset_not_deleted', 'This file is not in the bin.');
        await tx.update(assets).set({ deletedAt: null }).where(eq(assets.id, id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'asset.restored',
          targetType: 'asset',
          targetId: id,
          diff: { filename: current.filename },
        });
        return readAsset(tx, spaceId, id);
      }),
    );
  }

  /** Reads the pending upload and checks it; a refused file is removed. */
  private async check(pending: string, type: ExpectedType, limit: number): Promise<InspectedFile> {
    const bytes = await this.storage.readPending(pending);
    try {
      if (bytes.length > limit) throw tooLarge(type.kind, limit);
      return await inspectFile(bytes, type);
    } catch (error) {
      await this.storage.remove([pending]);
      throw error;
    }
  }

  private emit(event: MediaEvent): void {
    this.events.emit(event);
  }
}

// --- Helpers -------------------------------------------------------------------------------------

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

function kindFilter(kind: AssetKind): SQL | undefined {
  if (kind === 'image') return like(assets.mime, 'image/%');
  if (kind === 'video') return like(assets.mime, 'video/%');
  return and(notLike(assets.mime, 'image/%'), notLike(assets.mime, 'video/%'));
}

async function spacePolicy(tx: DbTransaction, spaceId: string): Promise<SpacePolicy> {
  const [row] = await tx
    .select({ settings: spaces.settings, plan: organisations.plan })
    .from(spaces)
    .leftJoin(organisations, eq(organisations.id, spaces.organisationId))
    .where(eq(spaces.id, spaceId));
  const settings = (row?.settings ?? {}) as { media?: { allowSvg?: unknown } };
  return { plan: row?.plan ?? null, allowSvg: settings.media?.allowSvg === true };
}

/** The type the file name promises, if the library (and for SVG, the space) accepts it. */
function allowedType(filename: string, policy: SpacePolicy): ExpectedType {
  const type = fileTypeOf(filename);
  if (!type) {
    throw badRequest(
      'file_type_not_allowed',
      'This type of file cannot be added. Use an image (JPEG, PNG, GIF, WebP, AVIF), a video (MP4, WebM, MOV) or a document (PDF, Office, text, CSV, ZIP).',
    );
  }
  if (type.mime === SVG_MIME && !policy.allowSvg) {
    throw badRequest('svg_not_allowed', 'SVG images are turned off for this site. Use PNG or WebP instead.');
  }
  return type;
}

function sameKind(current: AssetRow, type: ExpectedType): void {
  const kind = kindOfMime(current.mime);
  if (kind !== type.kind) {
    throw badRequest(
      'kind_mismatch',
      `Replace ${kind === 'file' ? 'a file' : `an ${kind}`} with another ${kind}, so the pages using it still work.`,
    );
  }
}

const tooLarge = (kind: AssetKind, limit: number) =>
  badRequest('file_too_large', `${kind === 'image' ? 'Images' : 'Files'} can be up to ${formatBytes(limit)}.`);

async function findAsset(tx: DbTransaction, spaceId: string, id: string): Promise<AssetRow> {
  const [row] = await tx
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.spaceId, spaceId)));
  if (!row) throw notFound('asset_not_found', 'There is no such file in this library.');
  return row;
}

/** An asset that is not in the bin. */
async function liveAsset(tx: DbTransaction, spaceId: string, id: string): Promise<AssetRow> {
  const row = await findAsset(tx, spaceId, id);
  if (row.deletedAt) throw conflict('asset_deleted', 'This file is in the bin. Restore it first.');
  return row;
}

async function readAsset(tx: DbTransaction, spaceId: string, id: string): Promise<AssetDetail> {
  const [row] = await tx
    .select(assetColumns)
    .from(assets)
    .leftJoin(profiles, eq(profiles.userId, assets.uploadedBy))
    .where(and(eq(assets.id, id), eq(assets.spaceId, spaceId)));
  if (!row) throw notFound('asset_not_found', 'There is no such file in this library.');

  const usages = await tx
    .select({
      entryId: assetUsages.entryId,
      fieldPath: assetUsages.fieldPath,
      path: publishedContent.fullPath,
      title: sql<string>`coalesce(
        nullif(btrim(${publishedContent.data} ->> 'title'), ''),
        nullif(btrim(${publishedContent.data} ->> 'name'), ''),
        ${publishedContent.fullPath}
      )`,
    })
    .from(assetUsages)
    .innerJoin(publishedContent, eq(publishedContent.entryId, assetUsages.entryId))
    .where(eq(assetUsages.assetId, id))
    .orderBy(publishedContent.fullPath, assetUsages.fieldPath);
  return { ...toAsset(row), usages };
}

function toAsset({
  asset,
  uploadedByName,
  usageCount,
}: {
  asset: AssetRow;
  uploadedByName: string | null;
  usageCount: number;
}): Asset {
  return {
    id: asset.id,
    filename: asset.filename,
    title: asset.title,
    mime: asset.mime,
    kind: kindOfMime(asset.mime),
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    focal: asset.focalX !== null && asset.focalY !== null ? { x: asset.focalX, y: asset.focalY } : null,
    alt: asset.alt,
    tags: asset.tags,
    folder: asset.folder,
    revision: asset.revision,
    uploadedBy: asset.uploadedBy,
    uploadedByName,
    usageCount,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    deletedAt: asset.deletedAt,
  };
}
