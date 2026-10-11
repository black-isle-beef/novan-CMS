import { z } from 'zod';

// The audit log screen (docs/build/18-search-forms-audit.md): who changed what in a space, and when, for space admins.
// `GET /v1/management/spaces/:spaceId/audit-events`.

export const auditEventSchema = z.object({
  id: z.uuid(),
  /** Dotted verb, e.g. `entry.published`. */
  action: z.string(),
  /** Null for background jobs (housekeeping) and people whose account is gone. */
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  /** What changed, as recorded with the event. */
  diff: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  /** Whether `GET .../audit-events/:id/content-diff` can show the page's content before and after. */
  hasContentDiff: z.boolean(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditEventsPageSchema = z.object({
  items: z.array(auditEventSchema),
  /** Pass as `cursor` for the next page; null on the last. */
  nextCursor: z.string().nullable(),
});
export type AuditEventsPage = z.infer<typeof auditEventsPageSchema>;

const ukDate = z.iso.date('Use a date like 2026-10-31.');

const auditFilters = {
  /** Only this person's changes. */
  actor: z.uuid('Choose a person from the list.').optional(),
  /** An action (`entry.published`), or every action on one kind of thing (`entry`). */
  action: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)?$/, 'Choose an action from the list.')
    .max(100)
    .optional(),
  /** From the start of this day, UK time. */
  from: ukDate.optional(),
  /** To the end of this day, UK time. */
  to: ukDate.optional(),
};

const checkRange = (query: { from?: string; to?: string }, ctx: z.core.$RefinementCtx<unknown>) => {
  if (query.from && query.to && query.from > query.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end date must be on or after the start date.' });
  }
};

export const auditEventsQuerySchema = z
  .strictObject({
    ...auditFilters,
    cursor: z.string().max(500).regex(/^[A-Za-z0-9_-]+$/, 'Use the nextCursor of the previous page.').optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine(checkRange);
export type AuditEventsQuery = z.input<typeof auditEventsQuerySchema>;

/** The CSV export takes the same filters, and returns at most this many events. */
export const auditExportQuerySchema = z.strictObject(auditFilters).superRefine(checkRange);
export const AUDIT_EXPORT_LIMIT = 50_000;

/** People who appear in the space's audit log, for the person filter. */
export const auditActorSchema = z.object({ id: z.uuid(), name: z.string() });
export type AuditActor = z.infer<typeof auditActorSchema>;

/** Plain words for the actions the API records; others are shown as they are. */
export const auditActionLabels: Readonly<Record<string, string>> = {
  'space.created': 'Created the space',
  'space.updated': 'Changed space settings',
  'member.added': 'Added a person',
  'member.invited': 'Invited a person',
  'member.role_changed': 'Changed a person\'s role',
  'member.removed': 'Removed a person',
  'content_type.created': 'Added a content type',
  'content_type.updated': 'Changed a content type',
  'content_type.deleted': 'Deleted a content type',
  'block_type.created': 'Added a block',
  'block_type.updated': 'Changed a block',
  'block_type.deleted': 'Deleted a block',
  'entry.created': 'Created a page',
  'entry.submitted': 'Sent a page for review',
  'entry.changes_requested': 'Asked for changes',
  'entry.approved': 'Approved and published a page',
  'entry.published': 'Published a page',
  'entry.unpublished': 'Unpublished a page',
  'entry.scheduled': 'Scheduled a change',
  'entry.schedule_cancelled': 'Cancelled a scheduled change',
  'entry.archived': 'Archived a page',
  'entry.unarchived': 'Took a page out of the archive',
  'entry.version_restored': 'Restored an earlier version',
  'entry.machine_translated': 'Machine-translated a page',
  'entry.deleted': 'Moved a page to the bin',
  'entry.restored': 'Restored a page from the bin',
  'entry.moved': 'Moved a page',
  'entry.purged': 'Deleted a page for good',
  'folder.created': 'Added a folder',
  'folder.updated': 'Changed a folder',
  'folder.deleted': 'Deleted a folder',
  'asset.uploaded': 'Uploaded a file',
  'asset.replaced': 'Replaced a file',
  'asset.deleted': 'Moved a file to the bin',
  'asset.restored': 'Restored a file from the bin',
  'asset.purged': 'Deleted a file for good',
  'locale.added': 'Added a language',
  'locale.updated': 'Changed a language',
  'locale.removed': 'Removed a language',
  'redirect.created': 'Added a redirect',
  'redirect.updated': 'Changed a redirect',
  'redirect.deleted': 'Deleted a redirect',
  'redirects.imported': 'Imported redirects',
  'api_token.created': 'Created an API token',
  'api_token.revoked': 'Revoked an API token',
  'webhook.created': 'Added a webhook',
  'webhook.updated': 'Changed a webhook',
  'webhook.deleted': 'Deleted a webhook',
  'webhook.secret_rotated': 'Replaced a webhook secret',
  'webhook.delivery_resent': 'Resent a webhook delivery',
  'release.created': 'Created a release',
  'release.updated': 'Changed a release',
  'release.deleted': 'Deleted a release',
  'release.item_added': 'Added a page to a release',
  'release.item_removed': 'Took a page out of a release',
  'release.scheduled': 'Scheduled a release',
  'release.schedule_cancelled': 'Cancelled a scheduled release',
  'release.published': 'Published a release',
  'view_as.started': 'Started viewing as a role',
  'view_as.stopped': 'Stopped viewing as a role',
  'form_settings.updated': 'Changed form settings',
  'form_submission.deleted': 'Deleted a form submission',
  'form_submissions.exported': 'Exported form submissions',
  'audit_log.exported': 'Exported the audit log',
};

/** The words for `action`, or the action itself. */
export function auditActionLabel(action: string): string {
  return auditActionLabels[action] ?? action;
}

/** `GET .../audit-events/:id/content-diff`: what a publish or restore changed in the page's content. */
export const auditContentDiffSchema = z.object({
  entryId: z.uuid(),
  /** The version before; null when the page was published for the first time. */
  fromVersionId: z.uuid().nullable(),
  toVersionId: z.uuid(),
  /** As `GET .../versions/:a/diff/:b` (docs/build/06-entries-versions.md). */
  changes: z.array(
    z.object({
      kind: z.enum(['added', 'removed', 'changed', 'moved']),
      path: z.array(z.string()),
      block: z.string().optional(),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
      from: z.number().optional(),
      to: z.number().optional(),
    }),
  ),
});
export type AuditContentDiff = z.infer<typeof auditContentDiffSchema>;

/** Content events whose diff names the versions before and after, so the content change can be shown. */
export const AUDIT_CONTENT_DIFF_ACTIONS: readonly string[] = ['entry.published', 'entry.approved', 'entry.version_restored'];
