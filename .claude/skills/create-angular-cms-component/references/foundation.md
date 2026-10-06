# Shared CMS foundation

Create these once per CMS project, the first time a CMS component is generated, then reuse them. If equivalents already exist, use those and skip this file. Paths are relative to the CMS project's `src/lib/` (tests helper under `src/testing/`). Adjust the `cms-` prefix to the project's `prefix`.

Contents:
1. Schema helpers: `cms-schema.ts`
2. Content primitives: `cms-content.ts`
3. Registry: `cms-registry.ts`
4. Editor panel: `cms-style-panel/` (ts, html, scss, spec)
5. Test helpers: `testing/cms-testing.ts`
6. Workspace wiring (tsconfig, public API, dependencies)

Why it is shaped this way:
- The schema is the single source of truth. Defaults, validation of stored data, modifier classes, the editor form and the test matrix are all derived from it.
- `CmsStyleSchema<T>` is mapped from the settings interface, so a schema whose options don't match the type fails to compile.
- `resolveSettings()` never throws: CMS data written by an older version must still render.
- The editor panel uses native form controls with Bootstrap form classes (Novan is Bootstrap-based); Novan's form components are documentation showcases, not reusable inputs.

## 1. Schema helpers

### `lib/cms-schema.ts`

```ts
// cms-schema.ts — single source of truth for a CMS component's styling options.

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
  readonly [K in keyof T]-?: [T[K]] extends [boolean]
    ? CmsToggleField
    : [T[K]] extends [string]
      ? CmsChoiceField<T[K]>
      : never;
};

/** Settings object as stored by the CMS: any subset of keys, values unvalidated. */
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

/** BEM modifier classes for resolved settings, e.g. `cms-testimonial--tone-brand`. */
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

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
```

## 2. Content primitives

### `lib/cms-content.ts`

```ts
// cms-content.ts — shared content primitives for CMS components.

/** An image chosen by a content editor. `alt` is required; use '' only when the image is purely decorative. */
export interface CmsImage {
  readonly src: string;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
}

/** A link with visible text (never a bare URL or "click here"). */
export interface CmsLink {
  readonly href: string;
  readonly text: string;
  /** Set when the link leaves the site; the component adds rel and a visually hidden "(opens in new tab)" if needed. */
  readonly external?: boolean;
}
```

## 3. Registry

### `lib/cms-registry.ts`

```ts
// cms-registry.ts — maps the `type` stored in CMS JSON to a component, its styling schema and sample content.
import { EnvironmentProviders, InjectionToken, Type, makeEnvironmentProviders } from '@angular/core';

import { CmsStyleSchema } from './cms-schema';

export interface CmsComponentDefinition<TSettings = unknown, TContent = unknown> {
  /** Stable id saved in CMS data. Never rename once content exists; add a new type instead. */
  readonly type: string;
  /** Name shown to content editors. */
  readonly name: string;
  readonly component: Type<unknown>;
  readonly settingsSchema: CmsStyleSchema<TSettings>;
  /** Realistic content used by the editor preview and tests. */
  readonly sampleContent: TContent;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry holds definitions of many different shapes
export type AnyCmsComponentDefinition = CmsComponentDefinition<any, any>;

/** Typed helper so each definition is checked against its own settings and content types. */
export function defineCmsComponent<TSettings, TContent>(
  definition: CmsComponentDefinition<TSettings, TContent>,
): CmsComponentDefinition<TSettings, TContent> {
  return definition;
}

export const CMS_COMPONENTS = new InjectionToken<readonly AnyCmsComponentDefinition[]>('CMS_COMPONENTS');

/** `providers: [provideCmsComponents(TESTIMONIAL_DEFINITION, HERO_DEFINITION)]` in the app config. */
export function provideCmsComponents(...definitions: AnyCmsComponentDefinition[]): EnvironmentProviders {
  return makeEnvironmentProviders(
    definitions.map((definition) => ({ provide: CMS_COMPONENTS, useValue: definition, multi: true })),
  );
}
```

Keep an exported list of every definition, e.g. `lib/cms-components.ts`:

```ts
import { TESTIMONIAL_DEFINITION } from './components/testimonial';

export const CMS_COMPONENT_DEFINITIONS = [TESTIMONIAL_DEFINITION] as const;
```

Apps register them with `provideCmsComponents(...CMS_COMPONENT_DEFINITIONS)` and a page renderer looks up `block.type` in `inject(CMS_COMPONENTS)`, rendering with `NgComponentOutlet` and `{ content: block.content, settings: block.settings }`.

## 4. Editor panel

A form generated from any schema plus a live preview of the component. `[(settings)]` two-way binds to the block's stored settings and always writes back a complete, valid object.

### `lib/cms-style-panel/cms-style-panel.component.ts`

```ts
// cms-style-panel/cms-style-panel.component.ts — the editor UI: a form generated from a schema plus a live preview.
import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';

import { AnyCmsComponentDefinition } from '../cms-registry';
import { CmsStoredSettings, defaultsOf, fieldViews, resolveSettings } from '../cms-schema';

let nextId = 0;

@Component({
  selector: 'cms-style-panel',
  standalone: true,
  imports: [NgComponentOutlet],
  templateUrl: './cms-style-panel.component.html',
  styleUrl: './cms-style-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'cms-style-panel' },
})
export class CmsStylePanelComponent {
  readonly definition = input.required<AnyCmsComponentDefinition>();
  /** Content shown in the preview. Falls back to the definition's sample content. */
  readonly content = input<unknown>(undefined);
  /** Two-way bound settings: `[(settings)]="block.settings"`. Always written back complete and valid. */
  readonly settings = model<CmsStoredSettings | null>(null);
  /** Hides the preview when the host page already renders the component. */
  readonly showPreview = input(true);

  protected readonly uid = `cms-style-panel-${nextId++}`;

  protected readonly fields = computed(() => fieldViews(this.definition().settingsSchema));
  protected readonly resolved = computed(
    () => resolveSettings(this.definition().settingsSchema, this.settings()) as Record<string, unknown>,
  );
  protected readonly previewContent = computed(() => this.content() ?? this.definition().sampleContent);
  protected readonly previewInputs = computed(() => ({ content: this.previewContent(), settings: this.resolved() }));

  protected controlId(key: string, suffix?: string): string {
    return suffix ? `${this.uid}-${key}-${suffix}` : `${this.uid}-${key}`;
  }

  protected hintId(key: string): string {
    return `${this.uid}-${key}-hint`;
  }

  protected update(key: string, value: string | boolean): void {
    this.settings.set({ ...this.resolved(), [key]: value });
  }

  protected onSelect(key: string, event: Event): void {
    this.update(key, (event.target as HTMLSelectElement).value);
  }

  protected onToggle(key: string, event: Event): void {
    this.update(key, (event.target as HTMLInputElement).checked);
  }

  protected reset(): void {
    this.settings.set(defaultsOf(this.definition().settingsSchema) as CmsStoredSettings);
  }
}
```

### `lib/cms-style-panel/cms-style-panel.component.html`

```html
<div class="cms-style-panel__layout">
  <form class="cms-style-panel__form" [attr.aria-labelledby]="uid + '-title'" (submit)="$event.preventDefault()">
    <h2 class="cms-style-panel__title h5" [id]="uid + '-title'">{{ definition().name }} styling</h2>

    @for (field of fields(); track field.key) {
      @switch (field.kind) {
        @case ('select') {
          <div class="cms-style-panel__field">
            <label class="form-label" [for]="controlId(field.key)">{{ field.label }}</label>
            <select
              class="form-select"
              [id]="controlId(field.key)"
              [attr.aria-describedby]="field.hint ? hintId(field.key) : null"
              (change)="onSelect(field.key, $event)"
            >
              @for (option of field.options; track option.value) {
                <option [value]="option.value" [selected]="resolved()[field.key] === option.value">{{ option.label }}</option>
              }
            </select>
            @if (field.hint) {
              <div class="form-text" [id]="hintId(field.key)">{{ field.hint }}</div>
            }
          </div>
        }
        @case ('radio') {
          <fieldset class="cms-style-panel__field" [attr.aria-describedby]="field.hint ? hintId(field.key) : null">
            <legend class="form-label cms-style-panel__legend">{{ field.label }}</legend>
            @for (option of field.options; track option.value) {
              <div class="form-check form-check-inline">
                <input
                  class="form-check-input"
                  type="radio"
                  [name]="controlId(field.key)"
                  [id]="controlId(field.key, option.value)"
                  [value]="option.value"
                  [checked]="resolved()[field.key] === option.value"
                  (change)="update(field.key, option.value)"
                />
                <label class="form-check-label" [for]="controlId(field.key, option.value)">{{ option.label }}</label>
              </div>
            }
            @if (field.hint) {
              <div class="form-text" [id]="hintId(field.key)">{{ field.hint }}</div>
            }
          </fieldset>
        }
        @case ('toggle') {
          <div class="cms-style-panel__field form-check form-switch">
            <input
              class="form-check-input"
              type="checkbox"
              role="switch"
              [id]="controlId(field.key)"
              [checked]="resolved()[field.key] === true"
              [attr.aria-describedby]="field.hint ? hintId(field.key) : null"
              (change)="onToggle(field.key, $event)"
            />
            <label class="form-check-label" [for]="controlId(field.key)">{{ field.label }}</label>
            @if (field.hint) {
              <div class="form-text" [id]="hintId(field.key)">{{ field.hint }}</div>
            }
          </div>
        }
      }
    }

    <button type="button" class="btn btn-secondary cms-style-panel__reset" (click)="reset()">Reset to defaults</button>
  </form>

  @if (showPreview()) {
    <section class="cms-style-panel__preview" [attr.aria-labelledby]="uid + '-preview'">
      <h2 class="cms-style-panel__preview-title h6" [id]="uid + '-preview'">Preview</h2>
      <ng-container *ngComponentOutlet="definition().component; inputs: previewInputs()" />
    </section>
  }
</div>
```

### `lib/cms-style-panel/cms-style-panel.component.scss`

```scss
// cms-style-panel/cms-style-panel.component.scss
:host {
  --cms-style-panel-gap: var(--ds-spacing-scale-5);
  --cms-style-panel-border: var(--ds-color-neutral-gray-300);
  --cms-style-panel-preview-surface: var(--ds-color-surface-muted);

  display: block;
}

.cms-style-panel__layout {
  display: grid;
  gap: var(--cms-style-panel-gap);

  @media (min-width: 64rem) {
    grid-template-columns: minmax(16rem, 22rem) 1fr;
    align-items: start;
  }
}

.cms-style-panel__form {
  display: grid;
  gap: var(--ds-spacing-scale-4);
  padding: var(--ds-spacing-scale-4);
  border: 0.0625rem solid var(--cms-style-panel-border);
  border-radius: 0.5rem;
}

.cms-style-panel__title,
.cms-style-panel__preview-title {
  margin: 0;
}

.cms-style-panel__field {
  margin: 0;
  padding: 0;
  border: 0;
  min-inline-size: 0;
}

.cms-style-panel__legend {
  float: none;
  inline-size: auto;
  margin-block-end: var(--ds-spacing-scale-2);
  font-size: inherit;
}

.cms-style-panel__reset {
  justify-self: start;
}

.cms-style-panel__preview {
  display: grid;
  gap: var(--ds-spacing-scale-3);
  padding: var(--ds-spacing-scale-4);
  background-color: var(--cms-style-panel-preview-surface);
  border-radius: 0.5rem;
}

@media (forced-colors: active) {
  .cms-style-panel__form,
  .cms-style-panel__preview {
    border: 0.0625rem solid CanvasText;
  }
}
```

### `lib/cms-style-panel/cms-style-panel.component.spec.ts`

```ts
// cms-style-panel/cms-style-panel.component.spec.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { defineCmsComponent } from '../cms-registry';
import { CmsStoredSettings, CmsStyleSchema } from '../cms-schema';
import { expectNoAxeViolations } from '../testing/cms-testing';
import { CmsStylePanelComponent } from './cms-style-panel.component';

interface FakeSettings {
  tone: 'light' | 'brand';
  width: 'narrow' | 'wide' | 'full';
  bordered: boolean;
}

@Component({
  selector: 'cms-fake',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="fake" [attr.data-tone]="$any(settings())?.tone">{{ content() }}</p>`,
})
class FakeComponent {
  readonly content = input<string>('');
  readonly settings = input<unknown>(null);
}

const SCHEMA: CmsStyleSchema<FakeSettings> = {
  tone: {
    kind: 'radio',
    label: 'Tone',
    hint: 'Colour scheme for the block.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'brand', label: 'Brand' },
    ],
    default: 'light',
  },
  width: {
    kind: 'select',
    label: 'Width',
    options: [
      { value: 'narrow', label: 'Narrow' },
      { value: 'wide', label: 'Wide' },
      { value: 'full', label: 'Full width' },
    ],
    default: 'wide',
  },
  bordered: { kind: 'toggle', label: 'Show border', default: false },
};

const DEFINITION = defineCmsComponent<FakeSettings, string>({
  type: 'fake',
  name: 'Fake block',
  component: FakeComponent,
  settingsSchema: SCHEMA,
  sampleContent: 'Sample text',
});

describe('CmsStylePanelComponent', () => {
  function render(settings: CmsStoredSettings | null = null) {
    TestBed.configureTestingModule({ imports: [CmsStylePanelComponent] });
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', DEFINITION);
    fixture.componentRef.setInput('settings', settings);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }

  it('renders one control per schema field, using the right control type', () => {
    const { element } = render();

    expect(element.querySelectorAll('input[type="radio"]').length).toBe(2);
    expect(element.querySelectorAll('select option').length).toBe(3);
    expect(element.querySelector('input[type="checkbox"][role="switch"]')).not.toBeNull();
  });

  it('reflects defaults when no settings are stored', () => {
    const { element } = render();

    expect(element.querySelector<HTMLInputElement>('input[value="light"]')?.checked).toBe(true);
    expect(element.querySelector<HTMLSelectElement>('select')?.value).toBe('wide');
    expect(element.querySelector<HTMLInputElement>('[role="switch"]')?.checked).toBe(false);
  });

  it('writes back complete, valid settings when a radio changes', () => {
    const { fixture, element } = render({ tone: 'neon', legacy: true });

    element.querySelector<HTMLInputElement>('input[value="brand"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.settings()).toEqual({ tone: 'brand', width: 'wide', bordered: false });
  });

  it('writes back select and toggle changes', () => {
    const { fixture, element } = render();

    const select = element.querySelector<HTMLSelectElement>('select')!;
    select.value = 'full';
    select.dispatchEvent(new Event('change'));
    element.querySelector<HTMLInputElement>('[role="switch"]')!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.settings()).toEqual({ tone: 'light', width: 'full', bordered: true });
  });

  it('resets to defaults', () => {
    const { fixture, element } = render({ tone: 'brand', width: 'full', bordered: true });

    element.querySelector<HTMLButtonElement>('.cms-style-panel__reset')!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.settings()).toEqual({ tone: 'light', width: 'wide', bordered: false });
  });

  it('passes resolved settings and sample content to the live preview', () => {
    const { fixture, element } = render();

    element.querySelector<HTMLInputElement>('input[value="brand"]')!.click();
    fixture.detectChanges();

    const preview = element.querySelector('.fake')!;
    expect(preview.textContent).toBe('Sample text');
    expect(preview.getAttribute('data-tone')).toBe('brand');
  });

  it('gives every control an accessible name and links hints with aria-describedby', () => {
    const { element } = render();

    for (const control of Array.from(element.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) {
      expect(control.labels?.length, `${control.id} has no label`).toBeGreaterThan(0);
    }
    const toneGroup = element.querySelector('fieldset')!;
    const hintId = toneGroup.getAttribute('aria-describedby')!;
    expect(element.querySelector(`#${hintId}`)?.textContent).toContain('Colour scheme');
  });

  it('uses ids that are unique across panel instances', () => {
    const first = render().element;
    const second = TestBed.createComponent(CmsStylePanelComponent);
    second.componentRef.setInput('definition', DEFINITION);
    second.detectChanges();

    const firstIds = Array.from(first.querySelectorAll('[id]')).map((node) => node.id);
    const secondIds = Array.from((second.nativeElement as HTMLElement).querySelectorAll('[id]')).map((node) => node.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
  });

  it('has no axe violations', async () => {
    const { element } = render();
    await expectNoAxeViolations(element);
  });
});
```

## 5. Test helpers

Test-only code. Keep it out of the library build (see wiring below) and never export it from the public API.

### `testing/cms-testing.ts`

```ts
// testing/cms-testing.ts — shared helpers for CMS component specs (test-only, never exported from the library).
import axe from 'axe-core';
import { expect } from 'vitest';

import { CmsStyleField, CmsStyleSchema, defaultsOf } from '../cms-schema';

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

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Runs axe-core (WCAG 2.2 A/AA rules) against a rendered element and fails with a
 * readable list of violations.
 *
 * `color-contrast` is disabled because jsdom has no layout or computed colours,
 * so axe can only return "incomplete" for it. Contrast is checked in a real
 * browser by the Playwright axe test that runs against the editor app.
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
```

## 6. Workspace wiring

Check each of these; they are the usual reasons generated code fails to build or run.

- **axe-core as a direct devDependency**: `npm i -D axe-core` if `package.json` lacks it (it is often only present transitively via `@axe-core/playwright`).
- **Library tsconfig** (`tsconfig.lib.json`): Novan's includes `src/**/*.ts` and excludes only `**/*.spec.ts`, so test helpers would be compiled into the library. Add `"src/testing/**"` to `exclude`.
- **Spec tsconfig** (`tsconfig.spec.json`): its `include` must cover `src/**/*.spec.ts` and `src/testing/**/*.ts`, with `"types": ["vitest/globals"]`.
- **Vitest setup**: point the project's `test` target `setupFiles` at a `test-setup.ts`. Copy the design-system one if the CMS project lacks it (it restores mocks and polyfills `<dialog>` for jsdom).
- **Public API**: export `cms-schema`, `cms-content`, `cms-registry`, `cms-style-panel/cms-style-panel.component`, `cms-components` and each component barrel. Do not export `testing/`.
- **Path alias**: if the app imports the CMS library by alias, add it to the root `tsconfig.json` `paths` next to the design-system alias.
