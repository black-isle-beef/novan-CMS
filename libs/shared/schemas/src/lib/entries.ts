import { z } from 'zod';
import { apiIdSchema, type EntryData } from './fields';
import { contentTypeKindSchema } from './content-model';
import { isLocaleMap, localeCodeSchema } from './locales';

// Folders, entries and versions (docs/build/06-entries-versions.md), served under
// /v1/management/spaces/:spaceId/environments/:env/{folders,entries,versions}.

/** One part of an address: lowercase words joined by single hyphens, e.g. `about-us`. */
export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a slug.')
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens, like about-us.');

/** Turns a title into a slug: `Über uns & more!` becomes `uber-uns-more`. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '');
}

export const entryStatuses = ['draft', 'in_review', 'scheduled', 'published', 'archived'] as const;
export const entryStatusSchema = z.enum(entryStatuses);
export type EntryStatus = z.infer<typeof entryStatusSchema>;

const nameSchema = z.string().trim().min(1, 'Enter a name.').max(120);
const messageSchema = z.string().trim().max(500).nullish();
const dataSchema = z.record(z.string(), z.unknown());

// --- Folders ------------------------------------------------------------------------------------

export const folderSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  name: z.string(),
  slug: z.string(),
  /** `/parent/slug`. */
  path: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Folder = z.infer<typeof folderSchema>;

export const createFolderRequestSchema = z.strictObject({
  name: nameSchema,
  slug: slugSchema,
  parentId: z.uuid().nullish(),
});
export type CreateFolderRequest = z.input<typeof createFolderRequestSchema>;

/** Renaming or moving a folder changes the address of every page inside it, published or not. */
export const updateFolderRequestSchema = z
  .strictObject({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    parentId: z.uuid().nullish(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one of name, slug or parentId.');
export type UpdateFolderRequest = z.input<typeof updateFolderRequestSchema>;

// --- Entries ------------------------------------------------------------------------------------

export const entrySummarySchema = z.object({
  id: z.uuid(),
  contentType: apiIdSchema,
  contentTypeName: z.string(),
  kind: contentTypeKindSchema,
  folderId: z.uuid().nullable(),
  slug: z.string(),
  /** Folder path and slug, e.g. `/blog/hello-world`. */
  path: z.string(),
  /** From the current version's `title` or `name` (in the default locale), else the slug. */
  title: z.string(),
  /**
   * The space's other locales this is not fully translated into: something filled in in the default locale is empty
   * in theirs (docs/build/16-localisation.md). Those parts show the fallback's content.
   */
  missingTranslations: z.array(z.string()),
  status: entryStatusSchema,
  /** The current version is not the published one. */
  hasUnpublishedChanges: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
  /** Set while the entry is in the bin. */
  deletedAt: z.string().nullable(),
});
export type EntrySummary = z.infer<typeof entrySummarySchema>;

export const entrySchema = entrySummarySchema.extend({
  data: dataSchema,
  currentVersionId: z.uuid(),
  publishedVersionId: z.uuid().nullable(),
  /** The published address, which can differ from `path` until the next publish. */
  publishedPath: z.string().nullable(),
});
export type Entry = z.infer<typeof entrySchema>;

/**
 * What lists show for an entry: its `title` or `name` field, else its slug. The API's list query does the same. A
 * translated title is read in `locale` (by default the first translation filled in), else in any locale.
 */
export function entryTitle(data: EntryData, slug: string, locale?: string): string {
  for (const key of ['title', 'name']) {
    const stored = data[key];
    const candidates = isLocaleMap(stored) ? [...(locale ? [stored[locale]] : []), ...Object.values(stored)] : [stored];
    const value = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '');
    if (value) return value.trim();
  }
  return slug;
}

export const listEntriesQuerySchema = z.strictObject({
  contentType: apiIdSchema.optional(),
  /** A folder id, or `root` for entries outside any folder. */
  folderId: z.union([z.uuid(), z.literal('root')]).optional(),
  /** Matches the title or slug, ignoring case. */
  search: z.string().trim().max(100).optional(),
  /** `true` lists the bin instead. */
  deleted: z
    .enum(['true', 'false'], 'Use deleted=true or deleted=false.')
    .optional()
    .transform((value) => value === 'true'),
});
export type ListEntriesQuery = z.input<typeof listEntriesQuerySchema>;

/**
 * The slug comes from the data's `slug` field when the content type has one, else from `slug`, else
 * from the title.
 */
export const createEntryRequestSchema = z.strictObject({
  contentType: apiIdSchema,
  folderId: z.uuid().nullish(),
  slug: slugSchema.optional(),
  data: dataSchema.default({}),
  message: messageSchema,
});
export type CreateEntryRequest = z.input<typeof createEntryRequestSchema>;

/** Saves a new version and makes it the current one. */
export const updateEntryRequestSchema = z.strictObject({
  data: dataSchema,
  message: messageSchema,
});
export type UpdateEntryRequest = z.input<typeof updateEntryRequestSchema>;

/** Overwrites the caller's own autosave if it is recent, otherwise saves a new autosave version. */
export const autosaveEntryRequestSchema = z.strictObject({ data: dataSchema });
export type AutosaveEntryRequest = z.input<typeof autosaveEntryRequestSchema>;

/** Moves an entry to another folder (`null` for the top level). A published entry's address moves at once. */
export const moveEntryRequestSchema = z.strictObject({ folderId: z.uuid().nullable() });
export type MoveEntryRequest = z.input<typeof moveEntryRequestSchema>;

// --- Workflow (docs/build/13-workflow-publishing.md) --------------------------------------------

/** Where a page is in the workflow. A published page with newer, unpublished changes is a `draft` again. */
export const workflowStates = ['draft', 'in_review', 'published', 'archived'] as const;
export type WorkflowState = (typeof workflowStates)[number];

export const workflowActions = ['edit', 'submit', 'approve', 'requestChanges', 'publish', 'unpublish', 'archive', 'restore'] as const;
export type WorkflowAction = (typeof workflowActions)[number];

export const reviewDecisions = ['approved', 'changes_requested', 'withdrawn'] as const;
export type ReviewDecision = (typeof reviewDecisions)[number];

/** A request to review a page, and its outcome. */
export const reviewRequestSchema = z.object({
  id: z.uuid(),
  entryId: z.uuid(),
  versionId: z.uuid(),
  message: z.string().nullable(),
  requestedBy: z.uuid().nullable(),
  requestedByName: z.string().nullable(),
  requestedAt: z.string(),
  decision: z.enum(reviewDecisions).nullable(),
  comment: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
});
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

/** GET `.../entries/:id/workflow`: the page's state, what the caller may do, and its latest review. */
export const entryWorkflowSchema = z.object({
  state: z.enum(workflowStates),
  requireApproval: z.boolean(),
  live: z.boolean(),
  actions: z.array(z.enum(workflowActions)),
  /** The open review request, else the last decided one. */
  review: reviewRequestSchema.nullable(),
});
export type EntryWorkflow = z.infer<typeof entryWorkflowSchema>;

/** A page waiting for review, for the reviewer inbox (GET `.../reviews`). */
export const pendingReviewSchema = reviewRequestSchema.extend({ entry: entrySummarySchema });
export type PendingReview = z.infer<typeof pendingReviewSchema>;

/**
 * POST `.../publish`, `.../submit` and `.../approve`: an optional note. Publishing saves it on the version.
 * The body itself is optional, so API clients can publish with a bare POST.
 */
export const workflowMessageRequestSchema = z.strictObject({ message: messageSchema }).default({});
export type WorkflowMessageRequest = z.input<typeof workflowMessageRequestSchema>;

// --- Scheduling (docs/build/17-scheduling-releases-webhooks.md) ---------------------------------

export const scheduledActionKinds = ['publish', 'unpublish'] as const;
export type ScheduledActionKind = (typeof scheduledActionKinds)[number];

/** scheduled → queued (being carried out) → done | failed; scheduled → cancelled. */
export const scheduledActionStatuses = ['scheduled', 'queued', 'done', 'failed', 'cancelled'] as const;
export type ScheduledActionStatus = (typeof scheduledActionStatuses)[number];

/** A publish or unpublish set for a time (GET `.../entries/:id/schedule`). Times are UTC ISO 8601. */
export const scheduledActionSchema = z.object({
  id: z.uuid(),
  entryId: z.uuid(),
  action: z.enum(scheduledActionKinds),
  runAt: z.string(),
  status: z.enum(scheduledActionStatuses),
  /** Why it failed, in words. */
  error: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ScheduledAction = z.infer<typeof scheduledActionSchema>;

/** POST `.../entries/:id/schedule`: publish or unpublish the page at `runAt`, a future time with its offset. */
export const scheduleActionRequestSchema = z.strictObject({
  action: z.enum(scheduledActionKinds),
  runAt: z.iso.datetime({ offset: true, message: 'Give a date and time, e.g. 2026-10-12T09:00:00Z.' }),
});
export type ScheduleActionRequest = z.input<typeof scheduleActionRequestSchema>;

// --- Releases (docs/build/17-scheduling-releases-webhooks.md) -----------------------------------

/** draft → scheduled → published | failed; scheduled → draft when cancelled. A failed release is a draft that says why. */
export const releaseStatuses = ['draft', 'scheduled', 'published', 'failed'] as const;
export type ReleaseStatus = (typeof releaseStatuses)[number];

/** Pages that go live together (GET `.../releases`). */
export const releaseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(releaseStatuses),
  scheduledAt: z.string().nullable(),
  error: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  publishedBy: z.uuid().nullable(),
  itemCount: z.number().int(),
});
export type Release = z.infer<typeof releaseSchema>;

/** A page in a release, at the version the release publishes. */
export const releaseItemSchema = z.object({
  entryId: z.uuid(),
  versionId: z.uuid(),
  title: z.string(),
  path: z.string(),
  contentType: z.string(),
  /** The version is the page's current one (no newer draft since it was added). */
  current: z.boolean(),
  /** The version is the one on the site now. */
  live: z.boolean(),
  addedAt: z.string(),
});
export type ReleaseItem = z.infer<typeof releaseItemSchema>;

/** GET `.../releases/:id`. */
export const releaseDetailSchema = releaseSchema.extend({ items: z.array(releaseItemSchema) });
export type ReleaseDetail = z.infer<typeof releaseDetailSchema>;

const releaseName = z.string().trim().min(1, 'Give the release a name.').max(120);

export const createReleaseRequestSchema = z.strictObject({ name: releaseName });
export type CreateReleaseRequest = z.input<typeof createReleaseRequestSchema>;

export const updateReleaseRequestSchema = z.strictObject({ name: releaseName });
export type UpdateReleaseRequest = z.input<typeof updateReleaseRequestSchema>;

/** PUT `.../releases/:id/items/:entryId`: the version to publish (the page's current version when left out). */
export const putReleaseItemRequestSchema = z.strictObject({ versionId: z.uuid().optional() }).default({});
export type PutReleaseItemRequest = z.input<typeof putReleaseItemRequestSchema>;

/** POST `.../releases/:id/schedule`. */
export const scheduleReleaseRequestSchema = z.strictObject({
  runAt: z.iso.datetime({ offset: true, message: 'Give a date and time, e.g. 2026-10-12T09:00:00Z.' }),
});
export type ScheduleReleaseRequest = z.input<typeof scheduleReleaseRequestSchema>;

/** POST `.../request-changes`: what to change, for the author. */
export const requestChangesRequestSchema = z.strictObject({
  comment: z.string().trim().min(1, 'Say what should change.').max(2000),
});
export type RequestChangesRequest = z.input<typeof requestChangesRequestSchema>;

// --- Machine translation (docs/build/16-localisation.md) ----------------------------------------

/**
 * POST `.../entries/:id/translate`: fills `to`'s empty translations from `from` (the default locale when left out) with
 * a machine translation, saved as a draft version for a person to check before anyone publishes it.
 */
export const translateEntryRequestSchema = z.strictObject({
  from: localeCodeSchema.optional(),
  to: localeCodeSchema,
});
export type TranslateEntryRequest = z.input<typeof translateEntryRequestSchema>;

export const machineTranslationSchema = z.object({
  /** The entry with the draft as its current version. */
  entry: entrySchema,
  /** The translated values filled in, as dotted paths (`title`, `body.<uid>.heading`). */
  translated: z.array(z.string()),
  /** The service that translated them. */
  provider: z.string(),
});
export type MachineTranslation = z.infer<typeof machineTranslationSchema>;

/** The version message a machine-translated draft is saved with. */
export const machineTranslationMessage = (localeName: string): string =>
  `Machine-translated draft (${localeName}). Check every translation before publishing.`;

// --- Versions -----------------------------------------------------------------------------------

export const entryVersionSchema = z.object({
  id: z.uuid(),
  entryId: z.uuid(),
  message: z.string().nullable(),
  autosave: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  current: z.boolean(),
  published: z.boolean(),
});
export type EntryVersion = z.infer<typeof entryVersionSchema>;

