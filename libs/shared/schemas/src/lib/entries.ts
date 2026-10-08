import { z } from 'zod';
import { apiIdSchema, type EntryData } from './fields';
import { contentTypeKindSchema } from './content-model';

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
  locale: z.string(),
  /** From the current version's `title` or `name`, else the slug. */
  title: z.string(),
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

/** What lists show for an entry: its `title` or `name` field, else its slug. The API's list query does the same. */
export function entryTitle(data: EntryData, slug: string): string {
  for (const key of ['title', 'name']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
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

/** POST `.../submit` and `.../approve`, and the publish dialog: an optional note. Publishing saves it on the version. */
export const workflowMessageRequestSchema = z.strictObject({ message: messageSchema });
export type WorkflowMessageRequest = z.input<typeof workflowMessageRequestSchema>;

/** POST `.../request-changes`: what to change, for the author. */
export const requestChangesRequestSchema = z.strictObject({
  comment: z.string().trim().min(1, 'Say what should change.').max(2000),
});
export type RequestChangesRequest = z.input<typeof requestChangesRequestSchema>;

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

