// overrides.ts — per-block class overrides (`_overrides`, docs/build/24-design-systems.md): the buckets an editor
// fills in, the adapters that turn them into a framework's class names, and the cascade layers every site declares.
// Dependency-free on purpose: the SDK carries a copy (libs/cms-angular/src/lib/overrides.ts) that its spec holds in
// step with this one, as with the bridge protocol.

export const BREAKPOINTS = ['sm', 'md', 'lg', 'xl'] as const;
export const STATES = ['hover', 'focus', 'active', 'dark'] as const;
/** Every bucket, in the order their classes are emitted. */
export const BUCKETS = ['base', ...BREAKPOINTS, ...STATES] as const;

export type Breakpoint = (typeof BREAKPOINTS)[number];
export type State = (typeof STATES)[number];
export type Bucket = (typeof BUCKETS)[number];

/** One part's classes, by logical breakpoint or state. Class names are stored bare (`px-8`, not `md:px-8`). */
export type PartBuckets = { readonly [B in Bucket]?: readonly string[] };

/** A block's `_overrides`. */
export interface BlockOverrides {
  /** The design system version the classes were checked against, when there is one. */
  readonly v?: string;
  readonly parts?: Readonly<Record<string, PartBuckets>>;
  /** CSS custom properties set on the block, e.g. `{ '--color-primary': '#c9a227' }`. */
  readonly tokens?: Readonly<Record<string, string>>;
  /** Scoped CSS for this block (behind a feature flag; sanitised by the API). */
  readonly css?: string;
}

/** The part every block has: its host element. */
export const ROOT_PART = 'root';
export const PART_NAME = /^[a-z][a-z0-9-]{0,39}$/;
/** What a class name may contain before it is put on an element (always through `classList`, never in markup). */
export const CLASS_TOKEN = /^[A-Za-z0-9_\-:/.[\]#%()!,@]{1,120}$/;
export const MAX_CLASSES_PER_BUCKET = 50;
export const TOKEN_NAME = /^--[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const MAX_TOKEN_VALUE = 200;

/** The cascade layers, lowest first. Overrides come last so they beat the design system's own styles. */
export const CASCADE_LAYERS = ['novan-base', 'ds-vendor', 'ds-components', 'novan-overrides'] as const;
export type CascadeLayer = (typeof CASCADE_LAYERS)[number];

/** The layer order statement each site puts before all other CSS. */
export function cascadeLayers(): string {
  return `@layer ${CASCADE_LAYERS.join(', ')};`;
}

/** The class names a design system defines (its class index). */
export interface ClassIndex {
  has(className: string): boolean;
}

/** Turns logical buckets into one framework's class names. */
export interface ClassAdapter {
  readonly framework: string;
  /** The breakpoints and states the editor offers; `base` is always offered. */
  readonly breakpoints: readonly Breakpoint[];
  readonly states: readonly State[];
  toClassList(buckets: PartBuckets): string[];
  /** A well-formed class name that the index (when given) knows. */
  isValid(className: string, index?: ClassIndex): boolean;
}

export function isClassToken(value: unknown): value is string {
  return typeof value === 'string' && CLASS_TOKEN.test(value);
}

/** A space-separated class list, keeping only well-formed names. */
export function splitClasses(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(isClassToken) : [];
}

const PLACEHOLDER = '{class}';
/** A class template has one `{class}` and otherwise only characters a class name may have. */
const TEMPLATE = /^[A-Za-z0-9_\-:@/.]*\{class\}[A-Za-z0-9_\-:@/.]*$/;

export function isClassTemplate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 60 && TEMPLATE.test(value);
}

/** How a design system writes a breakpoint or state, e.g. `{ md: 'md:{class}' }` or `{ md: '{class}@md' }`. */
export interface ClassTemplates {
  readonly breakpoints?: Readonly<Partial<Record<Breakpoint, string>>>;
  readonly states?: Readonly<Partial<Record<State, string>>>;
}

/**
 * An adapter that writes each bucket's classes through a template. Buckets without a (valid) template are not
 * offered and their classes are left out, so a framework with no responsive syntax gets the base bucket only.
 */
export function createTemplateAdapter(framework: string, templates: ClassTemplates = {}): ClassAdapter {
  const byBucket = new Map<Bucket, string>([['base', PLACEHOLDER]]);
  for (const breakpoint of BREAKPOINTS) {
    const template = templates.breakpoints?.[breakpoint];
    if (isClassTemplate(template)) byBucket.set(breakpoint, template);
  }
  for (const state of STATES) {
    const template = templates.states?.[state];
    if (isClassTemplate(template)) byBucket.set(state, template);
  }
  return {
    framework,
    breakpoints: BREAKPOINTS.filter((breakpoint) => byBucket.has(breakpoint)),
    states: STATES.filter((state) => byBucket.has(state)),
    toClassList(buckets) {
      const classes: string[] = [];
      for (const bucket of BUCKETS) {
        const template = byBucket.get(bucket);
        const names = buckets[bucket];
        if (!template || !Array.isArray(names)) continue;
        for (const name of names.slice(0, MAX_CLASSES_PER_BUCKET)) {
          if (isClassToken(name)) classes.push(template.replace(PLACEHOLDER, name));
        }
      }
      return unique(classes.filter(isClassToken));
    },
    isValid(className, index) {
      return isClassToken(className) && (index?.has(className) ?? true);
    },
  };
}

/** Plain CSS: the base bucket only. */
export const plainAdapter: ClassAdapter = createTemplateAdapter('css');

/**
 * Each part's final classes: the component's default classes, then the block's overrides through the adapter.
 * Overrides come from stored page data, so anything malformed is skipped rather than trusted.
 */
export function mergeOverrides(
  defaults: Readonly<Record<string, string>> | null | undefined,
  overrides: BlockOverrides | null | undefined,
  adapter: ClassAdapter = plainAdapter,
): Record<string, string[]> {
  const merged = new Map<string, string[]>();
  const add = (part: string, classes: string[]) => {
    if (!PART_NAME.test(part) || !classes.length) return;
    merged.set(part, unique([...(merged.get(part) ?? []), ...classes]));
  };
  if (isRecord(defaults)) {
    for (const [part, classes] of Object.entries(defaults)) add(part, splitClasses(classes));
  }
  const parts = isRecord(overrides) ? overrides['parts'] : undefined;
  if (isRecord(parts)) {
    for (const [part, buckets] of Object.entries(parts)) {
      if (isRecord(buckets)) add(part, adapter.toClassList(buckets as PartBuckets));
    }
  }
  return Object.fromEntries(merged);
}

/** A token value that cannot end the declaration, open a block or load anything. */
export function isSafeTokenValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TOKEN_VALUE &&
    !/[;{}<>\\]/.test(value) &&
    !/url\s*\(|expression\s*\(|@import/i.test(value)
  );
}

/** The block's token overrides that are safe to set as inline custom properties. */
export function overrideTokens(overrides: BlockOverrides | null | undefined): [name: string, value: string][] {
  const tokens = isRecord(overrides) ? overrides['tokens'] : undefined;
  if (!isRecord(tokens)) return [];
  return Object.entries(tokens).filter(
    (entry): entry is [string, string] => TOKEN_NAME.test(entry[0]) && isSafeTokenValue(entry[1]),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
