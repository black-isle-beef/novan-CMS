// overrides-schema.ts — Zod validation of a block's `_overrides` (docs/build/24-design-systems.md), used by
// `buildEntrySchema` so the API and the admin accept the same thing. Class names are checked for shape only, not
// against a design system's class index: an unknown class is a warning in the editor, never an invalid page.
import { z } from 'zod';

import {
  BUCKETS,
  CLASS_TOKEN,
  isSafeTokenValue,
  MAX_CLASSES_PER_BUCKET,
  PART_NAME,
  TOKEN_NAME,
  type BlockOverrides,
  type Bucket,
} from './overrides';

export const MAX_OVERRIDE_PARTS = 30;
export const MAX_OVERRIDE_TOKENS = 40;

const classNames = z
  .array(z.string().regex(CLASS_TOKEN, 'Use a class name: letters, numbers and - _ : / . [ ] # % ( ) ! , @ only.'))
  .max(MAX_CLASSES_PER_BUCKET, `Use ${MAX_CLASSES_PER_BUCKET} classes or fewer.`);

const partBucketsSchema = z.strictObject(
  Object.fromEntries(BUCKETS.map((bucket) => [bucket, classNames.optional()])) as Record<Bucket, z.ZodOptional<typeof classNames>>,
);

/** `_overrides` on a block. `css` (scoped custom CSS) is refused until package 24f sanitises it. */
export const blockOverridesSchema: z.ZodType<BlockOverrides> = z.strictObject({
  v: z.uuid().optional(),
  parts: z
    .record(z.string().regex(PART_NAME, 'Use a part name like "heading".'), partBucketsSchema)
    .refine((parts) => Object.keys(parts).length <= MAX_OVERRIDE_PARTS, `Use ${MAX_OVERRIDE_PARTS} parts or fewer.`)
    .optional(),
  tokens: z
    .record(
      z.string().regex(TOKEN_NAME, 'Use a custom property name, like "--color-primary".'),
      z.string().refine(isSafeTokenValue, 'Use a plain value, like "#c9a227" or "2rem".'),
    )
    .refine((tokens) => Object.keys(tokens).length <= MAX_OVERRIDE_TOKENS, `Use ${MAX_OVERRIDE_TOKENS} tokens or fewer.`)
    .optional(),
});
