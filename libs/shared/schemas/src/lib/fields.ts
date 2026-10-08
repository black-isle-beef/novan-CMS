import { z } from 'zod';

// Field definitions for content types and block types (docs/build/05-content-modelling.md), and
// `buildEntrySchema`, the single validator for entry data used by the API on save and by the admin forms.

/** camelCase identifier used as a key in API payloads and stored entry data. */
export const apiIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*$/, 'Use camelCase: a lowercase letter first, then letters and numbers only.');

/** Stable id of a field definition: survives renaming the field's `apiId` or `label`. */
export const fieldIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Use up to 64 letters, numbers, hyphens or underscores.');

export const fieldTypes = [
  'text',
  'richText',
  'number',
  'boolean',
  'date',
  'select',
  'media',
  'link',
  'reference',
  'blocks',
  'json',
  'group',
] as const;
export type FieldType = (typeof fieldTypes)[number];

/** Tiptap marks a rich text field can allow. */
export const richTextMarks = ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'subscript', 'superscript'] as const;
/** Tiptap block nodes a rich text field can allow (`doc`, `paragraph`, `text` and `listItem` are implied). */
export const richTextNodes = [
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
] as const;
export const mediaKinds = ['image', 'video', 'file'] as const;

const nonNegativeInt = z.int().min(0);

/** Compiles a text field's `pattern`. It must match the whole value. */
export function compilePattern(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`, 'u');
}

function compiles(pattern: string): boolean {
  try {
    compilePattern(pattern);
    return true;
  } catch {
    return false;
  }
}

function checkRange(
  value: { min?: number; max?: number },
  ctx: z.core.$RefinementCtx<unknown>,
  message = 'Minimum must not be more than maximum.',
): void {
  if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
    ctx.addIssue({ code: 'custom', message, path: ['max'] });
  }
}

function checkUnique(values: readonly string[], ctx: z.core.$RefinementCtx<unknown>, what: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) ctx.addIssue({ code: 'custom', message: `${what} "${value}" is used twice.`, path: [index] });
    seen.add(value);
  });
}

const commonProps = {
  id: fieldIdSchema,
  apiId: apiIdSchema,
  label: z.string().trim().min(1).max(120),
  help: z.string().trim().max(500).optional(),
  required: z.boolean().default(false),
  /** Translated per locale. Values stay plain until locales arrive (package 16). */
  localised: z.boolean().default(false),
  /** Kept out of editor forms; the value is still validated. */
  hidden: z.boolean().optional(),
};

const textField = z
  .object({
    ...commonProps,
    type: z.literal('text'),
    multiline: z.boolean().default(false),
    min: nonNegativeInt.optional(),
    max: z.int().min(1).optional(),
    /** Regular expression the whole value must match (Unicode mode). */
    pattern: z.string().min(1).max(500).refine(compiles, 'Not a valid regular expression.').optional(),
  })
  .superRefine((field, ctx) => checkRange(field, ctx));

const richTextField = z.object({
  ...commonProps,
  type: z.literal('richText'),
  marks: z.array(z.enum(richTextMarks)).default(['bold', 'italic', 'link']),
  nodes: z.array(z.enum(richTextNodes)).default(['heading', 'bulletList', 'orderedList']),
});

const numberField = z
  .object({
    ...commonProps,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().default(false),
  })
  .superRefine((field, ctx) => checkRange(field, ctx));

const booleanField = z.object({
  ...commonProps,
  type: z.literal('boolean'),
  default: z.boolean().optional(),
});

const dateField = z.object({
  ...commonProps,
  type: z.literal('date'),
  withTime: z.boolean().default(false),
});

const selectField = z
  .object({
    ...commonProps,
    type: z.literal('select'),
    options: z
      .array(z.object({ value: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(120) }))
      .min(1)
      .max(200),
    multiple: z.boolean().default(false),
  })
  .superRefine((field, ctx) => {
    const seen = new Set<string>();
    field.options.forEach((option, index) => {
      if (seen.has(option.value)) {
        ctx.addIssue({ code: 'custom', message: `Option "${option.value}" is used twice.`, path: ['options', index, 'value'] });
      }
      seen.add(option.value);
    });
  });

const mediaField = z.object({
  ...commonProps,
  type: z.literal('media'),
  accept: z.array(z.enum(mediaKinds)).min(1).default(['image']),
  multiple: z.boolean().default(false),
  requireAlt: z.boolean().default(false),
});

const linkField = z.object({
  ...commonProps,
  type: z.literal('link'),
  allowExternal: z.boolean().default(true),
  allowEmail: z.boolean().default(false),
});

const referenceField = z.object({
  ...commonProps,
  type: z.literal('reference'),
  /** Content type api ids an entry may point to; empty means any. */
  contentTypes: z.array(apiIdSchema).default([]),
  multiple: z.boolean().default(false),
});

const blocksField = z
  .object({
    ...commonProps,
    type: z.literal('blocks'),
    /** Block type api ids allowed in this field; empty means any. */
    allowedBlocks: z.array(apiIdSchema).default([]),
    min: nonNegativeInt.optional(),
    max: z.int().min(1).optional(),
  })
  .superRefine((field, ctx) => checkRange(field, ctx));

const jsonField = z.object({
  ...commonProps,
  type: z.literal('json'),
});

const groupProps = {
  ...commonProps,
  type: z.literal('group'),
  /** A repeatable list of groups (an array of objects) instead of one object. */
  multiple: z.boolean().default(false),
  min: nonNegativeInt.optional(),
  max: z.int().min(1).optional(),
};
type GroupWithoutFields = z.ZodObject<typeof groupProps>;

const simpleFields = [
  textField,
  richTextField,
  numberField,
  booleanField,
  dateField,
  selectField,
  mediaField,
  linkField,
  referenceField,
  blocksField,
  jsonField,
] as const;

// `group` nests a field list, so the types are written out instead of inferred from a recursive schema.
type SimpleFieldDef = z.output<(typeof simpleFields)[number]>;
type SimpleFieldDefInput = z.input<(typeof simpleFields)[number]>;
export type GroupFieldDef = z.output<GroupWithoutFields> & { fields: FieldDef[] };
export type FieldDef = SimpleFieldDef | GroupFieldDef;
/** A field definition as sent by clients: props with defaults may be left out. */
export type FieldDefInput = SimpleFieldDefInput | (z.input<GroupWithoutFields> & { fields: FieldDefInput[] });
export type FieldDefOf<T extends FieldType> = Extract<FieldDef, { type: T }>;

const groupField = z
  .object({
    ...groupProps,
    get fields(): z.ZodType<FieldDef[], FieldDefInput[]> {
      return fieldListSchema.refine((fields) => fields.length > 0, 'Add at least one field to the group.');
    },
  })
  .superRefine((field, ctx) => {
    checkRange(field, ctx);
    if (!field.multiple && (field.min !== undefined || field.max !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Minimum and maximum apply only to repeatable groups.', path: ['multiple'] });
    }
  });

/** One field of a content type or block type. */
export const fieldDefSchema: z.ZodType<FieldDef, FieldDefInput> = z.discriminatedUnion('type', [
  ...simpleFields,
  groupField,
]);

/** An ordered list of fields with unique ids and api ids (also used for the fields of a group). */
export const fieldListSchema: z.ZodType<FieldDef[], FieldDefInput[]> = z
  .array(fieldDefSchema)
  .max(100)
  .superRefine((fields, ctx) => {
    const ids = new Set<string>();
    const apiIds = new Set<string>();
    fields.forEach((field, index) => {
      if (ids.has(field.id)) ctx.addIssue({ code: 'custom', message: `Field id "${field.id}" is used twice.`, path: [index, 'id'] });
      if (apiIds.has(field.apiId)) {
        ctx.addIssue({ code: 'custom', message: `API id "${field.apiId}" is used twice.`, path: [index, 'apiId'] });
      }
      if (field.hidden && field.required && !(field.type === 'boolean' && field.default !== undefined)) {
        ctx.addIssue({ code: 'custom', message: 'A hidden field cannot be required: editors could not fill it in.', path: [index, 'hidden'] });
      }
      ids.add(field.id);
      apiIds.add(field.apiId);
    });
  });

// --- Entry data ---------------------------------------------------------------------------------

/** Entry data: one key per field `apiId`. */
export type EntryData = Record<string, unknown>;

/** What `buildEntrySchema` needs to know about a block type. */
export interface BlockTypeDef {
  apiId: string;
  fields: readonly FieldDef[];
  /** Block types allowed in the block's `children`; empty or missing means no children. */
  allowedChildren?: readonly string[];
}

export interface EntrySchemaOptions {
  /**
   * The block types of the environment. With them, every block in a `blocks` field is validated
   * against its type's fields and `allowedChildren`. Without them, blocks are checked only for their
   * shape (`_uid`, `_block`) and the field's `allowedBlocks`.
   */
  blockTypes?: readonly BlockTypeDef[];
  /**
   * Validate a draft: values may be incomplete (required fields empty, fewer characters or items than
   * the minimum, missing alt text) but never malformed. Publishing validates without this.
   */
  draft?: boolean;
  /**
   * Looks up a media item's asset in the library: `null` when it is not there (or in the bin), `undefined`
   * when the caller does not know. With it, an asset must be of a kind the field accepts and, to publish,
   * must still be in the library; a field with `requireAlt` needs alt text on the item or the asset.
   * Without it (or for unknown assets) only the item's shape is checked.
   */
  assets?: (assetId: string) => MediaAssetInfo | null | undefined;
}

/** What entry validation needs to know about an asset in the media library. */
export interface MediaAssetInfo {
  kind: (typeof mediaKinds)[number];
  alt: string | null;
}

/** A block in a `blocks` field (docs/build/06-entries-versions.md). */
export interface BlockNode {
  _uid: string;
  _block: string;
  /** The block's style options, by settings key: named presets and switches (docs/build/10-blocks-starter-site.md). */
  _style?: BlockStyle;
  /** Kept in the page but not shown on the site (docs/build/12-visual-editor.md). */
  _hidden?: boolean;
  children?: BlockNode[];
  [field: string]: unknown;
}

/** A block's chosen style options, e.g. `{ tone: 'brand', rounded: true }`. */
export type BlockStyle = Record<string, string | boolean>;

/**
 * `_style` holds named presets (`brand`, `h2`) and switches only, never raw values like `#fff`. Values are not
 * checked against the block type's style options: the block component falls back to its default for a value
 * it does not know, so renaming an option never makes stored pages invalid.
 */
const blockStyleSchema = z
  .record(apiIdSchema, z.union([z.string().max(40).regex(/^[a-z][a-z0-9-]*$/, 'Use a named style option.'), z.boolean()]))
  .refine((style) => Object.keys(style).length <= 12, 'Use 12 style options or fewer.');

export const REQUIRED_MESSAGE = 'This field is required.';

const typeError = (expected: string) => ({
  error: (issue: { input?: unknown }) =>
    issue.input === undefined || issue.input === null ? REQUIRED_MESSAGE : `Expected ${expected}.`,
});

/** URL schemes allowed in links: never `javascript:` or `data:`. */
const safeHref = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

const uuid = z.uuid('Expected an id (UUID).');
const jsonValue = z.json();

/**
 * Turns a field list into a Zod validator for entry data. Unknown keys are dropped, so removing a
 * field never makes stored data invalid. Values that are not required may be missing or `null`.
 *
 * This is the single validation path for entry data: the API runs it on save and publish, the admin
 * forms run the same schema for inline errors.
 */
export function buildEntrySchema(fields: readonly FieldDef[], options: EntrySchemaOptions = {}): z.ZodType<EntryData> {
  return new EntrySchemaBuilder(options).object(fields);
}

class EntrySchemaBuilder {
  private readonly blockTypes: ReadonlyMap<string, BlockTypeDef> | null;
  private readonly draft: boolean;
  private readonly assets: EntrySchemaOptions['assets'];
  private readonly nodes = new Map<string, z.ZodObject>();
  private readonly unions = new Map<string, z.ZodType<BlockNode>>();

  constructor(options: EntrySchemaOptions) {
    this.blockTypes = options.blockTypes ? new Map(options.blockTypes.map((type) => [type.apiId, type])) : null;
    this.draft = options.draft ?? false;
    this.assets = options.assets;
  }

  /** Whether an empty value is an error here (never in a draft). */
  private required(field: FieldDef): boolean {
    return field.required && !this.draft;
  }

  /** A minimum length or count to enforce (none in a draft). */
  private min(min: number | undefined): number | undefined {
    return this.draft ? undefined : min;
  }

  object(fields: readonly FieldDef[]): z.ZodObject {
    return z.object(this.shape(fields));
  }

  private shape(fields: readonly FieldDef[]): Record<string, z.ZodType> {
    return Object.fromEntries(fields.map((field) => [field.apiId, this.field(field)]));
  }

  private field(field: FieldDef): z.ZodType {
    if (field.type === 'boolean') {
      const value = z.boolean(typeError('true or false'));
      if (field.default !== undefined) return value.default(field.default);
      return this.required(field) ? value : value.nullish();
    }
    const value = this.value(field);
    return this.required(field) ? value : value.nullish();
  }

  /** Validator for a present value; emptiness counts as missing only when the field is required. */
  private value(field: Exclude<FieldDef, { type: 'boolean' }>): z.ZodType {
    switch (field.type) {
      case 'text':
        return this.text(field);
      case 'richText':
        return this.richText(field);
      case 'number':
        return z.number(typeError('a number')).superRefine((value, ctx) => {
          if (field.integer && !Number.isInteger(value)) ctx.addIssue({ code: 'custom', message: 'Use a whole number.' });
          if (field.min !== undefined && value < field.min) ctx.addIssue({ code: 'custom', message: `Use ${field.min} or more.` });
          if (field.max !== undefined && value > field.max) ctx.addIssue({ code: 'custom', message: `Use ${field.max} or less.` });
        });
      case 'date':
        return field.withTime
          ? z.iso.datetime(typeError('a UTC date and time like 2026-10-03T09:30:00Z'))
          : z.iso.date(typeError('a date like 2026-10-03'));
      case 'select':
        return this.select(field);
      case 'media':
        return this.many(field, this.media(field), field.multiple);
      case 'link':
        return this.link(field);
      case 'reference':
        return this.many(field, uuid, field.multiple, (id) => id);
      case 'blocks':
        return this.blocks(field);
      case 'json':
        // z.json() is a union and reports a missing value as "Invalid input", so check presence first.
        return z.unknown().superRefine((value, ctx) => {
          if (value === undefined || value === null) ctx.addIssue({ code: 'custom', message: REQUIRED_MESSAGE });
          else if (!jsonValue.safeParse(value).success) ctx.addIssue({ code: 'custom', message: 'Expected JSON.' });
        });
      case 'group': {
        const item = this.object(field.fields);
        return field.multiple ? this.list(field, item, field) : item;
      }
    }
  }

  private text(field: FieldDefOf<'text'>): z.ZodType {
    const pattern = field.pattern ? compilePattern(field.pattern) : null;
    const min = this.min(field.min);
    return z.string(typeError('text')).superRefine((value, ctx) => {
      if (value.trim() === '') {
        if (this.required(field)) ctx.addIssue({ code: 'custom', message: REQUIRED_MESSAGE });
        return;
      }
      if (!field.multiline && /[\r\n]/.test(value)) ctx.addIssue({ code: 'custom', message: 'Use a single line.' });
      if (min !== undefined && value.length < min) {
        ctx.addIssue({ code: 'custom', message: `Use at least ${min} characters.` });
      }
      if (field.max !== undefined && value.length > field.max) {
        ctx.addIssue({ code: 'custom', message: `Use ${field.max} characters or fewer.` });
      }
      if (pattern && !pattern.test(value)) ctx.addIssue({ code: 'custom', message: 'This is not in the expected format.' });
    });
  }

  private richText(field: FieldDefOf<'richText'>): z.ZodType {
    const nodes = new Set<string>(['doc', 'paragraph', 'text', ...field.nodes]);
    if (nodes.has('bulletList') || nodes.has('orderedList')) nodes.add('listItem');
    const marks = new Set<string>(field.marks);

    return proseMirrorDoc.superRefine((doc, ctx) => {
      if (isEmptyDoc(doc)) {
        if (this.required(field)) ctx.addIssue({ code: 'custom', message: REQUIRED_MESSAGE });
        return;
      }
      walkProseMirror(doc, [], (node, path) => {
        if (!nodes.has(node.type)) ctx.addIssue({ code: 'custom', message: `"${node.type}" is not allowed here.`, path });
        node.marks?.forEach((mark, index) => {
          const markPath = [...path, 'marks', index];
          if (!marks.has(mark.type)) {
            ctx.addIssue({ code: 'custom', message: `"${mark.type}" formatting is not allowed here.`, path: markPath });
          } else if (mark.type === 'link' && !safeHref.test(String(mark.attrs?.['href'] ?? ''))) {
            ctx.addIssue({ code: 'custom', message: 'Links must start with https://, http://, mailto:, tel:, / or #.', path: markPath });
          }
        });
      });
    });
  }

  private select(field: FieldDefOf<'select'>): z.ZodType {
    const allowed = new Set(field.options.map((option) => option.value));
    const option = z
      .string(typeError('one of the options'))
      .refine((value) => allowed.has(value), 'Choose one of the options.');
    return this.many(field, option, field.multiple, (value) => value);
  }

  private media(field: FieldDefOf<'media'>): z.ZodType {
    // The item's own alt text overrides the library's; empty means "use the library's".
    return z
      .object({ assetId: uuid, alt: z.string().max(500).optional() }, typeError('a media item'))
      .superRefine((item, ctx) => {
        const asset = this.assets?.(item.assetId);
        if (asset === null) {
          if (!this.draft) {
            ctx.addIssue({ code: 'custom', message: 'This file is no longer in the media library. Choose another.', path: ['assetId'] });
          }
          return;
        }
        if (asset && !field.accept.includes(asset.kind)) {
          ctx.addIssue({ code: 'custom', message: `Choose ${acceptedKinds(field.accept)}.`, path: ['assetId'] });
          return;
        }
        if (field.requireAlt && !this.draft && asset && !item.alt?.trim() && !asset.alt?.trim()) {
          ctx.addIssue({ code: 'custom', message: 'Describe the image for people who cannot see it.', path: ['alt'] });
        }
      });
  }

  private link(field: FieldDefOf<'link'>): z.ZodType {
    const text = z.string().trim().max(200).optional();
    const variants: [z.ZodObject, ...z.ZodObject[]] = [
      z.object({ type: z.literal('internal'), entryId: uuid, anchor: z.string().max(100).optional(), text }),
    ];
    if (field.allowExternal) {
      variants.push(
        z.object({
          type: z.literal('external'),
          url: z.url({ protocol: /^https?$/, error: 'Use a full web address starting with https://.' }),
          text,
        }),
      );
    }
    if (field.allowEmail) variants.push(z.object({ type: z.literal('email'), email: z.email(), text }));
    const types = variants.map((variant) => (variant.shape['type'] as z.ZodLiteral<string>).value);

    return z.discriminatedUnion('type', variants, {
      error: (issue) =>
        issue.input === undefined || issue.input === null
          ? REQUIRED_MESSAGE
          : `Use a link of type ${types.join(', ')}.`,
    });
  }

  private blocks(field: FieldDefOf<'blocks'>): z.ZodType {
    return this.list(field, this.blockUnion(field.allowedBlocks), field).superRefine((nodes, ctx) => {
      const seen = new Set<string>();
      walkBlocks(nodes as BlockNode[], [], (node, path) => {
        if (seen.has(node._uid)) ctx.addIssue({ code: 'custom', message: 'Each block needs its own _uid.', path: [...path, '_uid'] });
        seen.add(node._uid);
      });
    });
  }

  /** Blocks allowed at one insertion point (a `blocks` field, or a block's `children`). */
  private blockUnion(allowed: readonly string[]): z.ZodType<BlockNode> {
    const key = allowed.join(',');
    const cached = this.unions.get(key);
    if (cached) return cached;

    let union: z.ZodType<BlockNode>;
    if (!this.blockTypes) {
      const node: z.ZodType<BlockNode> = z.looseObject({
        _uid: uuid,
        _block: allowed.length ? z.enum(allowed as [string, ...string[]], 'This block is not allowed here.') : apiIdSchema,
        _style: blockStyleSchema.optional(),
        _hidden: z.boolean().optional(),
        children: z.array(z.lazy(() => node)).optional(),
      }) as unknown as z.ZodType<BlockNode>;
      union = node;
    } else {
      const blockTypes = this.blockTypes;
      const names = allowed.length ? allowed : [...blockTypes.keys()];
      const known = names.filter((name) => blockTypes.has(name));
      // Built on first parse, so block types that contain themselves do not recurse forever.
      union = z.lazy(() =>
        known.length
          ? z.discriminatedUnion(
              '_block',
              known.map((name) => this.blockNode(name)) as [z.ZodObject, ...z.ZodObject[]],
              { error: () => `Use one of these blocks: ${known.join(', ')}.` },
            )
          : z.never({ error: 'No blocks are allowed here.' }),
      ) as unknown as z.ZodType<BlockNode>;
    }
    this.unions.set(key, union);
    return union;
  }

  private blockNode(apiId: string): z.ZodObject {
    const cached = this.nodes.get(apiId);
    if (cached) return cached;

    const type = this.blockTypes?.get(apiId) as BlockTypeDef;
    const children = type.allowedChildren?.length
      ? z.array(this.blockUnion(type.allowedChildren)).optional()
      : z.undefined({ error: 'This block cannot contain other blocks.' }).optional();
    const node = z.object({
      _uid: uuid,
      _block: z.literal(apiId),
      _style: blockStyleSchema.optional(),
      _hidden: z.boolean().optional(),
      ...this.shape(type.fields),
      children,
    });
    this.nodes.set(apiId, node);
    return node;
  }

  /** A single value, or a non-duplicated array of them when the field takes several. */
  private many(
    field: FieldDef,
    item: z.ZodType,
    multiple: boolean,
    identity?: (value: never) => string,
  ): z.ZodType {
    if (!multiple) return item;
    return this.list(field, item, {}).superRefine((values, ctx) => {
      if (identity) checkUnique((values as never[]).map(identity), ctx, 'Value');
    });
  }

  /** An array that counts as empty when it has no items. */
  private list(field: FieldDef, item: z.ZodType, range: { min?: number; max?: number }) {
    const min = this.min(range.min);
    return z.array(item, typeError('a list')).superRefine((values, ctx) => {
      if (values.length === 0) {
        if (this.required(field)) ctx.addIssue({ code: 'custom', message: REQUIRED_MESSAGE });
        return;
      }
      if (min !== undefined && values.length < min) {
        ctx.addIssue({ code: 'custom', message: `Add at least ${min}.` });
      }
      if (range.max !== undefined && values.length > range.max) {
        ctx.addIssue({ code: 'custom', message: `Add ${range.max} or fewer.` });
      }
    });
  }
}

// --- ProseMirror JSON (Tiptap output) -----------------------------------------------------------

export interface ProseMirrorNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: ProseMirrorNode[];
}

const proseMirrorNode: z.ZodType<ProseMirrorNode> = z.object({
  type: z.string().min(1),
  text: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  marks: z.array(z.object({ type: z.string().min(1), attrs: z.record(z.string(), z.unknown()).optional() })).optional(),
  get content() {
    return z.array(proseMirrorNode).optional();
  },
});

const proseMirrorDoc = z.object(
  {
    type: z.literal('doc', 'Expected a rich text document.'),
    content: z.array(proseMirrorNode).optional(),
  },
  typeError('a rich text document'),
);

function walkProseMirror(
  node: ProseMirrorNode,
  path: (string | number)[],
  visit: (node: ProseMirrorNode, path: (string | number)[]) => void,
): void {
  visit(node, path);
  node.content?.forEach((child, index) => walkProseMirror(child, [...path, 'content', index], visit));
}

function isEmptyDoc(doc: ProseMirrorNode): boolean {
  let empty = true;
  walkProseMirror(doc, [], (node) => {
    if ((node.type === 'text' && node.text?.trim()) || (node.type !== 'doc' && node.type !== 'paragraph' && node.type !== 'text')) {
      empty = false;
    }
  });
  return empty;
}

const kindNames: Record<(typeof mediaKinds)[number], string> = { image: 'an image', video: 'a video', file: 'a file' };

/** "an image", "an image or a video". */
function acceptedKinds(kinds: readonly (typeof mediaKinds)[number][]): string {
  const names = kinds.map((kind) => kindNames[kind]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? 'a file');
}

// --- Media references ---------------------------------------------------------------------------

/** One media item in entry data, and where it is. */
export interface MediaRef {
  assetId: string;
  /** Dotted, with blocks named by `_uid`: `image`, `gallery.2`, `body.<uid>.image`, `seo.ogImage`. */
  path: string;
  /** The page's own alternative text for the item, when it has one. */
  alt?: string;
  /** Whether the field needs alternative text to publish. */
  requireAlt: boolean;
}

/**
 * Every media item in entry data, following the field definitions through groups and blocks (block
 * fields need `blockTypes`). Values of the wrong shape are skipped, so it is safe on unvalidated data.
 */
export function mediaRefs(
  fields: readonly FieldDef[],
  data: EntryData,
  blockTypes: readonly BlockTypeDef[] = [],
): MediaRef[] {
  const types = new Map(blockTypes.map((type) => [type.apiId, type]));
  const refs: MediaRef[] = [];

  const visitFields = (defs: readonly FieldDef[], values: unknown, path: string): void => {
    if (typeof values !== 'object' || values === null || Array.isArray(values)) return;
    for (const field of defs) visitField(field, (values as EntryData)[field.apiId], path ? `${path}.${field.apiId}` : field.apiId);
  };

  const visitNodes = (nodes: unknown, path: string): void => {
    if (!Array.isArray(nodes)) return;
    for (const value of nodes) {
      const node = value as Partial<BlockNode> | null;
      if (typeof node !== 'object' || node === null || typeof node._uid !== 'string') continue;
      const at = `${path}.${node._uid}`;
      const type = typeof node._block === 'string' ? types.get(node._block) : undefined;
      if (type) visitFields(type.fields, node, at);
      visitNodes(node.children, `${at}.children`);
    }
  };

  const visitField = (field: FieldDef, value: unknown, path: string): void => {
    switch (field.type) {
      case 'media': {
        const items = field.multiple ? (Array.isArray(value) ? value : []) : [value];
        items.forEach((item: unknown, index) => {
          const { assetId, alt } = typeof item === 'object' && item !== null ? (item as { assetId?: unknown; alt?: unknown }) : {};
          if (typeof assetId !== 'string') return;
          refs.push({
            assetId,
            path: field.multiple ? `${path}.${index}` : path,
            ...(typeof alt === 'string' && alt.trim() ? { alt } : {}),
            requireAlt: field.requireAlt,
          });
        });
        return;
      }
      case 'group':
        if (field.multiple) {
          if (Array.isArray(value)) value.forEach((item, index) => visitFields(field.fields, item, `${path}.${index}`));
        } else {
          visitFields(field.fields, value, path);
        }
        return;
      case 'blocks':
        visitNodes(value, path);
        return;
    }
  };

  visitFields(fields, data, '');
  return refs;
}

function walkBlocks(
  nodes: readonly BlockNode[],
  path: (string | number)[],
  visit: (node: BlockNode, path: (string | number)[]) => void,
): void {
  nodes.forEach((node, index) => {
    visit(node, [...path, index]);
    if (Array.isArray(node.children)) walkBlocks(node.children, [...path, index, 'children'], visit);
  });
}
