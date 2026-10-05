// cms-schema.ts — single source of truth for a block's style options. The seeded block types store the same
// shape as `style_options` (docs/build/05-content-modelling.md); `block-types.spec.ts` keeps them equal.

/** One choice offered to content editors. `label` is what they see; `value` is what is stored. */
export interface CmsOption<V extends string = string> {
  readonly value: V;
  readonly label: string;
}

/** A closed list of choices, rendered as a select (many options) or radio group (few options). */
export interface CmsChoiceField<V extends string = string> {
  readonly kind: 'select' | 'radio';
  readonly label: string;
  /** Short help text shown under the control and linked with aria-describedby. */
  readonly hint?: string;
  readonly options: readonly CmsOption<V>[];
  readonly default: V;
}

/** An on/off option, rendered as a switch. */
export interface CmsToggleField {
  readonly kind: 'toggle';
  readonly label: string;
  readonly hint?: string;
  readonly default: boolean;
}

export type CmsStyleField = CmsChoiceField | CmsToggleField;

/**
 * Maps each property of a settings interface to the field that edits it.
 * The tuple wrapping stops TypeScript distributing over string unions, so a
 * property typed `'left' | 'center'` needs ONE field whose options cover both.
 */
export type CmsStyleSchema<T> = {
  readonly [K in keyof T]-?: [T[K]] extends [boolean] ? CmsToggleField : [T[K]] extends [string] ? CmsChoiceField<T[K]> : never;
};

/** Settings as stored in a block's `_style`: some or all of the keys, values unvalidated. */
export type CmsStoredSettings = Readonly<Record<string, unknown>>;

function entries<T>(schema: CmsStyleSchema<T>): [keyof T & string, CmsStyleField][] {
  return Object.entries(schema) as [keyof T & string, CmsStyleField][];
}

/** The default value of every option. */
export function defaultsOf<T>(schema: CmsStyleSchema<T>): T {
  const result: Record<string, unknown> = {};
  for (const [key, field] of entries(schema)) {
    result[key] = field.default;
  }
  return result as T;
}

/** True when `value` is a legal value for `field`. */
export function isValidValue(field: CmsStyleField, value: unknown): boolean {
  if (field.kind === 'toggle') {
    return typeof value === 'boolean';
  }
  return typeof value === 'string' && field.options.some((option) => option.value === value);
}

/**
 * Turns untrusted CMS data into a complete, valid settings object.
 * Unknown keys are dropped; missing, mistyped or retired values fall back to
 * the default. Never throws, so old content cannot break a page.
 */
export function resolveSettings<T>(schema: CmsStyleSchema<T>, stored: unknown): T {
  const source: CmsStoredSettings =
    stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? (stored as CmsStoredSettings) : {};
  const result: Record<string, unknown> = {};
  for (const [key, field] of entries(schema)) {
    const candidate = source[key];
    result[key] = isValidValue(field, candidate) ? candidate : field.default;
  }
  return result as T;
}

/** Flattened, template-friendly view of a schema used by the editor panel. */
export interface CmsFieldView {
  readonly key: string;
  readonly kind: CmsStyleField['kind'];
  readonly label: string;
  readonly hint: string | null;
  readonly options: readonly CmsOption[];
}

export function fieldViews<T>(schema: CmsStyleSchema<T>): CmsFieldView[] {
  return entries(schema).map(([key, field]) => ({
    key,
    kind: field.kind,
    label: field.label,
    hint: field.hint ?? null,
    options: field.kind === 'toggle' ? [] : field.options,
  }));
}

/** BEM modifier classes for resolved settings, e.g. `novan-hero-block--tone-brand`. */
export function modifierClasses<T>(block: string, schema: CmsStyleSchema<T>, settings: T): string[] {
  const classes: string[] = [];
  for (const [key, field] of entries(schema)) {
    const value = (settings as Record<string, unknown>)[key];
    const name = kebab(key);
    if (field.kind === 'toggle') {
      if (value === true) {
        classes.push(`${block}--${name}`);
      }
    } else {
      classes.push(`${block}--${name}-${String(value)}`);
    }
  }
  return classes;
}

/** `headingLevel` → `heading-level`. */
export function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
