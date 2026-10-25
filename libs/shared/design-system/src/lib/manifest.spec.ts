import {
  cssOnlyManifest,
  designSystemManifestSchema,
  manifestJsonSchema,
  type DesignSystemManifestInput,
  type ManifestComponentInput,
} from './manifest';

const pricingCard: ManifestComponentInput = {
  id: 'acme-pricing-card',
  tag: 'acme-pricing-card',
  label: 'Pricing card',
  category: 'Marketing',
  icon: 'assets/icons/pricing.svg',
  props: {
    type: 'object',
    properties: {
      title: { type: 'string', title: 'Title' },
      price: { type: 'number', title: 'Price' },
      featured: { type: 'boolean', default: false },
      theme: { enum: ['light', 'dark'], default: 'light' },
      features: {
        type: 'array',
        items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      },
    },
    required: ['title'],
  },
  slots: [{ name: 'default', allowedChildren: ['*'] }, { name: 'footer' }],
  parts: ['root', 'header', 'price', 'cta'],
  shadowParts: ['price'],
  defaultClasses: { root: 'rounded-lg shadow' },
  ssr: 'client-only',
};

/** A valid manifest with some keys changed; tests pass invalid values on purpose. */
const manifest = (overrides: Partial<Record<keyof DesignSystemManifestInput, unknown>> = {}): unknown => ({
  name: 'Acme',
  version: '1.2.0',
  framework: 'tailwind',
  css: ['dist/acme.css'],
  js: ['dist/acme.js'],
  components: [pricingCard],
  ...overrides,
});

const issues = (input: unknown) => {
  const result = designSystemManifestSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('design system manifest', () => {
  it('accepts a full manifest and fills in the defaults', () => {
    const parsed = designSystemManifestSchema.parse(
      manifest({ components: [{ id: 'acme-note', template: '<p>{{text}}</p>', label: 'Note' }, pricingCard] }),
    );
    expect(parsed.allowedOrigins).toEqual([]);
    expect(parsed.components[0]).toMatchObject({
      parts: ['root'],
      shadowParts: [],
      slots: [],
      defaultClasses: {},
      ssr: 'client-only',
    });
    expect(parsed.components[0].props).toEqual({ type: 'object', properties: {} });
  });

  it('accepts a CSS-only manifest', () => {
    expect(
      cssOnlyManifest({ name: 'Bootstrap', version: '5.3.8', framework: 'bootstrap', css: 'bootstrap.min.css' }),
    ).toMatchObject({
      css: ['bootstrap.min.css'],
      js: [],
      components: [],
    });
  });

  it.each([
    ['a version that is not semver', { version: 'v1' }, 'version'],
    ['an unknown framework', { framework: 'react' }, 'framework'],
    ['no stylesheet', { css: [] }, 'css'],
    ['a stylesheet outside the package', { css: ['../secrets.css'] }, 'css.0'],
    ['an absolute stylesheet path', { css: ['/etc/acme.css'] }, 'css.0'],
    ['a backslash path', { css: ['dist\\acme.css'] }, 'css.0'],
    ['a script that is not a module file', { js: ['dist/acme.ts'] }, 'js.0'],
    ['an http origin', { allowedOrigins: ['http://fonts.example.com'] }, 'allowedOrigins.0'],
    ['an origin with a path', { allowedOrigins: ['https://cdn.example.com/x'] }, 'allowedOrigins.0'],
    ['a bad breakpoint template', { breakpoints: { md: 'md:' } }, 'breakpoints.md'],
    ['an unknown key', { theme: 'x' } as never, ''],
    ['a bad token name', { tokens: { color: { type: 'color' } } } as never, 'tokens.color'],
  ])('refuses %s', (_, change, path) => {
    expect(issues(manifest(change)).some((issue) => issue.startsWith(`${path}:`))).toBe(true);
  });

  it('needs a script when a component has a tag', () => {
    expect(issues(manifest({ js: [] }))).toContain(
      'js: Components with a tag need a script that defines them: list it under "js".',
    );
  });

  it('refuses duplicate component ids and tags', () => {
    expect(issues(manifest({ components: [pricingCard, pricingCard] }))).toEqual([
      'components: "acme-pricing-card" is listed twice.',
      'components: "acme-pricing-card" is listed twice.',
    ]);
  });

  describe('components', () => {
    const component = (change: Record<string, unknown>) =>
      issues(manifest({ components: [{ ...pricingCard, ...change }] as never }));

    it.each([
      ['a tag without a hyphen', { tag: 'pricing' }, 'components.0.tag'],
      ['an upper-case tag', { tag: 'Acme-Card' }, 'components.0.tag'],
      ['a reserved tag', { tag: 'font-face' }, 'components.0.tag'],
      ['a tag in the SDK namespace', { tag: 'novan-card' }, 'components.0.tag'],
      ['both a tag and a template', { template: '<p></p>' }, 'components.0.tag'],
      ['neither a tag nor a template', { tag: undefined }, 'components.0.tag'],
      ['an id that is not kebab-case', { id: 'PricingCard' }, 'components.0.id'],
      ['a bad part name', { parts: ['root', 'Call To Action'] }, 'components.0.parts.1'],
      ['no root part', { parts: ['header'], shadowParts: [], defaultClasses: {} }, 'components.0.parts'],
      ['a duplicate part', { parts: ['root', 'root'] }, 'components.0.parts'],
      ['a shadow part that is not a part', { shadowParts: ['footer'] }, 'components.0.shadowParts.0'],
      ['default classes for an unknown part', { defaultClasses: { body: 'p-4' } }, 'components.0.defaultClasses.body'],
      [
        'default classes that are not class names',
        { defaultClasses: { root: 'p-4 "><script>' } },
        'components.0.defaultClasses.root',
      ],
      ['a duplicate slot', { slots: [{ name: 'footer' }, { name: 'footer' }] }, 'components.0.slots'],
      ['an icon that is not an SVG', { icon: 'icon.png' }, 'components.0.icon'],
      ['an SSR mode it does not know', { ssr: 'server' }, 'components.0.ssr'],
    ])('refuses %s', (_, change, path) => {
      expect(component(change).some((issue) => issue.startsWith(`${path}:`))).toBe(true);
    });

    it.each([
      ['an unsupported keyword', { title: { type: 'string', pattern: '^a' } }, 'components.0.props.properties.title'],
      ['an object prop', { address: { type: 'object', properties: {} } }, 'components.0.props.properties.address'],
      [
        'a prop name that is not camelCase',
        { 'button-text': { type: 'string' } },
        'components.0.props.properties.button-text',
      ],
      [
        'an enum default that is not an option',
        { theme: { enum: ['light'], default: 'dark' } },
        'components.0.props.properties.theme.default',
      ],
      [
        'nested arrays',
        { rows: { type: 'array', items: { type: 'object', properties: { cells: { type: 'array' } } } } },
        'components.0.props.properties.rows',
      ],
    ])('refuses props with %s', (_, properties, path) => {
      expect(component({ props: { type: 'object', properties } }).some((issue) => issue.startsWith(path))).toBe(true);
    });

    it('refuses required props that are not listed', () => {
      expect(component({ props: { type: 'object', properties: {}, required: ['title'] } })).toContain(
        'components.0.props.required.0: "title" is not one of the properties.',
      );
    });
  });
});

describe('manifest JSON Schema', () => {
  it('is generated from the Zod schema and kept beside the library', async () => {
    await expect(`${JSON.stringify(manifestJsonSchema(), null, 2)}\n`).toMatchFileSnapshot(
      '../../novan-ds.schema.json',
    );
  });
});
