import {
  createBlockTypeRequestSchema,
  createContentTypeRequestSchema,
  forceQuerySchema,
  styleOptionsSchema,
  updateBlockTypeRequestSchema,
  updateContentTypeRequestSchema,
} from './content-model';

const paths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('content type requests', () => {
  it('creates a type with defaults filled', () => {
    expect(
      createContentTypeRequestSchema.parse({
        apiId: 'page',
        name: ' Page ',
        kind: 'page',
        fields: [{ id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true }],
      }),
    ).toEqual({
      apiId: 'page',
      name: 'Page',
      kind: 'page',
      fields: [{ id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true, localised: false, multiline: false }],
    });
  });

  it('rejects an unknown kind and invalid fields', () => {
    const result = createContentTypeRequestSchema.safeParse({
      apiId: 'page',
      name: 'Page',
      kind: 'post',
      fields: [{ id: 'x', apiId: 'Bad Id', label: 'x', type: 'text' }],
    });
    expect(paths(result)).toEqual(['kind', 'fields.0.apiId']);
  });

  it('does not let an update change the api id or kind', () => {
    const result = updateContentTypeRequestSchema.safeParse({ apiId: 'other', kind: 'entry' });
    expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['apiId', 'kind'] });
    expect(updateContentTypeRequestSchema.safeParse({}).success).toBe(false);
    expect(updateContentTypeRequestSchema.parse({ description: null })).toEqual({ description: null });
  });
});

describe('style options', () => {
  const tone = {
    kind: 'radio',
    label: 'Tone',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'brand', label: 'Brand' },
    ],
    default: 'light',
  };

  it('accepts choice and toggle fields made of named presets', () => {
    const options = { tone, headingLevel: { ...tone, kind: 'select', options: [{ value: 'h2', label: 'H2' }], default: 'h2' }, showDivider: { kind: 'toggle', label: 'Divider', default: false } };
    expect(styleOptionsSchema.parse(options)).toEqual(options);
  });

  it.each([
    ['a raw colour', { tone: { ...tone, options: [{ value: '#ffffff', label: 'White' }], default: '#ffffff' } }, 'tone.options.0.value'],
    ['a raw size', { width: { ...tone, options: [{ value: '12px', label: '12' }], default: '12px' } }, 'width.options.0.value'],
    ['a default that is not an option', { tone: { ...tone, default: 'dark' } }, 'tone.default'],
    ['a duplicate option', { tone: { ...tone, options: [tone.options[0], tone.options[0]] } }, 'tone.options.1.value'],
    ['a toggle with a string default', { flag: { kind: 'toggle', label: 'Flag', default: 'yes' } }, 'flag.default'],
    ['a free-text field', { tone: { kind: 'text', label: 'Tone', default: 'x' } }, 'tone.kind'],
    ['a key that is not camelCase', { 'heading-level': tone }, 'heading-level'],
  ])('rejects %s', (_, options, path) => {
    expect(paths(styleOptionsSchema.safeParse(options))).toContain(path);
  });
});

describe('block type requests', () => {
  it('creates a block type with defaults filled', () => {
    expect(createBlockTypeRequestSchema.parse({ apiId: 'hero', name: 'Hero' })).toEqual({
      apiId: 'hero',
      name: 'Hero',
      fields: [],
      allowedChildren: [],
      styleOptions: {},
    });
  });

  it('reserves "children" and rejects repeated allowed children', () => {
    const result = createBlockTypeRequestSchema.safeParse({
      apiId: 'columns',
      name: 'Columns',
      icon: 'Layout Icon',
      fields: [{ id: 'c', apiId: 'children', label: 'Children', type: 'json' }],
      allowedChildren: ['cta', 'cta'],
    });
    expect(paths(result)).toEqual(['icon', 'fields.0.apiId', 'allowedChildren']);
  });

  it('does not let an update change the api id', () => {
    expect(updateBlockTypeRequestSchema.safeParse({ apiId: 'other' }).success).toBe(false);
    expect(updateBlockTypeRequestSchema.parse({ icon: null })).toEqual({ icon: null });
  });
});

describe('forceQuerySchema', () => {
  it('reads ?force=true', () => {
    expect(forceQuerySchema.parse('true')).toBe(true);
    expect(forceQuerySchema.parse('false')).toBe(false);
    expect(forceQuerySchema.parse(undefined)).toBe(false);
    expect(forceQuerySchema.safeParse('yes').success).toBe(false);
  });
});
