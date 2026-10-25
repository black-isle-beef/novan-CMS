import { Injectable } from '@nestjs/common';
import { type AuthUser, hasStaffAccess } from '@novan/api-auth';
import { conflict, forbidden, notFound } from '@novan/api-common';
import { ContentEvents } from '@novan/api-content';
import {
  DbService,
  type DbTransaction,
  designSystemClasses,
  designSystems,
  designSystemVersions,
  environments,
  isCheckViolation,
  isInsufficientPrivilege,
  isUniqueViolation,
  recordAudit,
  spaceDesignSystems,
  spaces,
} from '@novan/api-db';
import { enqueue } from '@novan/api-jobs';
import type { DesignSystemFramework } from '@novan/shared-design-system';
import {
  type createDesignSystemRequestSchema,
  type CreateDesignSystemVersionResponse,
  type createDesignSystemVersionRequestSchema,
  type DesignSystem,
  type DesignSystemClasses,
  type designSystemClassesQuerySchema,
  type DesignSystemVersion,
  type DesignSystemVersionStatus,
  type putSiteDesignSystemsRequestSchema,
  type SiteDesignSystem,
  type ValidationReport,
} from '@novan/shared-schemas';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DesignSystemStorage, pendingPath, versionPrefix } from './design-system-storage';

type CreateBody = z.output<typeof createDesignSystemRequestSchema>;
type CreateVersionBody = z.output<typeof createDesignSystemVersionRequestSchema>;
type ClassesQuery = z.output<typeof designSystemClassesQuerySchema>;
type PutSiteBody = z.output<typeof putSiteDesignSystemsRequestSchema>;
type VersionRow = typeof designSystemVersions.$inferSelect;

/** The job the upload worker runs for a version that is ready to check. */
export interface ProcessVersionJob {
  type: 'process-version';
  spaceId: string;
  versionId: string;
  [key: string]: unknown;
}

/**
 * A space's design systems (docs/build/24-design-systems.md). Every query runs as the caller under RLS: members
 * read, admins and developers upload and attach. Uploads are checked by the worker (`DesignSystemProcessor`).
 * Changing what the site loads purges it, and every change is audited.
 */
@Injectable()
export class DesignSystemsService {
  constructor(
    private readonly db: DbService,
    private readonly storage: DesignSystemStorage,
    private readonly events: ContentEvents,
  ) {}

  list(user: AuthUser, spaceId: string): Promise<DesignSystem[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const systems = await tx.select().from(designSystems).where(eq(designSystems.spaceId, spaceId)).orderBy(asc(designSystems.name));
      const versions = systems.length
        ? await tx
            .select()
            .from(designSystemVersions)
            .where(eq(designSystemVersions.spaceId, spaceId))
            .orderBy(desc(designSystemVersions.createdAt))
        : [];
      return systems.map((system) => ({
        id: system.id,
        name: system.name,
        slug: system.slug,
        framework: system.framework as DesignSystemFramework,
        createdAt: system.createdAt,
        versions: versions.filter((version) => version.designSystemId === system.id).map(toVersion),
      }));
    });
  }

  async create(user: AuthUser, spaceId: string, body: CreateBody): Promise<DesignSystem> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        await requireEnabled(tx, user, spaceId);
        const [row] = await tx
          .insert(designSystems)
          .values({ spaceId, name: body.name, slug: body.slug, framework: body.framework, createdBy: user.id })
          .returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'design_system.created',
          targetType: 'design_system',
          targetId: row.id,
          diff: { name: row.name, slug: row.slug, framework: row.framework },
        });
        return { id: row.id, name: row.name, slug: row.slug, framework: row.framework as DesignSystemFramework, createdAt: row.createdAt, versions: [] };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('design_system_exists', 'This space already has a design system with that short name.');
      throw writeProblem(error);
    }
  }

  /**
   * Starts a version. An uploaded stylesheet goes to the signed URL in the answer, then `complete`; one at an
   * address is fetched by the worker straight away.
   */
  async createVersion(user: AuthUser, spaceId: string, designSystemId: string, body: CreateVersionBody): Promise<CreateDesignSystemVersionResponse> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        await requireEnabled(tx, user, spaceId);
        await findSystem(tx, spaceId, designSystemId);
        const [inserted] = await tx
          .insert(designSystemVersions)
          .values({
            spaceId,
            designSystemId,
            version: body.version,
            source: body.source,
            filename: body.source === 'css' ? body.filename : null,
            sourceUrl: body.source === 'url' ? body.url : null,
            createdBy: user.id,
          })
          .returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'design_system.version_uploaded',
          targetType: 'design_system_version',
          targetId: inserted.id,
          diff: { version: inserted.version, source: inserted.source, ...(inserted.sourceUrl ? { url: inserted.sourceUrl } : {}) },
        });
        if (body.source === 'url') {
          const row = await this.startProcessing(tx, spaceId, inserted.id);
          return { version: toVersion(row), uploadUrl: null };
        }
        const uploadUrl = await this.storage.signedUploadUrl(pendingPath(versionPrefix(spaceId, designSystemId, inserted.id), body.filename));
        return { version: toVersion(inserted), uploadUrl };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('version_exists', 'This design system already has that version. Use a new version number.');
      throw writeProblem(error);
    }
  }

  /** The stylesheet arrived: the worker checks it. */
  async complete(user: AuthUser, spaceId: string, designSystemId: string, versionId: string): Promise<DesignSystemVersion> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const current = await findVersion(tx, spaceId, designSystemId, versionId);
        if (current.status !== 'uploaded') throw conflict('version_not_uploaded', 'This version is already being checked.');
        return toVersion(await this.startProcessing(tx, spaceId, versionId));
      });
    } catch (error) {
      throw writeProblem(error);
    }
  }

  version(user: AuthUser, spaceId: string, designSystemId: string, versionId: string): Promise<DesignSystemVersion> {
    return this.db.userDb(user.claims, async (tx) => toVersion(await findVersion(tx, spaceId, designSystemId, versionId)));
  }

  /** A version's classes starting with `q`, in a group or not, and how many each group has. */
  classes(user: AuthUser, spaceId: string, designSystemId: string, versionId: string, query: ClassesQuery): Promise<DesignSystemClasses> {
    return this.db.userDb(user.claims, async (tx) => {
      await findVersion(tx, spaceId, designSystemId, versionId);
      const where = and(
        eq(designSystemClasses.versionId, versionId),
        query.q ? sql`${designSystemClasses.className} like ${`${escapeLike(query.q)}%`}` : undefined,
        query.group === undefined ? undefined : query.group === '' ? isNull(designSystemClasses.classGroup) : eq(designSystemClasses.classGroup, query.group),
      );
      const [items, groups] = await Promise.all([
        tx
          .select({ name: designSystemClasses.className, group: designSystemClasses.classGroup })
          .from(designSystemClasses)
          .where(where)
          // Shorter names first, so `btn` comes before `btn-outline-secondary-lg`.
          .orderBy(sql`length(${designSystemClasses.className})`, asc(designSystemClasses.className))
          .limit(query.limit),
        tx
          .select({ group: designSystemClasses.classGroup, count: count() })
          .from(designSystemClasses)
          .where(eq(designSystemClasses.versionId, versionId))
          .groupBy(designSystemClasses.classGroup)
          .orderBy(asc(designSystemClasses.classGroup)),
      ]);
      return { items, groups, total: groups.reduce((total, group) => total + group.count, 0) };
    });
  }

  async deprecate(user: AuthUser, spaceId: string, designSystemId: string, versionId: string): Promise<DesignSystemVersion> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const current = await findVersion(tx, spaceId, designSystemId, versionId);
        if (current.status !== 'ready') throw conflict('version_not_ready', 'Only a ready version can be deprecated.');
        const [row] = await tx.update(designSystemVersions).set({ status: 'deprecated' }).where(eq(designSystemVersions.id, versionId)).returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'design_system.version_deprecated',
          targetType: 'design_system_version',
          targetId: versionId,
          diff: { version: row.version },
        });
        await this.siteStylesChanged(tx, user, spaceId);
        return toVersion(row);
      });
    } catch (error) {
      throw writeProblem(error);
    }
  }

  /** The versions the space's site loads, first loaded first. */
  site(user: AuthUser, spaceId: string): Promise<SiteDesignSystem[]> {
    return this.db.userDb(user.claims, (tx) => readSite(tx, spaceId));
  }

  /**
   * Replaces what the site loads with `items`, in that order. Only ready versions can be added; a deprecated one
   * already attached may stay. One version of each design system at a time.
   */
  async putSite(user: AuthUser, spaceId: string, body: PutSiteBody): Promise<SiteDesignSystem[]> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        await requireEnabled(tx, user, spaceId);
        const environmentId = await mainEnvironment(tx, spaceId);
        const before = await readSite(tx, spaceId);
        const ids = body.items.map((item) => item.versionId);
        const versions = ids.length
          ? await tx
              .select({ id: designSystemVersions.id, designSystemId: designSystemVersions.designSystemId, status: designSystemVersions.status })
              .from(designSystemVersions)
              .where(and(eq(designSystemVersions.spaceId, spaceId), inArray(designSystemVersions.id, ids)))
          : [];
        const attached = new Set(before.map((item) => item.versionId));
        for (const id of ids) {
          const version = versions.find((candidate) => candidate.id === id);
          if (!version) throw notFound('version_not_found', 'One of the versions does not exist in this space.');
          if (version.status !== 'ready' && !(version.status === 'deprecated' && attached.has(id))) {
            throw conflict('version_not_ready', 'Only a ready version can be added to the site.');
          }
        }
        const systems = versions.map((version) => version.designSystemId);
        if (new Set(systems).size !== systems.length) throw conflict('one_version_each', 'Add one version of each design system.');

        // Kept rows are updated in place: a deprecated version may stay, but could not be attached afresh.
        await tx
          .delete(spaceDesignSystems)
          .where(
            and(
              eq(spaceDesignSystems.environmentId, environmentId),
              ids.length ? sql`${spaceDesignSystems.versionId} not in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : undefined,
            ),
          );
        for (const [index, item] of body.items.entries()) {
          if (attached.has(item.versionId)) {
            await tx
              .update(spaceDesignSystems)
              .set({ loadOrder: index, enabled: item.enabled })
              .where(and(eq(spaceDesignSystems.environmentId, environmentId), eq(spaceDesignSystems.versionId, item.versionId)));
          } else {
            await tx.insert(spaceDesignSystems).values({
              spaceId,
              environmentId,
              designSystemId: versions.find((version) => version.id === item.versionId)?.designSystemId as string,
              versionId: item.versionId,
              loadOrder: index,
              enabled: item.enabled,
            });
          }
        }
        const after = await readSite(tx, spaceId);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'design_systems.site_changed',
          targetType: 'space',
          targetId: spaceId,
          diff: { from: before.map(summary), to: after.map(summary) },
        });
        await this.siteStylesChanged(tx, user, spaceId, environmentId);
        return after;
      });
    } catch (error) {
      throw writeProblem(error);
    }
  }

  private async startProcessing(tx: DbTransaction, spaceId: string, versionId: string): Promise<VersionRow> {
    const [row] = await tx.update(designSystemVersions).set({ status: 'validating' }).where(eq(designSystemVersions.id, versionId)).returning();
    await enqueue(tx, 'design-systems', { type: 'process-version', spaceId, versionId } satisfies ProcessVersionJob);
    return row;
  }

  private async siteStylesChanged(tx: DbTransaction, user: AuthUser, spaceId: string, environmentId?: string): Promise<void> {
    await this.events.emit(tx, { type: 'site-styles.changed', spaceId, environmentId: environmentId ?? (await mainEnvironment(tx, spaceId)), actorId: user.id });
  }
}

/** Design systems are turned on per space by agency staff (`spaces.settings.designSystems.enabled`). */
async function requireEnabled(tx: DbTransaction, user: AuthUser, spaceId: string): Promise<void> {
  if (hasStaffAccess(user)) return;
  const [row] = await tx
    .select({ enabled: sql<boolean>`coalesce((${spaces.settings} #>> '{designSystems,enabled}')::boolean, false)` })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  if (!row?.enabled) throw forbidden('design_systems_off', 'Design systems are not turned on for this space. Ask the agency.');
}

async function mainEnvironment(tx: DbTransaction, spaceId: string): Promise<string> {
  const [row] = await tx
    .select({ id: environments.id })
    .from(environments)
    .where(and(eq(environments.spaceId, spaceId), eq(environments.isMain, true)));
  if (!row) throw notFound('environment_not_found', 'The space has no main environment.');
  return row.id;
}

async function findSystem(tx: DbTransaction, spaceId: string, id: string): Promise<typeof designSystems.$inferSelect> {
  const [row] = await tx.select().from(designSystems).where(and(eq(designSystems.spaceId, spaceId), eq(designSystems.id, id)));
  if (!row) throw notFound('design_system_not_found', 'There is no such design system in this space.');
  return row;
}

async function findVersion(tx: DbTransaction, spaceId: string, designSystemId: string, id: string): Promise<VersionRow> {
  const [row] = await tx
    .select()
    .from(designSystemVersions)
    .where(and(eq(designSystemVersions.spaceId, spaceId), eq(designSystemVersions.designSystemId, designSystemId), eq(designSystemVersions.id, id)));
  if (!row) throw notFound('version_not_found', 'There is no such version of this design system.');
  return row;
}

async function readSite(tx: DbTransaction, spaceId: string): Promise<SiteDesignSystem[]> {
  const rows = await tx
    .select({
      designSystemId: designSystems.id,
      versionId: designSystemVersions.id,
      name: designSystems.name,
      slug: designSystems.slug,
      framework: designSystems.framework,
      version: designSystemVersions.version,
      status: designSystemVersions.status,
      manifest: designSystemVersions.manifest,
      loadOrder: spaceDesignSystems.loadOrder,
      enabled: spaceDesignSystems.enabled,
    })
    .from(spaceDesignSystems)
    .innerJoin(environments, and(eq(environments.id, spaceDesignSystems.environmentId), eq(environments.isMain, true)))
    .innerJoin(designSystemVersions, eq(designSystemVersions.id, spaceDesignSystems.versionId))
    .innerJoin(designSystems, eq(designSystems.id, spaceDesignSystems.designSystemId))
    .where(eq(spaceDesignSystems.spaceId, spaceId))
    .orderBy(asc(spaceDesignSystems.loadOrder));
  return rows.map(({ manifest, ...row }) => {
    const templates = (manifest ?? {}) as { breakpoints?: Record<string, string>; states?: Record<string, string> };
    return {
      ...row,
      framework: row.framework as DesignSystemFramework,
      status: row.status as DesignSystemVersionStatus,
      breakpoints: templates.breakpoints ?? null,
      states: templates.states ?? null,
    };
  });
}

function summary(item: SiteDesignSystem) {
  return { designSystem: item.slug, version: item.version, enabled: item.enabled };
}

export function toVersion(row: VersionRow): DesignSystemVersion {
  return {
    id: row.id,
    designSystemId: row.designSystemId,
    version: row.version,
    status: row.status as DesignSystemVersionStatus,
    source: row.source as DesignSystemVersion['source'],
    sourceUrl: row.sourceUrl,
    filename: row.filename,
    report: (row.validationReport as ValidationReport | null) ?? null,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
  };
}

/** `%` and `_` typed into the search mean themselves. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** RLS refusing a write means the caller's role cannot make it; a guard trigger, that the change is not allowed. */
function writeProblem(error: unknown): unknown {
  if (isInsufficientPrivilege(error)) return forbidden('insufficient_role', 'Only admins and developers manage design systems.');
  if (isCheckViolation(error)) return conflict('design_system_conflict', 'That change is not allowed for this version.');
  return error;
}
