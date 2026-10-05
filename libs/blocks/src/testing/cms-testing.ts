// testing/cms-testing.ts — shared helpers for block specs (test-only, never exported from the library).
import type { Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import axe from 'axe-core';
import { expect } from 'vitest';

import { type CmsStyleField, type CmsStyleSchema, defaultsOf } from '../lib/cms-schema';

/** One rendering scenario for the test matrix. */
export interface CmsSettingsVariant<T> {
  /** Readable test name, e.g. `tone=brand` or `all non-default`. */
  readonly name: string;
  readonly settings: T;
  /** The option that differs from the defaults, or null for the combined variant. */
  readonly key: (keyof T & string) | null;
  readonly value: unknown;
}

/**
 * Every option value, changed one at a time from the defaults, plus one
 * variant with every option set to a non-default value. Covers each value
 * at least once without a combinatorial explosion, and picks up new options
 * automatically when the schema grows.
 */
export function settingsVariants<T>(schema: CmsStyleSchema<T>): CmsSettingsVariant<T>[] {
  const defaults = defaultsOf(schema);
  const variants: CmsSettingsVariant<T>[] = [];
  const allNonDefault: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };

  for (const [key, field] of Object.entries(schema) as [keyof T & string, CmsStyleField][]) {
    const values: unknown[] = field.kind === 'toggle' ? [true, false] : field.options.map((option) => option.value);

    for (const value of values) {
      variants.push({ name: `${key}=${String(value)}`, settings: { ...defaults, [key]: value }, key, value });
    }

    const alternative = values.find((value) => value !== field.default);
    if (alternative !== undefined) {
      allNonDefault[key] = alternative;
    }
  }

  variants.push({ name: 'all non-default', settings: allNonDefault as T, key: null, value: null });
  return variants;
}

/**
 * Renders a block with field values and optional raw settings, as `<novan-blocks>` would. Configure the
 * TestBed (imports, providers) before calling it.
 */
export function renderBlock<T>(
  component: Type<T>,
  content: object,
  settings?: unknown,
): { fixture: ComponentFixture<T>; host: HTMLElement } {
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(content)) {
    fixture.componentRef.setInput(name, value);
  }
  if (settings !== undefined) {
    fixture.componentRef.setInput('settings', settings);
  }
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

/** The public CSS contract: `<block>--<option>-<value>` for choices, `<block>--<option>` for toggles. */
export const kebab = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Runs axe-core (WCAG 2.2 A/AA rules) against a rendered element and fails with a
 * readable list of violations.
 *
 * `color-contrast` is disabled because jsdom has no layout or computed colours,
 * so axe can only return "incomplete" for it. Contrast is checked in a real
 * browser by the starter site's Playwright axe tests, which render every tone.
 */
export async function expectNoAxeViolations(context: Element, options: axe.RunOptions = {}): Promise<void> {
  const results = await axe.run(context, {
    runOnly: { type: 'tag', values: WCAG_TAGS },
    resultTypes: ['violations'],
    ...options,
    rules: { 'color-contrast': { enabled: false }, ...options.rules },
  });

  const summary = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n` +
      violation.nodes.map((node) => `    ${node.target.join(' ')} — ${node.failureSummary ?? ''}`).join('\n'),
  );

  expect(summary, summary.join('\n\n')).toEqual([]);
}
