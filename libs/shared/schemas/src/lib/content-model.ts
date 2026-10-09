import { z } from 'zod';
import { apiIdSchema, fieldDefSchema, fieldListSchema } from './fields';

// Content types and block types (docs/build/05-content-modelling.md), served under
// /v1/management/spaces/:spaceId/environments/:env/{content-types,block-types}.

/** An environment name in a path, e.g. `main`. */
export const environmentNameSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.');

export const contentTypeKinds = ['page', 'entry', 'singleton'] as const;
export const contentTypeKindSchema = z.enum(contentTypeKinds);
export type ContentTypeKind = z.infer<typeof contentTypeKindSchema>;

const nameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().max(500).nullish();

// --- Content types ------------------------------------------------------------------------------

export const contentTypeSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  environmentId: z.uuid(),
  apiId: apiIdSchema,
  name: z.string(),
  kind: contentTypeKindSchema,
  description: z.string().nullable(),
  fields: z.array(fieldDefSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentType = z.infer<typeof contentTypeSchema>;

/** A content type's fields. A top-level `slug` is the page's address in every locale, so it is never translated. */
export const contentTypeFieldListSchema = fieldListSchema.superRefine((fields, ctx) => {
  fields.forEach((field, index) => {
    if (field.apiId === 'slug' && field.localised) {
      ctx.addIssue({ code: 'custom', message: 'The slug is the address in every language, so it cannot be translated.', path: [index, 'localised'] });
    }
  });
});

export const createContentTypeRequestSchema = z.strictObject({
  apiId: apiIdSchema,
  name: nameSchema,
  kind: contentTypeKindSchema,
  description: descriptionSchema,
  fields: contentTypeFieldListSchema.default([]),
});
export type CreateContentTypeRequest = z.input<typeof createContentTypeRequestSchema>;

/** `apiId` and `kind` are fixed once created: entries, references and the delivery API depend on them. */
export const updateContentTypeRequestSchema = z
  .strictObject({
    name: nameSchema.optional(),
    description: descriptionSchema,
    fields: contentTypeFieldListSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one of name, description or fields.');
export type UpdateContentTypeRequest = z.input<typeof updateContentTypeRequestSchema>;

// --- Style options (the `create-angular-cms-component` skill's CmsStyleSchema, stored as JSON) --

/** A named preset such as `brand`, `wide` or `h2`. Raw values (`#fff`, `12px`) are not allowed. */
export const styleOptionValueSchema = z
  .string()
  .max(40)
  .regex(/^[a-z][a-z0-9-]*$/, 'Use a named preset like "brand" or "wide", not a raw value.');

const styleFieldCommon = {
  label: z.string().trim().min(1).max(80),
  hint: z.string().trim().max(200).optional(),
};

function checkChoice(field: { options: { value: string }[]; default: string }, ctx: z.core.$RefinementCtx<unknown>): void {
  const values = field.options.map((option) => option.value);
  values.forEach((value, index) => {
    if (values.indexOf(value) !== index) {
      ctx.addIssue({ code: 'custom', message: `Option "${value}" is used twice.`, path: ['options', index, 'value'] });
    }
  });
  if (!values.includes(field.default)) {
    ctx.addIssue({ code: 'custom', message: 'The default must be one of the options.', path: ['default'] });
  }
}

const styleChoiceShape = {
  ...styleFieldCommon,
  options: z
    .array(z.object({ value: styleOptionValueSchema, label: z.string().trim().min(1).max(80) }))
    .min(1)
    .max(30),
  default: styleOptionValueSchema,
};

export const styleFieldSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('select'), ...styleChoiceShape }).superRefine(checkChoice),
  z.object({ kind: z.literal('radio'), ...styleChoiceShape }).superRefine(checkChoice),
  z.object({ kind: z.literal('toggle'), ...styleFieldCommon, default: z.boolean() }),
]);
export type StyleField = z.infer<typeof styleFieldSchema>;

/** Settings key (camelCase, as in the component's settings interface) to the field that edits it. */
export const styleOptionsSchema = z
  .record(apiIdSchema, styleFieldSchema)
  .refine((options) => Object.keys(options).length <= 12, 'Offer 12 style options or fewer.');
export type StyleOptions = z.infer<typeof styleOptionsSchema>;

// --- Block types --------------------------------------------------------------------------------

/** `children` is reserved in block data for nested blocks (docs/build/06-entries-versions.md). */
export const blockFieldListSchema = fieldListSchema.superRefine((fields, ctx) => {
  fields.forEach((field, index) => {
    if (field.apiId === 'children') {
      ctx.addIssue({ code: 'custom', message: '"children" is reserved for nested blocks.', path: [index, 'apiId'] });
    }
  });
});

const uniqueApiIds = z
  .array(apiIdSchema)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'List each block type once.');

/** A Bootstrap Icons name, e.g. `image` or `layout-text-window`. */
export const iconNameSchema = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use a Bootstrap Icons name like "image".');

export const blockTypeSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  environmentId: z.uuid(),
  apiId: apiIdSchema,
  name: z.string(),
  icon: z.string().nullable(),
  previewImagePath: z.string().nullable(),
  fields: z.array(fieldDefSchema),
  allowedChildren: z.array(apiIdSchema),
  styleOptions: styleOptionsSchema,
  /** Goes up by one whenever fields, allowed children or style options change. */
  schemaVersion: z.int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BlockType = z.infer<typeof blockTypeSchema>;

export const createBlockTypeRequestSchema = z.strictObject({
  apiId: apiIdSchema,
  name: nameSchema,
  icon: iconNameSchema.nullish(),
  previewImagePath: z.string().trim().max(500).nullish(),
  fields: blockFieldListSchema.default([]),
  allowedChildren: uniqueApiIds.default([]),
  styleOptions: styleOptionsSchema.default({}),
});
export type CreateBlockTypeRequest = z.input<typeof createBlockTypeRequestSchema>;

export const updateBlockTypeRequestSchema = z
  .strictObject({
    name: nameSchema.optional(),
    icon: iconNameSchema.nullish(),
    previewImagePath: z.string().trim().max(500).nullish(),
    fields: blockFieldListSchema.optional(),
    allowedChildren: uniqueApiIds.optional(),
    styleOptions: styleOptionsSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one property to change.');
export type UpdateBlockTypeRequest = z.input<typeof updateBlockTypeRequestSchema>;

// --- Changes that would invalidate entries ------------------------------------------------------

/** `?force=true` applies a model change even though it makes existing entries invalid. */
export const forceQuerySchema = z
  .enum(['true', 'false'], 'Use force=true or force=false.')
  .optional()
  .transform((value) => value === 'true');

/** Extension members of the 409 `entries_invalidated` problem. */
export interface EntriesInvalidatedProblem {
  code: 'entries_invalidated';
  /** Entries that would fail validation after the change. */
  affectedEntries: number;
}
