import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@novan/api-auth';
import { badRequest, notFound, toCsv } from '@novan/api-common';
import { auditEvents, DbService, entryVersions, profiles, recordAudit } from '@novan/api-db';
import {
  AUDIT_CONTENT_DIFF_ACTIONS,
  AUDIT_EXPORT_LIMIT,
  type AuditActor,
  auditActionLabel,
  type AuditContentDiff,
  type AuditEvent,
  type auditEventsQuerySchema,
  type AuditEventsPage,
  type auditExportQuerySchema,
  diffEntryData,
  type EntryData,
} from '@novan/shared-schemas';
import { and, desc, eq, inArray, isNotNull, like, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';

type ListQuery = z.output<typeof auditEventsQuerySchema>;
type Filters = z.output<typeof auditExportQuerySchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const columns = {
  id: auditEvents.id,
  action: auditEvents.action,
  actorId: auditEvents.actorId,
  actorName: profiles.displayName,
  targetType: auditEvents.targetType,
  targetId: auditEvents.targetId,
  diff: auditEvents.diff,
  createdAt: auditEvents.createdAt,
};
interface Row {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  diff: unknown;
  createdAt: string;
}

/**
 * A space's audit log (docs/build/18-search-forms-audit.md), for space admins and agency staff: RLS (0004) lets no one
 * else read it. Events are filtered by person, action and UK calendar day, newest first. Publishing and restoring
 * record the versions before and after, so their content change can be shown.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly db: DbService) {}

  list(user: AuthUser, spaceId: string, query: ListQuery): Promise<AuditEventsPage> {
    return this.db.userDb(user.claims, async (tx) => {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = (await tx
        .select(columns)
        .from(auditEvents)
        .leftJoin(profiles, eq(profiles.userId, auditEvents.actorId))
        .where(
          and(
            ...filters(spaceId, query),
            after ? sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (${after.t}::timestamptz, ${after.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(query.limit + 1)) as Row[];
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toEvent),
        nextCursor: rows.length > query.limit && last ? encodeCursor({ t: last.createdAt, id: last.id }) : null,
      };
    });
  }

  /** Everyone who appears in the log, for the person filter; people no longer in the space keep their name if known. */
  actors(user: AuthUser, spaceId: string): Promise<AuditActor[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const rows = await tx
        .selectDistinct({ id: auditEvents.actorId, name: profiles.displayName })
        .from(auditEvents)
        .leftJoin(profiles, eq(profiles.userId, auditEvents.actorId))
        .where(and(eq(auditEvents.spaceId, spaceId), isNotNull(auditEvents.actorId)));
      return rows
        .map((row) => ({ id: row.id as string, name: row.name?.trim() || 'Someone no longer in this space' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
    });
  }

  /** The filtered log as CSV, newest first, at most {@link AUDIT_EXPORT_LIMIT} events. The export is audited too. */
  exportCsv(user: AuthUser, spaceId: string, query: Filters): Promise<string> {
    return this.db.userDb(user.claims, async (tx) => {
      const rows = (await tx
        .select(columns)
        .from(auditEvents)
        .leftJoin(profiles, eq(profiles.userId, auditEvents.actorId))
        .where(and(...filters(spaceId, query)))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(AUDIT_EXPORT_LIMIT)) as Row[];
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'audit_log.exported',
        targetType: 'audit_log',
        diff: { ...query, events: rows.length },
      });
      return toCsv([
        ['When (UTC)', 'Person', 'What happened', 'Action', 'Item type', 'Item', 'Details'],
        ...rows.map((row) => [
          row.createdAt,
          row.actorId ? row.actorName?.trim() || row.actorId : 'Novan CMS',
          auditActionLabel(row.action),
          row.action,
          row.targetType,
          row.targetId,
          row.diff ? JSON.stringify(row.diff) : '',
        ]),
      ]);
    });
  }

  /** The content change a publish or restore made: the versions it recorded, compared. */
  contentDiff(user: AuthUser, spaceId: string, id: string): Promise<AuditContentDiff> {
    return this.db.userDb(user.claims, async (tx) => {
      const [event] = await tx
        .select({ action: auditEvents.action, targetId: auditEvents.targetId, diff: auditEvents.diff })
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, spaceId), eq(auditEvents.id, id)));
      if (!event) throw notFound('audit_event_not_found', 'There is no such event in this space\'s audit log.');
      const versions = contentVersions(event.action, event.diff);
      if (!versions || !event.targetId) throw notFound('no_content_diff', 'This event did not change a page\'s content.');

      const wanted = [versions.to, ...(versions.from ? [versions.from] : [])];
      const rows = await tx
        .select({ id: entryVersions.id, entryId: entryVersions.entryId, data: entryVersions.data })
        .from(entryVersions)
        .where(and(inArray(entryVersions.id, wanted), eq(entryVersions.spaceId, spaceId)));
      const after = rows.find((row) => row.id === versions.to);
      const before = versions.from ? rows.find((row) => row.id === versions.from) : { data: {} };
      if (!after || !before || after.entryId !== event.targetId) {
        throw notFound('version_not_found', 'The versions this event changed are no longer kept.');
      }
      return {
        entryId: event.targetId,
        fromVersionId: versions.from,
        toVersionId: versions.to,
        changes: diffEntryData(before.data as EntryData, after.data as EntryData),
      };
    });
  }
}

/** The versions before and after a content event, from what it recorded. */
function contentVersions(action: string, diff: unknown): { from: string | null; to: string } | null {
  if (!AUDIT_CONTENT_DIFF_ACTIONS.includes(action) || typeof diff !== 'object' || diff === null) return null;
  const { versionId, previousVersionId } = diff as Record<string, unknown>;
  if (typeof versionId !== 'string' || !UUID.test(versionId)) return null;
  return { from: typeof previousVersionId === 'string' && UUID.test(previousVersionId) ? previousVersionId : null, to: versionId };
}

function filters(spaceId: string, query: Filters): (SQL | undefined)[] {
  return [
    eq(auditEvents.spaceId, spaceId),
    query.actor ? eq(auditEvents.actorId, query.actor) : undefined,
    // `entry.published` is one action; `entry` is every action on entries.
    query.action
      ? query.action.includes('.')
        ? eq(auditEvents.action, query.action)
        : or(eq(auditEvents.action, query.action), like(auditEvents.action, `${query.action}.%`))
      : undefined,
    // Calendar days in the UK, whatever the time of year.
    query.from ? sql`${auditEvents.createdAt} >= (${query.from}::date::timestamp at time zone 'Europe/London')` : undefined,
    query.to ? sql`${auditEvents.createdAt} < ((${query.to}::date + 1)::timestamp at time zone 'Europe/London')` : undefined,
  ];
}

function toEvent(row: Row): AuditEvent {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    actorName: row.actorName?.trim() || null,
    targetType: row.targetType,
    targetId: row.targetId,
    diff: (row.diff as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    hasContentDiff: contentVersions(row.action, row.diff) !== null,
  };
}

interface Cursor {
  t: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Cursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<Cursor>;
    // A timestamp as Postgres wrote it, passed back to it unchanged.
    const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;
    if (typeof value.t === 'string' && timestamp.test(value.t) && typeof value.id === 'string' && UUID.test(value.id)) {
      return { t: value.t, id: value.id };
    }
  } catch {
    // Reported below.
  }
  throw badRequest('invalid_cursor', 'This cursor does not belong to this list. Start again from the first page.');
}
