// The source of truth, imported only by this test, never by the published build.
import * as shared from '@novan/shared-design-system';

import * as sdk from './overrides';

// The SDK carries its own copy of the class-override helpers. These checks fail when the copy and the workspace's
// version (which the admin and API use) stop agreeing, in their types, their constants or what they produce.

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const check = <T extends true>(): T => true as T;

const overrides: unknown[] = [
  undefined,
  null,
  'x',
  { parts: { root: { base: ['mt-8', 'mt-8', 'bad name'], md: ['px-8'], hover: ['shadow'] } } },
  { parts: { cta: { base: ['btn', 'btn-primary'] }, 'Bad Part': { base: ['x'] }, list: ['x'] } },
  { parts: JSON.parse('{ "__proto__": { "base": ["x"] } }') },
  { parts: { root: { base: Array.from({ length: 60 }, (_, index) => `c${index}`) } } },
  { tokens: { '--color-primary': '#c9a227', color: 'red', '--x': 'url(a)', '--y': 'a;b' } },
  { tokens: 'x' },
];

const defaults: unknown[] = [undefined, { root: 'rounded-lg shadow', cta: 'btn "x"' }, { 'Bad Part': 'x' }];

const values: unknown[] = ['px-4', 'md:px-8', 'w-[calc(100%-2rem)]', 'a b', '"x', '', 'x'.repeat(121), 42, null];

const templates = {
  breakpoints: { md: 'md:{class}', lg: '{class}@lg', xl: 'bad' },
  states: { hover: 'hover:{class}', dark: '{class}{class}' },
};

describe('class override helpers copy', () => {
  it('has the same types as the workspace version', () => {
    expect(check<Same<sdk.BlockOverrides, shared.BlockOverrides>>()).toBe(true);
    expect(check<Same<sdk.PartBuckets, shared.PartBuckets>>()).toBe(true);
    expect(check<Same<sdk.ClassAdapter, shared.ClassAdapter>>()).toBe(true);
    expect(check<Same<sdk.ClassTemplates, shared.ClassTemplates>>()).toBe(true);
    expect(check<Same<sdk.Bucket, shared.Bucket>>()).toBe(true);
    expect(check<Same<sdk.CascadeLayer, shared.CascadeLayer>>()).toBe(true);
  });

  it('exports the same things, with the same constants', () => {
    for (const [name, value] of Object.entries(sdk)) {
      const theirs = (shared as Record<string, unknown>)[name];
      expect(typeof theirs, name).toBe(typeof value);
      if (value instanceof RegExp) expect(String(theirs), name).toBe(String(value));
      else if (typeof value !== 'function' && !name.endsWith('Adapter')) expect(theirs, name).toEqual(value);
    }
  });

  it.each(overrides.map((value) => [JSON.stringify(value)?.slice(0, 80) ?? String(value), value]))(
    'merges %s the same way',
    (_, value) => {
      for (const defaultClasses of defaults) {
        const args = [defaultClasses, value] as Parameters<typeof sdk.mergeOverrides>;
        expect(sdk.mergeOverrides(...args)).toEqual(shared.mergeOverrides(...args));
        const adapter = [
          sdk.createTemplateAdapter('x', templates),
          shared.createTemplateAdapter('x', templates),
        ] as const;
        expect(sdk.mergeOverrides(args[0], args[1], adapter[0])).toEqual(
          shared.mergeOverrides(args[0], args[1], adapter[1]),
        );
      }
      expect(sdk.overrideTokens(value as sdk.BlockOverrides)).toEqual(
        shared.overrideTokens(value as shared.BlockOverrides),
      );
    },
  );

  it.each(values.map((value) => [JSON.stringify(value) ?? String(value), value]))(
    'checks %s the same way',
    (_, value) => {
      expect(sdk.isClassToken(value)).toBe(shared.isClassToken(value));
      expect(sdk.isClassTemplate(value)).toBe(shared.isClassTemplate(value));
      expect(sdk.isSafeTokenValue(value)).toBe(shared.isSafeTokenValue(value));
      expect(sdk.splitClasses(value)).toEqual(shared.splitClasses(value));
    },
  );

  it('writes Bootstrap breakpoints and chooses adapters the same way', () => {
    const buckets = { base: ['btn', 'px-2'], md: ['px-4', 'text-primary', 'col'], lg: ['d-none', 'p-md-3'], hover: ['shadow'] };
    expect(sdk.bootstrapAdapter.toClassList(buckets)).toEqual(shared.bootstrapAdapter.toClassList(buckets));
    for (const name of ['px-3', 'col', 'text-center', 'text-primary', 'p-md-3', 'row-cols-2', 'a b']) {
      for (const bucket of sdk.BUCKETS) {
        expect(sdk.bootstrapAdapter.canWrite(name, bucket), `${name} ${bucket}`).toBe(shared.bootstrapAdapter.canWrite(name, bucket));
        expect(sdk.createTemplateAdapter('x', templates).canWrite(name, bucket)).toBe(shared.createTemplateAdapter('x', templates).canWrite(name, bucket));
      }
    }
    for (const source of [null, { framework: 'bootstrap' }, { framework: 'css', breakpoints: { md: '{class}@md' } }]) {
      const [ours, theirs] = [sdk.adapterFor(source), shared.adapterFor(source)];
      expect([ours.framework, ours.breakpoints, ours.states, ours.toClassList(buckets)]).toEqual([
        theirs.framework,
        theirs.breakpoints,
        theirs.states,
        theirs.toClassList(buckets),
      ]);
    }
  });

  it('builds adapters and layers the same way', () => {
    const ours = sdk.createTemplateAdapter('x', templates);
    const theirs = shared.createTemplateAdapter('x', templates);
    expect([ours.breakpoints, ours.states]).toEqual([theirs.breakpoints, theirs.states]);
    expect([sdk.plainAdapter.breakpoints, sdk.plainAdapter.states]).toEqual([
      shared.plainAdapter.breakpoints,
      shared.plainAdapter.states,
    ]);
    expect(sdk.cascadeLayers()).toBe(shared.cascadeLayers());
  });
});
