// manifest.ts — `novan-ds.json`, the manifest of an uploaded design system package (docs/build/24-design-systems.md,
// end-user guide in docs/design-systems.md). The API validates uploads with it and the admin reads its types.
// `novan-ds.schema.json` beside this library is generated from it (manifest.spec.ts) for package authors' editors.
import { z } from 'zod';

import {
  BREAKPOINTS,
  CLASS_TOKEN,
  isClassTemplate,
  PART_NAME,
  ROOT_PART,
  splitClasses,
  STATES,
  TOKEN_NAME,
} from './overrides';

export const designSystemFrameworks = ['css', 'tailwind', 'bootstrap', 'web-components'] as const;
export type DesignSystemFramework = (typeof designSystemFrameworks)[number];

export const componentSsrModes = ['client-only', 'declarative-shadow-dom', 'light-dom'] as const;

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** A path inside the package: forward slashes, no leading slash, no `.` or `..` segments. */
const PACKAGE_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
/** A custom element name: lowercase, starts with a letter, has a hyphen. */
const ELEMENT_TAG = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;
/** Names the HTML spec reserves; `novan-` is kept for the SDK's own elements. */
const RESERVED_TAGS = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);
/** Prop names become field api ids, so they follow the same camelCase rule. */
const PROP_NAME = /^[a-z][a-zA-Z0-9]*$/;

const packagePath = (extensions: string[]) =>
  z
    .string()
    .max(200)
    .regex(PACKAGE_PATH, 'Use a path inside the package, like "css/styles.css".')
    .refine(
      (path) => extensions.some((extension) => path.toLowerCase().endsWith(extension)),
      `Use a ${extensions.join(' or ')} file.`,
    );

const partName = z.string().regex(PART_NAME, 'Use lowercase letters, numbers and hyphens, like "cta".');
const propName = z.string().regex(PROP_NAME, 'Use camelCase, like "buttonText".');
const label = z.string().trim().min(1).max(80);
const description = z.string().max(300);
const titled = { title: label.optional(), description: description.optional() };

const stringProp = z.strictObject({
  type: z.literal('string'),
  ...titled,
  /** How the editor asks for it: one line by default. */
  format: z.enum(['multiline', 'richtext', 'media', 'link']).optional(),
  default: z.string().max(1000).optional(),
  maxLength: z.int().positive().max(10000).optional(),
});

const numberProp = z.strictObject({
  type: z.enum(['number', 'integer']),
  ...titled,
  default: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
});

const booleanProp = z.strictObject({ type: z.literal('boolean'), ...titled, default: z.boolean().optional() });

const enumProp = z
  .strictObject({
    type: z.literal('string').optional(),
    enum: z.array(z.string().min(1).max(40)).min(1).max(30),
    ...titled,
    default: z.string().optional(),
  })
  .refine((prop) => prop.default === undefined || prop.enum.includes(prop.default), {
    message: 'The default must be one of the options.',
    path: ['default'],
  });

const scalarProp = z.union([stringProp, numberProp, booleanProp, enumProp]);

const requiredKnown = (value: { properties: Record<string, unknown>; required?: string[] }, ctx: z.RefinementCtx) => {
  for (const [index, name] of (value.required ?? []).entries()) {
    if (!(name in value.properties))
      ctx.addIssue({ code: 'custom', message: `"${name}" is not one of the properties.`, path: ['required', index] });
  }
};

const arrayProp = z.strictObject({
  type: z.literal('array'),
  ...titled,
  maxItems: z.int().positive().max(100).optional(),
  items: z
    .strictObject({
      type: z.literal('object'),
      properties: z.record(propName, scalarProp),
      required: z.array(propName).optional(),
    })
    .superRefine(requiredKnown),
});

export const componentPropSchema = z.union([scalarProp, arrayProp]);

/** The supported subset of JSON Schema for a component's props; anything else is refused, not ignored. */
export const componentPropsSchema = z
  .strictObject({
    type: z.literal('object'),
    properties: z
      .record(propName, componentPropSchema)
      .refine((properties) => Object.keys(properties).length <= 40, 'Use at most 40 props.'),
    required: z.array(propName).optional(),
  })
  .superRefine(requiredKnown);

const slotSchema = z.strictObject({
  name: z.union([z.literal('default'), partName]),
  /** Block api ids allowed in the slot, or `*` for any. */
  allowedChildren: z.array(z.string().max(64)).max(50).optional(),
});

export const manifestComponentSchema = z
  .strictObject({
    id: z.string().max(64).regex(KEBAB, 'Use kebab-case, like "pricing-card".'),
    /** A custom element defined by the package's script. Give this or `template`. */
    tag: z
      .string()
      .max(64)
      .regex(ELEMENT_TAG, 'Use a custom element name: lowercase, with a hyphen, like "acme-card".')
      .refine((tag) => !RESERVED_TAGS.has(tag) && !tag.startsWith('novan-'), 'That element name is reserved.')
      .optional(),
    /** An HTML template with `{{prop}}` placeholders and `<slot name="...">`. Give this or `tag`. */
    template: z.string().min(1).max(20000).optional(),
    label,
    category: z.string().trim().min(1).max(40).optional(),
    icon: packagePath(['.svg']).optional(),
    description: description.optional(),
    props: componentPropsSchema.default({ type: 'object', properties: {} }),
    slots: z.array(slotSchema).max(10).default([]),
    parts: z.array(partName).min(1).max(30).default([ROOT_PART]),
    /** Parts inside a shadow root: only tokens and `::part()` CSS reach them, never classes. */
    shadowParts: z.array(partName).max(30).default([]),
    defaultClasses: z.record(partName, z.string().max(2000)).default({}),
    ssr: z.enum(componentSsrModes).default('client-only'),
    /** Space kept for a client-only component until it loads, in CSS pixels. */
    placeholder: z
      .strictObject({ height: z.int().min(1).max(4000), width: z.int().min(1).max(4000).optional() })
      .optional(),
  })
  .superRefine((component, ctx) => {
    if ((component.tag === undefined) === (component.template === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Give either a tag or a template.', path: ['tag'] });
    }
    duplicates(component.parts, ctx, ['parts']);
    duplicates(
      component.slots.map((slot) => slot.name),
      ctx,
      ['slots'],
    );
    if (!component.parts.includes(ROOT_PART))
      ctx.addIssue({ code: 'custom', message: 'List the "root" part.', path: ['parts'] });
    for (const [index, part] of component.shadowParts.entries()) {
      if (!component.parts.includes(part))
        ctx.addIssue({ code: 'custom', message: `"${part}" is not one of the parts.`, path: ['shadowParts', index] });
    }
    for (const [part, classes] of Object.entries(component.defaultClasses)) {
      if (!component.parts.includes(part))
        ctx.addIssue({ code: 'custom', message: `"${part}" is not one of the parts.`, path: ['defaultClasses', part] });
      const names = classes.split(/\s+/).filter(Boolean);
      if (names.length !== splitClasses(classes).length) {
        ctx.addIssue({ code: 'custom', message: 'Use class names only.', path: ['defaultClasses', part] });
      }
    }
  });

const tokenSchema = z.strictObject({
  label: label.optional(),
  type: z.enum(['color', 'length', 'number', 'text']).default('text'),
  default: z.string().max(200).optional(),
});

const classTemplate = z.string().refine(isClassTemplate, 'Use a template with one {class}, like "md:{class}".');

export const designSystemManifestSchema = z
  .strictObject({
    $schema: z.string().max(200).optional(),
    name: label,
    version: z.string().max(64).regex(SEMVER, 'Use a semantic version, like "1.2.0".'),
    framework: z.enum(designSystemFrameworks),
    description: description.optional(),
    /** Stylesheets, in the order sites load them. */
    css: z
      .array(packagePath(['.css']))
      .min(1)
      .max(20),
    /** Scripts that define the custom elements (ES modules). */
    js: z
      .array(packagePath(['.js', '.mjs']))
      .max(10)
      .default([]),
    /** Origins whose `@import`s are kept; every other remote import is removed. */
    allowedOrigins: z
      .array(
        z
          .url({ protocol: /^https$/ })
          .refine(
            (url) => new URL(url).origin === url.replace(/\/$/, ''),
            'Use an origin only, like "https://fonts.googleapis.com".',
          ),
      )
      .max(10)
      .default([]),
    /** Groups for the class browser and conflict hints: class prefixes by group, e.g. `{ "spacing": ["p-", "m-"] }`. */
    classGroups: z.record(z.string().regex(KEBAB).max(40), z.array(z.string().regex(CLASS_TOKEN)).max(100)).optional(),
    /** How the framework writes breakpoints and states, when it has its own syntax. */
    breakpoints: z.partialRecord(z.enum(BREAKPOINTS), classTemplate).optional(),
    states: z.partialRecord(z.enum(STATES), classTemplate).optional(),
    /** CSS custom properties editors may set per block. */
    tokens: z
      .record(z.string().regex(TOKEN_NAME, 'Use a custom property name, like "--color-primary".'), tokenSchema)
      .optional(),
    components: z.array(manifestComponentSchema).max(100).default([]),
  })
  .superRefine((manifest, ctx) => {
    duplicates(
      manifest.components.map((component) => component.id),
      ctx,
      ['components'],
    );
    duplicates(
      manifest.components.flatMap((component) => (component.tag ? [component.tag] : [])),
      ctx,
      ['components'],
    );
    if (manifest.components.some((component) => component.tag) && !manifest.js.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Components with a tag need a script that defines them: list it under "js".',
        path: ['js'],
      });
    }
  });

export type DesignSystemManifest = z.output<typeof designSystemManifestSchema>;
export type DesignSystemManifestInput = z.input<typeof designSystemManifestSchema>;
export type ManifestComponent = z.output<typeof manifestComponentSchema>;
export type ManifestComponentInput = z.input<typeof manifestComponentSchema>;
export type ComponentProps = z.output<typeof componentPropsSchema>;
export type ComponentProp = z.output<typeof componentPropSchema>;

/** The manifest written for a CSS-only upload (a stylesheet or a CDN address): no components, a class index only. */
export function cssOnlyManifest(options: {
  name: string;
  version: string;
  framework: DesignSystemFramework;
  css: string;
}): DesignSystemManifest {
  return designSystemManifestSchema.parse({
    name: options.name,
    version: options.version,
    framework: options.framework,
    css: [options.css],
  });
}

/** The manifest's JSON Schema, for package authors (`novan-ds.schema.json`). */
export function manifestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(designSystemManifestSchema, { io: 'input' }) as Record<string, unknown>;
}

function duplicates(values: string[], ctx: z.RefinementCtx, path: (string | number)[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) ctx.addIssue({ code: 'custom', message: `"${value}" is listed twice.`, path });
    seen.add(value);
  }
}
