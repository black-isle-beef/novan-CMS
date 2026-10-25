// Design systems a space uploads and its site loads (docs/build/24-design-systems.md): the Management API's requests
// and answers, and what the Delivery and Preview APIs tell sites to load.
import { designSystemFrameworks } from '@novan/shared-design-system';
import { z } from 'zod';

export const DESIGN_SYSTEMS_BUCKET = 'design-systems';

export const designSystemVersionStatuses = ['uploaded', 'validating', 'invalid', 'ready', 'deprecated'] as const;
export type DesignSystemVersionStatus = (typeof designSystemVersionStatuses)[number];

const semverSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, 'Use a version like 1.2.0.');

export const designSystemSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.');

export const createDesignSystemRequestSchema = z.strictObject({
  name: z.string().trim().min(1, 'Give it a name.').max(80),
  slug: designSystemSlugSchema,
  framework: z.enum(designSystemFrameworks),
});

/** A stylesheet's file name, as the browser sends it; the API stores it under this name. */
const cssFilenameSchema = z
  .string()
  .trim()
  .max(150)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.css$/i, 'Use a .css file whose name has only letters, numbers, dots, hyphens and underscores.');

/**
 * A new version: a stylesheet uploaded from the browser (step 1 answers with where to put it), or one the API
 * fetches from an https address (a CDN's copy of Bootstrap, say) and keeps.
 */
export const createDesignSystemVersionRequestSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('css'), version: semverSchema, filename: cssFilenameSchema }),
  z.strictObject({
    source: z.literal('url'),
    version: semverSchema,
    url: z.url({ protocol: /^https$/, error: 'Use an https address.' }).max(2048),
  }),
]);

export const validationIssueSchema = z.object({
  message: z.string(),
  file: z.string().optional(),
  line: z.number().int().optional(),
});
export type ValidationIssue = z.output<typeof validationIssueSchema>;

/** What checking an upload found. Errors make the version invalid; warnings are for the developer to read. */
export const validationReportSchema = z.object({
  errors: z.array(validationIssueSchema),
  warnings: z.array(validationIssueSchema),
  classes: z.number().int().optional(),
});
export type ValidationReport = z.output<typeof validationReportSchema>;

export const designSystemVersionSchema = z.object({
  id: z.uuid(),
  designSystemId: z.uuid(),
  version: z.string(),
  status: z.enum(designSystemVersionStatuses),
  source: z.enum(['css', 'zip', 'url']),
  sourceUrl: z.string().nullable(),
  filename: z.string().nullable(),
  report: validationReportSchema.nullable(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
export type DesignSystemVersion = z.output<typeof designSystemVersionSchema>;

export const designSystemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  framework: z.enum(designSystemFrameworks),
  createdAt: z.string(),
  /** Newest first. */
  versions: z.array(designSystemVersionSchema),
});
export type DesignSystem = z.output<typeof designSystemSchema>;

export const createDesignSystemVersionResponseSchema = z.object({
  version: designSystemVersionSchema,
  /** Where to `PUT` the stylesheet, for an upload; null when the API fetches it. */
  uploadUrl: z.string().nullable(),
});
export type CreateDesignSystemVersionResponse = z.output<typeof createDesignSystemVersionResponseSchema>;

export const designSystemClassesQuerySchema = z.object({
  /** Classes starting with this. */
  q: z.string().trim().max(120).optional(),
  group: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const designSystemClassSchema = z.object({ name: z.string(), group: z.string().nullable() });
export type DesignSystemClass = z.output<typeof designSystemClassSchema>;

export const designSystemClassesSchema = z.object({
  items: z.array(designSystemClassSchema),
  /** Every group in the version, with how many classes each has (null: no group). */
  groups: z.array(z.object({ group: z.string().nullable(), count: z.number().int() })),
  total: z.number().int(),
});
export type DesignSystemClasses = z.output<typeof designSystemClassesSchema>;

/** A design system version the site loads, in load order. */
export const siteDesignSystemSchema = z.object({
  designSystemId: z.uuid(),
  versionId: z.uuid(),
  name: z.string(),
  slug: z.string(),
  framework: z.enum(designSystemFrameworks),
  version: z.string(),
  status: z.enum(designSystemVersionStatuses),
  loadOrder: z.number().int(),
  enabled: z.boolean(),
  /** How the design system writes breakpoints and states, from its manifest. */
  breakpoints: z.record(z.string(), z.string()).nullable(),
  states: z.record(z.string(), z.string()).nullable(),
});
export type SiteDesignSystem = z.output<typeof siteDesignSystemSchema>;

export const MAX_SITE_DESIGN_SYSTEMS = 10;

/** The versions the site loads, first loaded first; every other one is detached. */
export const putSiteDesignSystemsRequestSchema = z.strictObject({
  items: z
    .array(z.strictObject({ versionId: z.uuid(), enabled: z.boolean().default(true) }))
    .max(MAX_SITE_DESIGN_SYSTEMS, `Attach ${MAX_SITE_DESIGN_SYSTEMS} design systems or fewer.`)
    .refine((items) => new Set(items.map((item) => item.versionId)).size === items.length, 'Each version once.'),
});

/** What a site loads (Delivery and Preview `GET site-styles`). */
export const siteStylesSchema = z.object({
  /** The cascade layer order, also at the top of every stylesheet below. */
  layers: z.string(),
  stylesheets: z.array(z.object({ href: z.string(), designSystem: z.string(), version: z.string() })),
  /** The first design system's framework and templates, for the site's class adapter; null without one. */
  adapter: z
    .object({
      framework: z.string(),
      breakpoints: z.record(z.string(), z.string()).optional(),
      states: z.record(z.string(), z.string()).optional(),
    })
    .nullable(),
});
export type SiteStyles = z.output<typeof siteStylesSchema>;

/** The most classes kept from one version's stylesheets (the rest still work, but are not suggested). */
export const MAX_INDEXED_CLASSES = 20_000;
