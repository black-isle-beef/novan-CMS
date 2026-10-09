import { type BlockTypeDef, type FieldDef, type FieldDefInput, fieldListSchema, mediaRefs } from './fields';
import {
  createLocaleRequestSchema,
  defaultLocalePrefix,
  existsInLocale,
  fallbackChain,
  isEmptyValue,
  isLocaleMap,
  localeSettings,
  localesMissingTranslations,
  localiseEntryData,
  localisedPath,
  missingTranslations,
  translationOf,
  withTranslation,
} from './locales';

const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const defs = (...fields: FieldDefInput[]): FieldDef[] => fieldListSchema.parse(fields);

const locales = [
  { code: 'en-GB', name: 'English', fallback: null, isDefault: true, prefix: 'en' },
  { code: 'fr-FR', name: 'French', fallback: 'en-GB', isDefault: false, prefix: 'fr' },
  { code: 'fr-CA', name: 'Canadian French', fallback: 'fr-FR', isDefault: false, prefix: 'fr-ca' },
  { code: 'cy-GB', name: 'Welsh', fallback: null, isDefault: false, prefix: 'cy' },
];

const page = defs(
  { id: 't', apiId: 'title', label: 'Title', type: 'text', localised: true },
  { id: 's', apiId: 'slug', label: 'Slug', type: 'text' },
  {
    id: 'seo',
    apiId: 'seo',
    label: 'SEO',
    type: 'group',
    fields: [
      { id: 'd', apiId: 'description', label: 'Description', type: 'text', localised: true },
      { id: 'n', apiId: 'noindex', label: 'No index', type: 'boolean' },
    ],
  },
  { id: 'b', apiId: 'body', label: 'Body', type: 'blocks' },
);
const blockTypes: BlockTypeDef[] = [
  {
    apiId: 'hero',
    fields: defs(
      { id: 'h', apiId: 'heading', label: 'Heading', type: 'text', localised: true },
      { id: 'i', apiId: 'image', label: 'Image', type: 'media', localised: true },
    ),
  },
];

const data = {
  title: { 'en-GB': 'Hello', 'fr-FR': 'Bonjour' },
  slug: 'hello',
  seo: { description: { 'en-GB': 'A page' }, noindex: false },
  body: [
    {
      _uid: uid(1),
      _block: 'hero',
      heading: { 'en-GB': 'Welcome', 'fr-FR': '' },
      image: { 'en-GB': { assetId: uid(10) }, 'fr-FR': { assetId: uid(11), alt: 'Une image' } },
    },
  ],
};

describe('locales', () => {
  it('follows fallbacks in order, stopping at a locale without one', () => {
    expect(fallbackChain(locales, 'fr-CA')).toEqual(['fr-CA', 'fr-FR', 'en-GB']);
    expect(fallbackChain(locales, 'cy-GB')).toEqual(['cy-GB']);
    expect(fallbackChain(locales, 'de-DE')).toEqual(['de-DE']);
  });

  it('never loops on a circle', () => {
    const circle = [
      { code: 'a', fallback: 'b' },
      { code: 'b', fallback: 'a' },
    ];
    expect(fallbackChain(circle, 'a')).toEqual(['a', 'b']);
  });

  it('knows the default locale and codes', () => {
    expect(localeSettings(locales)).toEqual({ defaultLocale: 'en-GB', codes: ['en-GB', 'fr-FR', 'fr-CA', 'cy-GB'] });
  });

  it('suggests the language as the address prefix', () => {
    expect(defaultLocalePrefix('fr-FR')).toBe('fr');
    expect(createLocaleRequestSchema.safeParse({ code: 'fr_FR', name: 'French' }).success).toBe(false);
  });

  it('prefixes addresses of other locales when the space uses prefixes', () => {
    const settings = { locales, prefixes: true };
    expect(localisedPath('/about', 'fr-FR', settings)).toBe('/fr/about');
    expect(localisedPath('/', 'fr-CA', settings)).toBe('/fr-ca');
    expect(localisedPath('/about', 'en-GB', settings)).toBe('/about');
    expect(localisedPath('/about', 'fr-FR', { locales, prefixes: false })).toBe('/about');
  });
});

describe('translated values', () => {
  it('tells locale maps from plain values', () => {
    expect(isLocaleMap({ 'en-GB': 'x', fr: 'y' })).toBe(true);
    expect(isLocaleMap({})).toBe(true);
    expect(isLocaleMap({ type: 'doc' })).toBe(false);
    expect(isLocaleMap({ assetId: uid(1) })).toBe(false);
    expect(isLocaleMap('x')).toBe(false);
  });

  it('counts blank text, empty lists and empty documents as empty', () => {
    expect([undefined, null, ' ', [], { type: 'doc', content: [{ type: 'paragraph' }] }].every(isEmptyValue)).toBe(true);
    expect([0, false, 'x', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }].some(isEmptyValue)).toBe(false);
  });

  it('reads and writes one locale of a stored value', () => {
    expect(translationOf({ 'fr-FR': 'Bonjour' }, 'fr-FR', 'en-GB')).toBe('Bonjour');
    expect(translationOf('Hello', 'en-GB', 'en-GB')).toBe('Hello');
    expect(translationOf('Hello', 'fr-FR', 'en-GB')).toBeUndefined();
    expect(withTranslation('Hello', 'fr-FR', 'Bonjour', 'en-GB')).toEqual({ 'en-GB': 'Hello', 'fr-FR': 'Bonjour' });
    expect(withTranslation({ 'en-GB': 'Hello', 'fr-FR': 'Bonjour' }, 'fr-FR', undefined, 'en-GB')).toEqual({ 'en-GB': 'Hello' });
  });
});

describe('localiseEntryData', () => {
  it('reads each translated value along the fallback chain, sharing the rest', () => {
    expect(localiseEntryData(page, data, ['fr-CA', 'fr-FR', 'en-GB'], 'en-GB', blockTypes)).toEqual({
      title: 'Bonjour',
      slug: 'hello',
      seo: { description: 'A page', noindex: false },
      body: [{ _uid: uid(1), _block: 'hero', heading: 'Welcome', image: { assetId: uid(11), alt: 'Une image' } }],
    });
  });

  it('leaves a value with nothing along the chain null', () => {
    expect(localiseEntryData(page, data, ['cy-GB'], 'en-GB', blockTypes)).toMatchObject({ title: null, slug: 'hello' });
  });

  it('reads plain values of translated fields as the default locale\'s', () => {
    expect(localiseEntryData(page, { title: 'Hello' }, ['fr-FR', 'en-GB'], 'en-GB')).toEqual({ title: 'Hello' });
    expect(localiseEntryData(page, { title: 'Hello' }, ['cy-GB'], 'en-GB')).toEqual({ title: null });
  });
});

describe('existsInLocale', () => {
  it('is true when something translated shows along the chain', () => {
    expect(existsInLocale(page, data, ['fr-FR', 'en-GB'], 'en-GB', blockTypes)).toBe(true);
    expect(existsInLocale(page, data, ['cy-GB'], 'en-GB', blockTypes)).toBe(false);
  });

  it('is true in every locale for an entry with nothing translated', () => {
    expect(existsInLocale(page, { slug: 'x' }, ['cy-GB'], 'en-GB')).toBe(true);
  });
});

describe('missingTranslations', () => {
  it('lists values filled in in the default locale but not in the locale itself', () => {
    expect(missingTranslations(page, data, 'fr-FR', 'en-GB', blockTypes)).toEqual(['seo.description', `body.${uid(1)}.heading`]);
    expect(missingTranslations(page, data, 'en-GB', 'en-GB', blockTypes)).toEqual([]);
  });

  it('names the locales with gaps', () => {
    const complete = { title: { 'en-GB': 'Hello', 'fr-FR': 'Bonjour' } };
    expect(localesMissingTranslations(page, complete, ['fr-FR', 'cy-GB'], 'en-GB')).toEqual(['cy-GB']);
  });
});

describe('mediaRefs of translated fields', () => {
  it('finds the file of each locale', () => {
    expect(mediaRefs(page, data, blockTypes).map((ref) => [ref.assetId, ref.path])).toEqual([
      [uid(10), `body.${uid(1)}.image.en-GB`],
      [uid(11), `body.${uid(1)}.image.fr-FR`],
    ]);
  });
});
