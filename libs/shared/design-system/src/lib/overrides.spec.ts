import {
  adapterFor,
  bootstrapAdapter,
  bootstrapResponsive,
  cascadeLayers,
  CLASS_TOKEN,
  createTemplateAdapter,
  isClassTemplate,
  isSafeTokenValue,
  mergeOverrides,
  overrideTokens,
  plainAdapter,
  splitClasses,
} from './overrides';

describe('class tokens', () => {
  it.each([
    'px-4',
    'md:px-8',
    'w-1/2',
    'bg-[#c9a227]',
    'hover:!text-white',
    'grid-cols-[1fr,2fr]',
    'w-[calc(100%-2rem)]',
    '@md:flex',
    'card@md',
    '_x',
  ])('accepts %s', (name) => expect(CLASS_TOKEN.test(name)).toBe(true));

  it.each(['', 'a b', '"x', "x'", 'x>y', 'x<y', 'x;y', 'x{y}', 'x=y', 'x\ny', 'x'.repeat(121)])('refuses %j', (name) =>
    expect(CLASS_TOKEN.test(name)).toBe(false),
  );

  it('splits a class list and drops malformed names', () => {
    expect(splitClasses(' rounded-lg  shadow "x" ')).toEqual(['rounded-lg', 'shadow']);
    expect(splitClasses(42)).toEqual([]);
  });
});

describe('cascade layers', () => {
  it('declares the layers lowest first', () => {
    expect(cascadeLayers()).toBe('@layer novan-base, ds-vendor, ds-components, novan-overrides;');
  });
});

describe('plain adapter', () => {
  it('offers the base bucket only', () => {
    expect(plainAdapter.breakpoints).toEqual([]);
    expect(plainAdapter.states).toEqual([]);
  });

  it('keeps base classes and leaves out buckets it cannot write', () => {
    expect(plainAdapter.toClassList({ base: ['card', 'card--wide'], md: ['card--tall'], hover: ['x'] })).toEqual([
      'card',
      'card--wide',
    ]);
  });

  it('drops malformed and duplicate names, and anything that is not a list', () => {
    expect(plainAdapter.toClassList({ base: ['a', 'a', 'b c', 7 as unknown as string] })).toEqual(['a']);
    expect(plainAdapter.toClassList({ base: 'a' as unknown as string[] })).toEqual([]);
  });

  it('caps a bucket at 50 classes', () => {
    const names = Array.from({ length: 60 }, (_, index) => `c${index}`);
    expect(plainAdapter.toClassList({ base: names })).toHaveLength(50);
  });

  it('checks names against the class index when given one', () => {
    const index = new Set(['card']);
    expect(plainAdapter.isValid('card', index)).toBe(true);
    expect(plainAdapter.isValid('cards', index)).toBe(false);
    expect(plainAdapter.isValid('cards')).toBe(true);
    expect(plainAdapter.isValid('a b')).toBe(false);
  });
});

describe('template adapter', () => {
  const adapter = createTemplateAdapter('css', {
    breakpoints: { md: '{class}@md', lg: 'lg:{class}', xl: 'no-placeholder' },
    states: { hover: 'hover-{class}', dark: '{class}{class}' },
  });

  it('offers only the buckets with a valid template', () => {
    expect(adapter.breakpoints).toEqual(['md', 'lg']);
    expect(adapter.states).toEqual(['hover']);
  });

  it('writes each bucket through its template, in bucket order', () => {
    expect(
      adapter.toClassList({ hover: ['shadow'], md: ['px-8'], base: ['px-4'], lg: ['px-12'], xl: ['ignored'] }),
    ).toEqual(['px-4', 'px-8@md', 'lg:px-12', 'hover-shadow']);
  });

  it.each([
    ['md:{class}', true],
    ['{class}@md', true],
    ['{class}', true],
    ['md', false],
    ['{class} x', false],
    ['{class}"', false],
    ['{class}{class}', false],
  ])('treats %j as a template: %s', (template, valid) => expect(isClassTemplate(template)).toBe(valid));
});

describe('bootstrap adapter', () => {
  it('offers the breakpoints and no states', () => {
    expect(bootstrapAdapter.breakpoints).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(bootstrapAdapter.states).toEqual([]);
  });

  it.each([
    ['px-3', 'md', 'px-md-3'],
    ['p-0', 'sm', 'p-sm-0'],
    ['mx-auto', 'lg', 'mx-lg-auto'],
    ['d-none', 'md', 'd-md-none'],
    ['col', 'md', 'col-md'],
    ['col-6', 'xl', 'col-xl-6'],
    ['col-auto', 'md', 'col-md-auto'],
    ['row-cols-3', 'lg', 'row-cols-lg-3'],
    ['text-center', 'md', 'text-md-center'],
    ['flex-column', 'md', 'flex-md-column'],
    ['justify-content-between', 'lg', 'justify-content-lg-between'],
    ['g-4', 'md', 'g-md-4'],
    ['order-first', 'sm', 'order-sm-first'],
    ['float-end', 'md', 'float-md-end'],
  ] as const)('writes %s at %s as %s', (name, breakpoint, written) => {
    expect(bootstrapResponsive(name, breakpoint)).toBe(written);
    expect(bootstrapAdapter.canWrite(name, breakpoint)).toBe(true);
  });

  it.each(['text-primary', 'btn-primary', 'shadow', 'p-md-3', 'd-xxl-none', 'col-md-6', 'rounded', 'p-', 'a b'])(
    'has no breakpoint version of %s',
    (name) => {
      expect(bootstrapResponsive(name, 'md')).toBeNull();
      expect(bootstrapAdapter.canWrite(name, 'md')).toBe(false);
    },
  );

  it('writes every bucket it can, and leaves out the rest', () => {
    expect(
      bootstrapAdapter.toClassList({ base: ['btn', 'px-2'], md: ['px-4', 'text-primary'], lg: ['d-none'], hover: ['shadow'] }),
    ).toEqual(['btn', 'px-2', 'px-md-4', 'd-lg-none']);
    expect(bootstrapAdapter.canWrite('shadow', 'hover')).toBe(false);
  });
});

describe('choosing an adapter', () => {
  it('uses plain CSS without a design system, Bootstrap for Bootstrap, else the manifest templates', () => {
    expect(adapterFor(null)).toBe(plainAdapter);
    expect(adapterFor({ framework: 'bootstrap' })).toBe(bootstrapAdapter);
    const custom = adapterFor({ framework: 'css', breakpoints: { md: '{class}@md' } });
    expect(custom.breakpoints).toEqual(['md']);
    expect(custom.toClassList({ md: ['card'] })).toEqual(['card@md']);
    expect(custom.canWrite('card', 'md')).toBe(true);
    expect(custom.canWrite('card', 'lg')).toBe(false);
  });
});

describe('merging overrides', () => {
  it('adds the overrides after the default classes, part by part', () => {
    expect(
      mergeOverrides(
        { root: 'rounded-lg shadow', cta: 'btn' },
        { parts: { root: { base: ['mt-8', 'shadow'] }, heading: { base: ['h3'] } } },
      ),
    ).toEqual({ root: ['rounded-lg', 'shadow', 'mt-8'], cta: ['btn'], heading: ['h3'] });
  });

  it('uses the adapter for breakpoints and states', () => {
    const tailwindLike = createTemplateAdapter('tailwind', { breakpoints: { md: 'md:{class}' } });
    expect(mergeOverrides(undefined, { parts: { root: { base: ['px-4'], md: ['px-8'] } } }, tailwindLike)).toEqual({
      root: ['px-4', 'md:px-8'],
    });
  });

  it('is empty for blocks without overrides', () => {
    expect(mergeOverrides(undefined, undefined)).toEqual({});
    expect(mergeOverrides(null, null)).toEqual({});
  });

  it('skips malformed data instead of trusting it', () => {
    expect(
      mergeOverrides(
        { 'Bad Part': 'x' },
        {
          parts: JSON.parse('{ "__proto__": { "base": ["x"] }, "list": ["x"], "root": null, "ok": { "base": ["y"] } }'),
        },
      ),
    ).toEqual({ ok: ['y'] });
    expect(mergeOverrides(undefined, 'nope' as never)).toEqual({});
  });
});

describe('token overrides', () => {
  it('keeps well-named tokens with safe values', () => {
    expect(overrideTokens({ tokens: { '--color-primary': '#c9a227', '--space': 'calc(1rem + 2px)' } })).toEqual([
      ['--color-primary', '#c9a227'],
      ['--space', 'calc(1rem + 2px)'],
    ]);
  });

  it.each([
    'red; background: url(x)',
    'url(https://x)',
    'expression(alert(1))',
    '}body{',
    '<b>',
    'a\\62',
    '',
    'x'.repeat(201),
    '@import x',
  ])('refuses the value %j', (value) => expect(isSafeTokenValue(value)).toBe(false));

  it('drops tokens with bad names or values', () => {
    expect(overrideTokens({ tokens: { color: 'red', '--x': 'url(a)', '--ok': '2px' } })).toEqual([['--ok', '2px']]);
    expect(overrideTokens({ tokens: 'x' as never })).toEqual([]);
  });
});
