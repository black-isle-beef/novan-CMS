import { z } from 'zod';
import type { BlockNode, BlockTypeDef, EntryData, FieldDef } from './fields';

// The languages a space publishes in, and translated field values (docs/build/16-localisation.md). Locales are
// managed under /v1/management/spaces/:spaceId/locales and delivered by GET /v1/delivery/locales.
//
// A translated (`localised`) value field stores one value per locale, `{ "en-GB": "Hello", "fr-FR": "Bonjour" }`; every
// other field stores a plain value that all locales share. `group` and `blocks` fields are structure every locale
// shares: the fields inside them are translated when they are marked. A missing translation is read from the locale's
// fallback, then the fallback's fallback, and so on.

/** A language with an optional region, e.g. `en-GB` or `fr`. */
export const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;
export const localeCodeSchema = z.string().regex(LOCALE_CODE_PATTERN, 'Use a language code like fr or fr-FR.');

/** The first part of a locale's addresses on the site, e.g. `fr` in `/fr/about`. */
export const localePrefixSchema = z
  .string()
  .trim()
  .min(1, 'Enter an address prefix.')
  .max(20)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens, like fr.');

/** The most locales a space can have. */
export const MAX_LOCALES = 30;

export const spaceLocaleSchema = z.object({
  code: z.string(),
  /** How editors see it, e.g. `French (France)`. */
  name: z.string(),
  /** Where its missing translations are read from; null for nowhere. */
  fallback: z.string().nullable(),
  /** The locale every page is written in first. It has no fallback and is never prefixed. */
  isDefault: z.boolean(),
  /** Its addresses start with `/<prefix>` when the space uses locale prefixes. */
  prefix: z.string(),
});
export type SpaceLocale = z.infer<typeof spaceLocaleSchema>;

/** GET `/v1/delivery/locales`: a site's locales, and how its addresses show them. */
export const spaceLocalesSchema = z.object({
  /** The default locale first, then by name. */
  locales: z.array(spaceLocaleSchema),
  /** Whether the site serves each other locale under its prefix, e.g. `/fr/about`. */
  prefixes: z.boolean(),
});
export type SpaceLocales = z.infer<typeof spaceLocalesSchema>;

/** GET `/spaces/:spaceId/locales` (management): the same, and whether machine translation is set up. */
export const managedLocalesSchema = spaceLocalesSchema.extend({ machineTranslation: z.boolean() });
export type ManagedLocales = z.infer<typeof managedLocalesSchema>;

const localeNameSchema = z.string().trim().min(1, 'Enter a name.').max(60, 'Use 60 characters or fewer.');

/** POST `/spaces/:spaceId/locales`. Without a prefix, the language code is used (`fr` for `fr-FR`). */
export const createLocaleRequestSchema = z.strictObject({
  code: localeCodeSchema,
  name: localeNameSchema,
  fallback: localeCodeSchema.nullish(),
  prefix: localePrefixSchema.optional(),
});
export type CreateLocaleRequest = z.input<typeof createLocaleRequestSchema>;

/** PATCH `/spaces/:spaceId/locales/:code`. `isDefault: true` makes it the default locale (it loses its fallback). */
export const updateLocaleRequestSchema = z
  .strictObject({
    name: localeNameSchema.optional(),
    fallback: localeCodeSchema.nullable().optional(),
    prefix: localePrefixSchema.optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Change the name, fallback, prefix or default.');
export type UpdateLocaleRequest = z.input<typeof updateLocaleRequestSchema>;

/** PUT `/spaces/:spaceId/locales/prefixes`: whether the site serves other locales under their prefix. */
export const localePrefixesRequestSchema = z.strictObject({ prefixes: z.boolean() });
export type LocalePrefixesRequest = z.input<typeof localePrefixesRequestSchema>;

/**
 * A page's address on the site in `locale`, from its address without a prefix: with locale prefixes on, every locale
 * but the default starts with its prefix (`/fr/about`, and `/fr` for the home page at `/`).
 */
export function localisedPath(path: string, locale: string, settings: SpaceLocales): string {
  const found = settings.locales.find((candidate) => candidate.code === locale);
  if (!settings.prefixes || !found || found.isDefault) return path;
  return path === '/' ? `/${found.prefix}` : `/${found.prefix}${path}`;
}

/** The address prefix a new locale gets: its language, e.g. `fr` for `fr-FR`. */
export function defaultLocalePrefix(code: string): string {
  return code.split('-')[0].toLowerCase();
}

/** What validating and reading translated values needs to know about a space's locales. */
export interface LocaleSettings {
  /** Plain values of translated fields (written before the field was translated) belong to this locale. */
  defaultLocale: string;
  /** The space's locales; values in any other locale are dropped on save. Null accepts any locale code. */
  codes: readonly string[] | null;
}

/** Until a space's locales are known: British English, and any locale code. */
export const ANY_LOCALE: LocaleSettings = { defaultLocale: 'en-GB', codes: null };

export function localeSettings(locales: readonly Pick<SpaceLocale, 'code' | 'isDefault'>[]): LocaleSettings {
  const defaultLocale = locales.find((locale) => locale.isDefault)?.code ?? ANY_LOCALE.defaultLocale;
  return { defaultLocale, codes: locales.map((locale) => locale.code) };
}

/**
 * The locales a value is read from for `code`, in order: the locale itself, then each fallback in turn. Stops at a
 * locale without a fallback, one that is not in the list, or a circle (the database refuses circles anyway).
 */
export function fallbackChain(locales: readonly Pick<SpaceLocale, 'code' | 'fallback'>[], code: string): string[] {
  const byCode = new Map(locales.map((locale) => [locale.code, locale]));
  const chain: string[] = [];
  for (let next: string | null | undefined = code; next && !chain.includes(next); next = byCode.get(next)?.fallback) {
    chain.push(next);
    if (!byCode.has(next)) break;
  }
  return chain;
}

// --- Values -------------------------------------------------------------------------------------

/** A translated value as stored: an object whose keys are all locale codes. `{}` is one with no translations yet. */
export function isLocaleMap(value: unknown): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).every((key) => LOCALE_CODE_PATTERN.test(key));
}

/** Nothing filled in: missing, null, blank text, an empty list or an empty rich text document. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value) && value['type'] === 'doc') return emptyDoc(value);
  return false;
}

/**
 * A translated field's value in one locale, from what is stored: a locale map, or a plain value from before the field
 * was translated, which belongs to the default locale.
 */
export function translationOf(stored: unknown, locale: string, defaultLocale: string): unknown {
  if (isLocaleMap(stored)) return stored[locale];
  return locale === defaultLocale ? stored : undefined;
}

/** The stored value with `locale`'s translation set to `value` (removed when `value` is undefined). */
export function withTranslation(stored: unknown, locale: string, value: unknown, defaultLocale: string): Record<string, unknown> {
  const map: Record<string, unknown> = isLocaleMap(stored)
    ? { ...stored }
    : stored === undefined || stored === null
      ? {}
      : { [defaultLocale]: stored };
  if (value === undefined) delete map[locale];
  else map[locale] = value;
  return map;
}

/** The first translation filled in along `chain`, or null. */
export function firstTranslation(stored: unknown, chain: readonly string[], defaultLocale: string): unknown {
  for (const locale of chain) {
    const value = translationOf(stored, locale, defaultLocale);
    if (!isEmptyValue(value)) return value;
  }
  return null;
}

/**
 * A value of a field that is not translated, as it should be: a locale map left from when the field was translated
 * becomes its default locale's value (or the first one filled in). JSON fields hold any object, so they are left alone.
 */
export function sharedValue(field: FieldDef, stored: unknown, defaultLocale: string): unknown {
  if (field.type === 'json' || !isLocaleMap(stored) || Object.keys(stored).length === 0) return stored;
  if (!isEmptyValue(stored[defaultLocale])) return stored[defaultLocale];
  return Object.values(stored).find((value) => !isEmptyValue(value)) ?? null;
}

/** Whether a field holds a translation per locale: a translated value field (groups and blocks never do). */
export function isTranslated(field: FieldDef): boolean {
  return field.localised && field.type !== 'group' && field.type !== 'blocks';
}

// --- Entry data ---------------------------------------------------------------------------------

type BlockTypes = readonly BlockTypeDef[] | ReadonlyMap<string, BlockTypeDef>;

/**
 * A copy of entry data with every value field's value replaced by `map(field, value, path)`, following the field
 * definitions through groups and blocks. Only keys present in the data are visited. Paths are dotted, with blocks
 * named by `_uid` (`body.<uid>.heading`), as `mediaRefs` names them.
 */
export function mapValueFields(
  fields: readonly FieldDef[],
  data: EntryData,
  blockTypes: BlockTypes,
  map: (field: FieldDef, value: unknown, path: string) => unknown,
): EntryData {
  const types = blockTypes instanceof Map ? blockTypes : new Map((blockTypes as readonly BlockTypeDef[]).map((type) => [type.apiId, type]));

  const mapFields = (defs: readonly FieldDef[], values: unknown, path: string): unknown => {
    if (!isObject(values)) return values;
    const out: EntryData = { ...values };
    for (const field of defs) {
      if (!(field.apiId in out)) continue;
      const at = path ? `${path}.${field.apiId}` : field.apiId;
      const value = out[field.apiId];
      if (field.type === 'group') {
        out[field.apiId] = Array.isArray(value)
          ? value.map((item, index) => mapFields(field.fields, item, `${at}.${index}`))
          : mapFields(field.fields, value, at);
      } else if (field.type === 'blocks') {
        out[field.apiId] = mapNodes(value, at);
      } else {
        out[field.apiId] = map(field, value, at);
      }
    }
    return out;
  };

  const mapNodes = (nodes: unknown, path: string): unknown => {
    if (!Array.isArray(nodes)) return nodes;
    return nodes.map((value) => {
      if (!isObject(value) || typeof value['_block'] !== 'string') return value;
      const node = value as BlockNode;
      const at = `${path}.${typeof node._uid === 'string' ? node._uid : '?'}`;
      const type = types.get(node._block);
      const mapped = (type ? mapFields(type.fields, node, at) : { ...node }) as BlockNode;
      if (Array.isArray(node.children)) mapped.children = mapNodes(node.children, `${at}.children`) as BlockNode[];
      return mapped;
    });
  };

  return mapFields(fields, data, '') as EntryData;
}

/**
 * Entry data as one locale reads it, as client sites get it: each translated value is the first filled in along
 * `chain` (the locale, then its fallbacks), or null; values of fields that are not translated are shared as they are.
 */
export function localiseEntryData(
  fields: readonly FieldDef[],
  data: EntryData,
  chain: readonly string[],
  defaultLocale: string,
  blockTypes: BlockTypes = [],
): EntryData {
  return mapValueFields(fields, data, blockTypes, (field, value) =>
    isTranslated(field) ? firstTranslation(value, chain, defaultLocale) : sharedValue(field, value, defaultLocale),
  );
}

/** Where translated values are filled in: in some locale, and along a chain of locales. */
interface Coverage {
  /** Some translated value is filled in, in any locale. */
  any: boolean;
  /** Some translated value is filled in for a locale of the chain. */
  inChain: boolean;
}

function coverage(fields: readonly FieldDef[], data: EntryData, chain: readonly string[], defaultLocale: string, blockTypes: BlockTypes): Coverage {
  const result: Coverage = { any: false, inChain: false };
  mapValueFields(fields, data, blockTypes, (field, value) => {
    if (!isTranslated(field)) return value;
    const map = isLocaleMap(value) ? value : { [defaultLocale]: value };
    if (Object.values(map).some((translation) => !isEmptyValue(translation))) result.any = true;
    if (chain.some((locale) => !isEmptyValue(map[locale]))) result.inChain = true;
    return value;
  });
  return result;
}

/**
 * Whether an entry exists in a locale: it has something to show along the locale's chain, or nothing translated at
 * all (every locale shows the same). A page in no locale of its chain is not found there.
 */
export function existsInLocale(
  fields: readonly FieldDef[],
  data: EntryData,
  chain: readonly string[],
  defaultLocale: string,
  blockTypes: BlockTypes = [],
): boolean {
  const { any, inChain } = coverage(fields, data, chain, defaultLocale, blockTypes);
  return !any || inChain;
}

/**
 * The translated values `locale` is missing: dotted paths of fields filled in in the default locale but not in
 * `locale` itself (a fallback does not count). Empty for the default locale.
 */
export function missingTranslations(
  fields: readonly FieldDef[],
  data: EntryData,
  locale: string,
  defaultLocale: string,
  blockTypes: BlockTypes = [],
): string[] {
  if (locale === defaultLocale) return [];
  const missing: string[] = [];
  mapValueFields(fields, data, blockTypes, (field, value, path) => {
    if (
      isTranslated(field) &&
      !isEmptyValue(translationOf(value, defaultLocale, defaultLocale)) &&
      isEmptyValue(translationOf(value, locale, defaultLocale))
    ) {
      missing.push(path);
    }
    return value;
  });
  return missing;
}

/** Of `locales`, those (other than the default) with translations missing. */
export function localesMissingTranslations(
  fields: readonly FieldDef[],
  data: EntryData,
  locales: readonly string[],
  defaultLocale: string,
  blockTypes: BlockTypes = [],
): string[] {
  return locales.filter((locale) => missingTranslations(fields, data, locale, defaultLocale, blockTypes).length > 0);
}

// --- Helpers ------------------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A rich text document with no text and nothing but paragraphs. */
function emptyDoc(node: Record<string, unknown>): boolean {
  if (node['type'] === 'text') return typeof node['text'] !== 'string' || node['text'].trim() === '';
  if (node['type'] !== 'doc' && node['type'] !== 'paragraph') return false;
  const content = node['content'];
  return !Array.isArray(content) || content.every((child) => isObject(child) && emptyDoc(child));
}
