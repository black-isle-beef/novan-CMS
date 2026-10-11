import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@novan/api-auth';
import { badRequest, forbidden, notFound, toCsv } from '@novan/api-common';
import { DbService, type DbTransaction, formSettings, formSubmissions, isInsufficientPrivilege, recordAudit } from '@novan/api-db';
import {
  DEFAULT_FORM_RETENTION_MONTHS,
  type FormSettings,
  type FormSubmission,
  type FormSubmissionsPage,
  type formSubmissionsQuerySchema,
  type FormSummary,
  type updateFormSettingsRequestSchema,
} from '@novan/shared-schemas';
import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';

type ListQuery = z.output<typeof formSubmissionsQuerySchema>;
type SettingsBody = z.output<typeof updateFormSettingsRequestSchema>;

/** Submissions a CSV export holds at most. */
const EXPORT_LIMIT = 50_000;

/**
 * The Forms inbox (docs/build/18-search-forms-audit.md): what visitors sent, for space admins and editors (and agency
 * staff), and the space's form settings, which admins change. Every query runs as the caller under RLS (0020).
 * Deleting a submission, exporting a form's and changing the settings are audited, without the answers themselves.
 */
@Injectable()
export class FormsService {
  constructor(private readonly db: DbService) {}

  /** Submissions, newest first, a page at a time. */
  list(user: AuthUser, spaceId: string, query: ListQuery): Promise<FormSubmissionsPage> {
    return this.db.userDb(user.claims, async (tx) => {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await tx
        .select()
        .from(formSubmissions)
        .where(
          and(
            eq(formSubmissions.spaceId, spaceId),
            query.form ? eq(formSubmissions.formUid, query.form) : undefined,
            after
              ? sql`(${formSubmissions.createdAt}, ${formSubmissions.id}) < (${after.t}::timestamptz, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(formSubmissions.createdAt), desc(formSubmissions.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toSubmission),
        nextCursor: rows.length > query.limit && last ? encodeCursor({ t: last.createdAt, id: last.id }) : null,
      };
    });
  }

  get(user: AuthUser, spaceId: string, id: string): Promise<FormSubmission> {
    return this.db.userDb(user.claims, (tx) => one(tx, spaceId, id));
  }

  async remove(user: AuthUser, spaceId: string, id: string): Promise<void> {
    await this.db.userDb(user.claims, async (tx) => {
      const submission = await one(tx, spaceId, id);
      const deleted = await tx.delete(formSubmissions).where(eq(formSubmissions.id, id)).returning({ id: formSubmissions.id });
      if (!deleted.length) throw forbidden('insufficient_role', 'Only admins and editors delete form submissions.');
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'form_submission.deleted',
        targetType: 'form_submission',
        targetId: id,
        diff: { formUid: submission.formUid, formName: submission.formName, pagePath: submission.pagePath, sentAt: submission.createdAt },
      });
    });
  }

  /** The forms that have received submissions: how many, and when the last came. */
  forms(user: AuthUser, spaceId: string): Promise<FormSummary[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const rows = await tx.execute<{
        form_uid: string;
        form_name: string | null;
        page_path: string | null;
        entry_id: string | null;
        count: number;
        last_at: string;
      }>(
        sql`select form_uid,
              (array_agg(form_name order by created_at desc))[1] as form_name,
              (array_agg(page_path order by created_at desc))[1] as page_path,
              (array_agg(entry_id order by created_at desc))[1] as entry_id,
              count(*)::int as count,
              to_json(max(created_at)) #>> '{}' as last_at
            from public.form_submissions
            where space_id = ${spaceId}
            group by form_uid
            order by max(created_at) desc`,
      );
      return rows.map((row) => ({
        formUid: row.form_uid,
        formName: row.form_name,
        pagePath: row.page_path,
        entryId: row.entry_id,
        count: row.count,
        lastAt: row.last_at,
      }));
    });
  }

  /**
   * One form's submissions as CSV: when, page and language, then a column per field (by its latest label), oldest
   * first. Returns the file and a name for it.
   */
  exportCsv(user: AuthUser, spaceId: string, formUid: string): Promise<{ csv: string; name: string }> {
    return this.db.userDb(user.claims, async (tx) => {
      const rows = await tx
        .select()
        .from(formSubmissions)
        .where(and(eq(formSubmissions.spaceId, spaceId), eq(formSubmissions.formUid, formUid)))
        .orderBy(formSubmissions.createdAt, formSubmissions.id)
        .limit(EXPORT_LIMIT);
      if (!rows.length) throw notFound('form_not_found', 'This form has no submissions to export.');
      const submissions = rows.map(toSubmission);

      // Every field any submission had, in the order of the newest form, then any the form no longer has.
      const columns = new Map<string, string>();
      for (const submission of [...submissions].reverse()) {
        for (const field of submission.fields) if (!columns.has(field.name)) columns.set(field.name, field.label);
      }
      const csv = toCsv([
        ['Sent (UTC)', 'Page', 'Language', ...columns.values()],
        ...submissions.map((submission) => [
          submission.createdAt,
          submission.pagePath,
          submission.locale,
          ...[...columns.keys()].map((name) => cell(submission.data[name])),
        ]),
      ]);
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'form_submissions.exported',
        targetType: 'form',
        targetId: formUid,
        diff: { formName: submissions[submissions.length - 1].formName, submissions: submissions.length },
      });
      return { csv, name: submissions[submissions.length - 1].formName ?? formUid };
    });
  }

  settings(user: AuthUser, spaceId: string): Promise<FormSettings> {
    return this.db.userDb(user.claims, (tx) => readSettings(tx, spaceId));
  }

  async updateSettings(user: AuthUser, spaceId: string, body: SettingsBody): Promise<FormSettings> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const before = await readSettings(tx, spaceId);
        await tx
          .insert(formSettings)
          .values({ spaceId, recipients: body.recipients, retentionMonths: body.retentionMonths, updatedBy: user.id })
          .onConflictDoUpdate({
            target: formSettings.spaceId,
            set: { recipients: body.recipients, retentionMonths: body.retentionMonths, updatedBy: user.id },
          });
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'form_settings.updated',
          targetType: 'form_settings',
          targetId: spaceId,
          diff: { from: before, to: body },
        });
        return readSettings(tx, spaceId);
      });
    } catch (error) {
      if (isInsufficientPrivilege(error)) throw forbidden('insufficient_role', 'Only admins change form settings.');
      throw error;
    }
  }
}

async function readSettings(tx: DbTransaction, spaceId: string): Promise<FormSettings> {
  const [row] = await tx
    .select({ recipients: formSettings.recipients, retentionMonths: formSettings.retentionMonths })
    .from(formSettings)
    .where(eq(formSettings.spaceId, spaceId));
  return row ?? { recipients: [], retentionMonths: DEFAULT_FORM_RETENTION_MONTHS };
}

async function one(tx: DbTransaction, spaceId: string, id: string): Promise<FormSubmission> {
  const [row] = await tx
    .select()
    .from(formSubmissions)
    .where(and(eq(formSubmissions.spaceId, spaceId), eq(formSubmissions.id, id)) as SQL);
  if (!row) throw notFound('form_submission_not_found', 'There is no such form submission in this space.');
  return toSubmission(row);
}

function toSubmission(row: typeof formSubmissions.$inferSelect): FormSubmission {
  return {
    id: row.id,
    entryId: row.entryId,
    formUid: row.formUid,
    formName: row.formName,
    pagePath: row.pagePath,
    locale: row.locale,
    // Written by FormSubmissions after checking them against the form.
    data: row.data as FormSubmission['data'],
    fields: row.fields as FormSubmission['fields'],
    createdAt: row.createdAt,
  };
}

function cell(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return value === undefined || value === null ? '' : String(value);
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
    // A timestamp as Postgres wrote it, e.g. `2026-10-11 09:30:00.123456+00`, passed back to it unchanged.
    const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;
    if (typeof value.t === 'string' && timestamp.test(value.t) && typeof value.id === 'string' && /^[0-9a-f-]{36}$/i.test(value.id)) {
      return { t: value.t, id: value.id };
    }
  } catch {
    // Reported below.
  }
  throw badRequest('invalid_cursor', 'This cursor does not belong to this list. Start again from the first page.');
}
