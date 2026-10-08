import { z } from 'zod';
import { apiIdSchema } from './fields';

// API tokens (managed under /v1/management/spaces/:spaceId/api-tokens) and the Delivery and Preview APIs
// client sites read content from (/v1/delivery/..., /v1/preview/...). docs/build/08-delivery-preview-api.md

// --- API tokens ---------------------------------------------------------------------------------

export const apiTokenScopes = ['delivery', 'preview'] as const;
export const apiTokenScopeSchema = z.enum(apiTokenScopes);
export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

/** What a token starts with, so people (and secret scanners) can tell what it is. */
export const API_TOKEN_PREFIXES: Readonly<Record<ApiTokenScope, string>> = {
  delivery: 'nv_del_',
  preview: 'nv_pre_',
};

export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scope: apiTokenScopeSchema,
  /** The environment it reads, e.g. `main`. */
  environment: z.string(),
  /** The prefix and last four characters, e.g. `nv_del_…a1b2`. The token itself is shown only once. */
  hint: z.string(),
  createdBy: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  /** Updated at most once a minute. */
  lastUsedAt: z.string().nullable(),
  /** Set once the token stops working. */
  revokedAt: z.string().nullable(),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;

export const createApiTokenRequestSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name.').max(120, 'Use 120 characters or fewer.'),
  scope: apiTokenScopeSchema,
  environment: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use an environment name like main.')
    .default('main'),
});
export type CreateApiTokenRequest = z.input<typeof createApiTokenRequestSchema>;

/** The new token, with its secret. This is the only time the secret is sent. */
export const createdApiTokenSchema = apiTokenSchema.extend({ token: z.string() });
export type CreatedApiToken = z.infer<typeof createdApiTokenSchema>;

// --- Signed preview tokens (visual editor, package 12) ------------------------------------------

/** How long a signed preview token works; the admin asks for a new one before then. */
export const PREVIEW_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * A signed preview token for one page, from `POST .../entries/:id/preview-token`. The admin opens the site
 * with `?novan_preview=<token>`; the site's server checks it with `GET /v1/preview/session`.
 */
export const signedPreviewTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
export type SignedPreviewToken = z.infer<typeof signedPreviewTokenSchema>;

/** What `GET /v1/preview/session` says about a valid signed token. */
export const previewSessionSchema = z.object({
  /** The page being edited. */
  entryId: z.uuid(),
  expiresAt: z.string(),
  /** The admin's origin: the only one the site's bridge takes messages from. */
  adminOrigin: z.string(),
});
export type PreviewSession = z.infer<typeof previewSessionSchema>;

/**
 * `POST .../entries/:id/preview-data`: the visual editor's unsaved data for the page, to be returned as the
 * Preview API would deliver it (the bridge's `update` needs that shape). The data is checked as a draft.
 */
export const previewDataRequestSchema = z.strictObject({
  data: z.record(z.string(), z.unknown()),
  /** How deep to expand references, as the site's own requests do (0 to 3). */
  include: z.int().min(0).max(3).default(1),
});
export type PreviewDataRequest = z.input<typeof previewDataRequestSchema>;

// --- Delivery and Preview: responses ------------------------------------------------------------

/**
 * One page or entry as client sites get it. In `data`, media items are expanded to `DeliveryAsset`,
 * references to other entries are expanded to `DeliveryEntry` up to the `include` depth (deeper, or back
 * to an entry already being expanded, they stay `{ id }`), and internal links gain the `path` of the page
 * they point to. References to anything not published (or, in preview, in the bin) are left out.
 */
export interface DeliveryEntry {
  id: string;
  /** Content type api id. */
  contentType: string;
  /** Folder path and slug, e.g. `/blog/hello-world`; the top-level `home` page is `/`. */
  path: string;
  locale: string;
  /** Delivery: when this version went live. Preview: when it was last saved. */
  updatedAt: string;
  data: Record<string, unknown>;
}

export const deliveryEntrySchema: z.ZodType<DeliveryEntry> = z.object({
  id: z.uuid(),
  contentType: z.string(),
  path: z.string(),
  locale: z.string(),
  updatedAt: z.string(),
  data: z.record(z.string(), z.unknown()),
});

/** A reference left unexpanded: too deep for `include`, or a loop back to an entry being expanded. */
export const deliveryLinkSchema = z.object({ id: z.uuid() });
export type DeliveryLink = z.infer<typeof deliveryLinkSchema>;

export const deliveryEntriesPageSchema = z.object({
  items: z.array(deliveryEntrySchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type DeliveryEntriesPage = z.infer<typeof deliveryEntriesPageSchema>;

export const sitemapSchema = z.object({
  items: z.array(z.object({ path: z.string(), locale: z.string(), updatedAt: z.string() })),
});
export type Sitemap = z.infer<typeof sitemapSchema>;

// --- Delivery and Preview: queries --------------------------------------------------------------

/** The top-level page with this slug is the site's home page, at `/`. */
export const HOME_SLUG = 'home';

/** A page's address on the site from its stored path: the top-level `home` page is `/`. */
export const sitePath = (path: string): string => (path === `/${HOME_SLUG}` ? '/' : path);

/** `/` (the home page) or a folder path and slug like `/blog/hello-world`. A trailing slash is ignored. */
export const deliveryPathSchema = z
  .string()
  .trim()
  .max(1000)
  .transform((path) => (path.length > 1 ? path.replace(/\/+$/, '') : path))
  .pipe(z.string().regex(/^\/$|^(\/[a-z0-9]+(-[a-z0-9]+)*)+$/, 'Use a path like / or /blog/hello-world.'));

const localeSchema = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Use a locale like en-GB.');

/** How deep to expand references: 0 leaves them as `{ id }`, at most 3. */
const includeSchema = z.coerce
  .number('Use a depth from 0 to 3.')
  .int('Use a depth from 0 to 3.')
  .min(0, 'Use a depth from 0 to 3.')
  .max(3, 'Use a depth from 0 to 3.')
  .default(1);

/** `fields.title,fields.image`: only these fields of `data`. */
const selectSchema = z
  .string()
  .max(1000)
  .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
  .pipe(
    z
      .array(z.string().regex(/^fields\.[a-z][a-zA-Z0-9]*$/, 'Select fields like fields.title,fields.image.'))
      .min(1)
      .max(50)
      .transform((parts) => [...new Set(parts.map((part) => part.slice('fields.'.length)))]),
  )
  .optional();

export const deliveryPageQuerySchema = z.strictObject({
  path: deliveryPathSchema,
  /** Defaults to the space's default locale. */
  locale: localeSchema.optional(),
  include: includeSchema,
  select: selectSchema,
});
export type DeliveryPageQuery = z.input<typeof deliveryPageQuerySchema>;

export const deliveryEntryQuerySchema = z.strictObject({ include: includeSchema, select: selectSchema });
export type DeliveryEntryQuery = z.input<typeof deliveryEntryQuerySchema>;

export const deliverySingletonQuerySchema = z.strictObject({
  locale: localeSchema.optional(),
  include: includeSchema,
  select: selectSchema,
});
export type DeliverySingletonQuery = z.input<typeof deliverySingletonQuerySchema>;

export const sitemapQuerySchema = z.strictObject({ locale: localeSchema.optional() });
export type SitemapQuery = z.input<typeof sitemapQuerySchema>;

export const fieldFilterOps = ['eq', 'in', 'lt', 'gt'] as const;
export type FieldFilterOp = (typeof fieldFilterOps)[number];

/** `fields.<field>[<op>]=<value>`; `in` takes a comma-separated list. */
export interface FieldFilter {
  field: string;
  op: FieldFilterOp;
  value: string | string[];
}

/** `updatedAt`, `path` or `fields.<field>`, ascending; a leading `-` for descending. */
export const deliverySortSchema = z
  .string()
  .regex(/^-?(updatedAt|path|fields\.[a-z][a-zA-Z0-9]*)$/, 'Sort by updatedAt, path or fields.<field>, with - for descending.')
  .default('-updatedAt');

export const MAX_FIELD_FILTERS = 10;

const entriesParams = {
  /** Content type api id; needed to filter or sort by fields. */
  type: apiIdSchema.optional(),
  locale: localeSchema.optional(),
  sort: deliverySortSchema,
  limit: z.coerce.number('Use a limit from 1 to 100.').int().min(1, 'Use a limit from 1 to 100.').max(100, 'Use a limit from 1 to 100.').default(25),
  cursor: z.string().max(1000).regex(/^[A-Za-z0-9_-]+$/, 'Use the nextCursor of the previous page.').optional(),
  include: includeSchema,
  select: selectSchema,
};
const entriesParamNames = new Set(Object.keys(entriesParams));

/**
 * `GET entries`: the named parameters plus field filters, `fields.title[eq]=Hello` (`fields.title=Hello`
 * means `eq`). Express's simple query parser keeps `fields.title[eq]` as the key; the extended one (qs)
 * nests it as `{ 'fields.title': { eq: 'Hello' } }`. Both are read.
 */
export const deliveryEntriesQuerySchema = z
  .looseObject(entriesParams)
  .transform((query, ctx) => {
    const filters: FieldFilter[] = [];
    for (const [key, raw] of Object.entries(query)) {
      if (entriesParamNames.has(key)) continue;
      const match = /^fields\.([a-z][a-zA-Z0-9]*)(?:\[([^\]]*)\])?$/.exec(key);
      const field = match?.[1];
      if (!field) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Unknown parameter. Filter with fields.<field>[eq|in|lt|gt]=<value>.' });
        continue;
      }
      const op = match[2];
      const ops: unknown = op !== undefined ? { [op]: raw } : typeof raw === 'string' ? { eq: raw } : raw;
      if (typeof ops !== 'object' || ops === null || Array.isArray(ops)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Give this filter once, like fields.title[eq]=Hello.' });
        continue;
      }
      for (const [op, value] of Object.entries(ops)) {
        if (!(fieldFilterOps as readonly string[]).includes(op)) {
          ctx.addIssue({ code: 'custom', path: [key, op], message: 'Use eq, in, lt or gt.' });
        } else if (typeof value !== 'string' || value.length > 500) {
          ctx.addIssue({ code: 'custom', path: [key, op], message: 'Give this filter once, with up to 500 characters.' });
        } else {
          const list = value.split(',').filter(Boolean);
          if (op === 'in' && (list.length === 0 || list.length > 100)) {
            ctx.addIssue({ code: 'custom', path: [key, op], message: 'List 1 to 100 values, separated by commas.' });
          } else {
            filters.push({ field, op: op as FieldFilterOp, value: op === 'in' ? list : value });
          }
        }
      }
    }
    if (filters.length > MAX_FIELD_FILTERS) {
      ctx.addIssue({ code: 'custom', path: [], message: `Use ${MAX_FIELD_FILTERS} field filters or fewer.` });
    }
    const sortsByField = query.sort.replace(/^-/, '').startsWith('fields.');
    if ((filters.length || sortsByField) && !query.type) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'Give the type to filter or sort by its fields.' });
    }
    return {
      type: query.type,
      locale: query.locale,
      sort: query.sort,
      limit: query.limit,
      cursor: query.cursor,
      include: query.include,
      select: query.select,
      filters,
    };
  });
export type DeliveryEntriesQuery = z.input<typeof deliveryEntriesQuerySchema> & Record<string, unknown>;
