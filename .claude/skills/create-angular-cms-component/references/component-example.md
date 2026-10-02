# Worked example: testimonial component

A complete CMS component generated with this skill. Use it as the pattern for structure, naming and test coverage; change the content model, options and markup to suit the requested component.

Settings for this example:

| Option | Control | Values (default in bold) |
| --- | --- | --- |
| tone | radio | **light**, muted, brand |
| layout | radio | **stacked**, media-start |
| alignment | radio | start, **center** |
| spacing | select | compact, **comfortable**, spacious |
| headingLevel | select | **h2**, h3, h4 |
| showQuoteMark | toggle | **true** |

Points worth copying into every component:
- `tone` values are pre-approved surface/text token pairs.
- Heading level is a setting and is rendered with `@switch`, never by building tag names dynamically.
- `figcaption` stays a direct child of `figure`; layout uses grid areas instead of wrapper divs, because invalid nesting is a real accessibility bug that axe does not always catch.
- Decorative glyphs are `aria-hidden="true"`.
- The definition lives in its own file so the schema never imports the component (avoids an import cycle).
- Tests iterate `settingsVariants(SCHEMA)` instead of listing values by hand, so a new option value is tested the moment it is added.

## Files

### `lib/components/testimonial/testimonial.schema.ts`

```ts
// components/testimonial/testimonial.schema.ts
import { CmsImage } from '../../cms-content';
import { CmsStyleSchema } from '../../cms-schema';

export interface TestimonialSettings {
  tone: 'light' | 'muted' | 'brand';
  layout: 'stacked' | 'media-start';
  alignment: 'start' | 'center';
  spacing: 'compact' | 'comfortable' | 'spacious';
  headingLevel: 'h2' | 'h3' | 'h4';
  showQuoteMark: boolean;
}

export interface TestimonialContent {
  /** Optional section heading above the quote. */
  readonly heading?: string;
  readonly quote: string;
  readonly author: string;
  /** e.g. "Owner, Law's Paws". */
  readonly role?: string;
  readonly image?: CmsImage;
}

export const TESTIMONIAL_SCHEMA: CmsStyleSchema<TestimonialSettings> = {
  tone: {
    kind: 'radio',
    label: 'Colour scheme',
    hint: 'Each scheme uses brand colours that meet contrast requirements.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'muted', label: 'Soft grey' },
      { value: 'brand', label: 'Brand' },
    ],
    default: 'light',
  },
  layout: {
    kind: 'radio',
    label: 'Layout',
    options: [
      { value: 'stacked', label: 'Photo above quote' },
      { value: 'media-start', label: 'Photo beside quote' },
    ],
    default: 'stacked',
  },
  alignment: {
    kind: 'radio',
    label: 'Text alignment',
    options: [
      { value: 'start', label: 'Left' },
      { value: 'center', label: 'Centre' },
    ],
    default: 'center',
  },
  spacing: {
    kind: 'select',
    label: 'Spacing',
    options: [
      { value: 'compact', label: 'Compact' },
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'spacious', label: 'Spacious' },
    ],
    default: 'comfortable',
  },
  headingLevel: {
    kind: 'select',
    label: 'Heading level',
    hint: 'Choose the level that fits the page outline. Use H2 for a top-level section.',
    options: [
      { value: 'h2', label: 'H2' },
      { value: 'h3', label: 'H3' },
      { value: 'h4', label: 'H4' },
    ],
    default: 'h2',
  },
  showQuoteMark: { kind: 'toggle', label: 'Show decorative quote mark', default: true },
};

export const TESTIMONIAL_SAMPLE_CONTENT: TestimonialContent = {
  heading: 'What our clients say',
  quote: 'Bella came home calm, fluffy and smelling wonderful. The photo report made my day.',
  author: 'Jamie Robertson',
  role: 'Owner of Bella, cockapoo',
  image: { src: '/cms-samples/testimonial-avatar.jpg', alt: 'Jamie smiling with Bella the cockapoo', width: 160, height: 160 },
};
```

### `lib/components/testimonial/testimonial.component.ts`

```ts
// components/testimonial/testimonial.component.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { TESTIMONIAL_SCHEMA, TestimonialContent, TestimonialSettings } from './testimonial.schema';

let nextId = 0;

/**
 * A customer quote with optional heading, photo and attribution.
 * Styling comes only from `settings`, validated against TESTIMONIAL_SCHEMA,
 * so stored CMS data from older versions still renders safely.
 */
@Component({
  selector: 'cms-testimonial',
  standalone: true,
  templateUrl: './testimonial.component.html',
  styleUrl: './testimonial.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
})
export class CmsTestimonialComponent {
  readonly content = input.required<TestimonialContent>();
  /** Raw settings from the CMS. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<TestimonialSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly headingId = `cms-testimonial-heading-${nextId++}`;
  protected readonly resolved = computed(() => resolveSettings(TESTIMONIAL_SCHEMA, this.settings()));
  protected readonly hostClasses = computed(() =>
    ['cms-testimonial', ...modifierClasses('cms-testimonial', TESTIMONIAL_SCHEMA, this.resolved())].join(' '),
  );
}
```

### `lib/components/testimonial/testimonial.component.html`

```html
<section class="cms-testimonial__inner" [attr.aria-labelledby]="content().heading ? headingId : null">
  @if (content().heading; as heading) {
    @switch (resolved().headingLevel) {
      @case ('h3') {
        <h3 class="cms-testimonial__heading" [id]="headingId">{{ heading }}</h3>
      }
      @case ('h4') {
        <h4 class="cms-testimonial__heading" [id]="headingId">{{ heading }}</h4>
      }
      @default {
        <h2 class="cms-testimonial__heading" [id]="headingId">{{ heading }}</h2>
      }
    }
  }

  <figure class="cms-testimonial__figure">
    @if (content().image; as image) {
      <img
        class="cms-testimonial__image"
        [src]="image.src"
        [alt]="image.alt"
        [attr.width]="image.width ?? null"
        [attr.height]="image.height ?? null"
        loading="lazy"
        decoding="async"
      />
    }

    <blockquote class="cms-testimonial__quote">
      @if (resolved().showQuoteMark) {
        <span class="cms-testimonial__mark" aria-hidden="true">&ldquo;</span>
      }
      <p>{{ content().quote }}</p>
    </blockquote>

    <!-- figcaption must be a direct child of figure, so layout uses grid areas rather than a wrapper. -->
    <figcaption class="cms-testimonial__caption">
      <span class="cms-testimonial__author">{{ content().author }}</span>
      @if (content().role; as role) {
        <span class="cms-testimonial__role">{{ role }}</span>
      }
    </figcaption>
  </figure>
</section>
```

### `lib/components/testimonial/testimonial.component.scss`

```scss
// components/testimonial/testimonial.component.scss
// Only Novan tokens and rem. Every option maps to a host modifier class derived from the schema.
:host {
  --cms-testimonial-surface: var(--ds-color-surface-body);
  --cms-testimonial-text: var(--ds-color-text-body);
  --cms-testimonial-secondary-text: var(--ds-color-text-muted);
  --cms-testimonial-accent: var(--ds-color-brand-primary);
  --cms-testimonial-padding-block: var(--ds-spacing-scale-6);
  --cms-testimonial-gap: var(--ds-spacing-scale-4);
  --cms-testimonial-avatar-size: 5rem;

  display: block;
  padding-block: var(--cms-testimonial-padding-block);
  background-color: var(--cms-testimonial-surface);
  color: var(--cms-testimonial-text);
}

// tone: each tone is a pre-approved surface/text pair, so editors cannot create a low-contrast combination.
:host(.cms-testimonial--tone-muted) {
  --cms-testimonial-surface: var(--ds-color-surface-muted);
}

:host(.cms-testimonial--tone-brand) {
  --cms-testimonial-surface: var(--ds-color-brand-primary);
  --cms-testimonial-text: var(--ds-color-text-inverse);
  --cms-testimonial-secondary-text: var(--ds-color-text-inverse);
  --cms-testimonial-accent: var(--ds-color-text-inverse);
}

// spacing
:host(.cms-testimonial--spacing-compact) {
  --cms-testimonial-padding-block: var(--ds-spacing-scale-4);
  --cms-testimonial-gap: var(--ds-spacing-scale-3);
}

:host(.cms-testimonial--spacing-spacious) {
  --cms-testimonial-padding-block: var(--ds-spacing-scale-8);
  --cms-testimonial-gap: var(--ds-spacing-scale-5);
}

.cms-testimonial__inner {
  display: grid;
  gap: var(--cms-testimonial-gap);
  max-inline-size: 60rem;
  margin-inline: auto;
  padding-inline: var(--ds-spacing-scale-4);
}

.cms-testimonial__heading {
  margin: 0;
  font-family: var(--ds-font-family-heading);
}

.cms-testimonial__figure {
  display: grid;
  grid-template-areas:
    'media'
    'quote'
    'caption';
  gap: var(--cms-testimonial-gap);
  justify-items: start;
  margin: 0;
}

// layout
:host(.cms-testimonial--layout-media-start) .cms-testimonial__figure {
  @media (min-width: 48rem) {
    grid-template-areas:
      'media quote'
      'media caption';
    grid-template-columns: auto 1fr;
    align-items: start;
  }
}

// alignment
:host(.cms-testimonial--alignment-center) {
  .cms-testimonial__inner,
  .cms-testimonial__figure {
    text-align: center;
    justify-items: center;
  }
}

.cms-testimonial__image {
  grid-area: media;
  inline-size: var(--cms-testimonial-avatar-size);
  block-size: auto;
  aspect-ratio: 1;
  border-radius: 50%;
  object-fit: cover;
}

.cms-testimonial__quote {
  grid-area: quote;
  margin: 0;
  font-size: var(--ds-font-size-lg);

  p {
    margin: 0;
  }
}

.cms-testimonial__mark {
  display: block;
  font-family: var(--ds-font-family-heading);
  font-size: var(--ds-font-size-h1);
  line-height: 1;
  color: var(--cms-testimonial-accent);
}

.cms-testimonial__caption {
  grid-area: caption;
  display: grid;
  gap: var(--ds-spacing-scale-1);
}

.cms-testimonial__author {
  font-weight: var(--ds-font-weight-semibold);
}

.cms-testimonial__role {
  color: var(--cms-testimonial-secondary-text);
}

@media (forced-colors: active) {
  :host {
    border-block: 0.0625rem solid CanvasText;
  }
}
```

### `lib/components/testimonial/testimonial.definition.ts`

```ts
// components/testimonial/testimonial.definition.ts — kept separate from the schema to avoid a schema → component import cycle.
import { defineCmsComponent } from '../../cms-registry';
import { CmsTestimonialComponent } from './testimonial.component';
import { TESTIMONIAL_SAMPLE_CONTENT, TESTIMONIAL_SCHEMA } from './testimonial.schema';

export const TESTIMONIAL_DEFINITION = defineCmsComponent({
  type: 'testimonial',
  name: 'Testimonial',
  component: CmsTestimonialComponent,
  settingsSchema: TESTIMONIAL_SCHEMA,
  sampleContent: TESTIMONIAL_SAMPLE_CONTENT,
});
```

### `lib/components/testimonial/index.ts`

```ts
// components/testimonial/index.ts
export * from './testimonial.component';
export * from './testimonial.definition';
export * from './testimonial.schema';
```

### `lib/components/testimonial/testimonial.component.spec.ts`

```ts
// components/testimonial/testimonial.component.spec.ts
import { TestBed } from '@angular/core/testing';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { settingsVariants } from '../../testing/cms-testing';
import { CmsTestimonialComponent } from './testimonial.component';
import { TESTIMONIAL_DEFINITION } from './testimonial.definition';
import { TESTIMONIAL_SAMPLE_CONTENT, TESTIMONIAL_SCHEMA, TestimonialContent } from './testimonial.schema';

/** The public CSS contract: `cms-testimonial--<option>-<value>` for choices, `cms-testimonial--<option>` for toggles. */
const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function render(content: TestimonialContent = TESTIMONIAL_SAMPLE_CONTENT, settings?: unknown) {
  const fixture = TestBed.createComponent(CmsTestimonialComponent);
  fixture.componentRef.setInput('content', content);
  if (settings !== undefined) {
    fixture.componentRef.setInput('settings', settings);
  }
  fixture.detectChanges();
  const host: HTMLElement = fixture.nativeElement;
  return { fixture, host };
}

describe('CmsTestimonialComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CmsTestimonialComponent, CmsStylePanelComponent] });
  });

  describe('content', () => {
    it('renders the heading, quote, author, role and image', () => {
      const { host } = render();

      expect(host.querySelector('h2')?.textContent).toBe('What our clients say');
      expect(host.querySelector('blockquote p')?.textContent).toContain('Bella came home calm');
      expect(host.querySelector('.cms-testimonial__author')?.textContent).toBe('Jamie Robertson');
      expect(host.querySelector('.cms-testimonial__role')?.textContent).toBe('Owner of Bella, cockapoo');
      expect(host.querySelector('img')?.getAttribute('alt')).toBe('Jamie smiling with Bella the cockapoo');
    });

    it('names the section by its heading', () => {
      const { host } = render();

      const section = host.querySelector('section')!;
      const heading = host.querySelector('h2')!;
      expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    });

    it('omits the heading, image and role cleanly when they are not provided', () => {
      const { host } = render({ quote: 'Lovely.', author: 'Sam' });

      expect(host.querySelector('h2, h3, h4')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('.cms-testimonial__role')).toBeNull();
    });

    it('keeps an empty alt for decorative images', () => {
      const { host } = render({ ...TESTIMONIAL_SAMPLE_CONTENT, image: { src: '/x.jpg', alt: '' } });

      expect(host.querySelector('img')?.getAttribute('alt')).toBe('');
    });

    it('updates in place when content changes after the first render (live preview)', () => {
      const { fixture, host } = render({ quote: 'First draft.', author: 'Sam' });
      expect(host.querySelector('h2')).toBeNull();

      fixture.componentRef.setInput('content', { ...TESTIMONIAL_SAMPLE_CONTENT, quote: 'Edited quote.' });
      fixture.detectChanges();
      expect(host.querySelector('blockquote p')?.textContent).toBe('Edited quote.');
      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);

      fixture.componentRef.setInput('content', { quote: 'Edited quote.', author: 'Sam' });
      fixture.detectChanges();
      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    });

    it('gives each instance a unique heading id', () => {
      const first = render().host.querySelector('h2')!.id;
      const second = render().host.querySelector('h2')!.id;

      expect(first).not.toBe(second);
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      const { host } = render();

      expect(host.className.split(' ').sort()).toEqual(
        [
          'cms-testimonial',
          'cms-testimonial--tone-light',
          'cms-testimonial--layout-stacked',
          'cms-testimonial--alignment-center',
          'cms-testimonial--spacing-comfortable',
          'cms-testimonial--heading-level-h2',
          'cms-testimonial--show-quote-mark',
        ].sort(),
      );
    });

    it.each(settingsVariants(TESTIMONIAL_SCHEMA).filter((variant) => variant.key !== null))(
      'applies $name',
      ({ key, value, settings }) => {
        const { host } = render(TESTIMONIAL_SAMPLE_CONTENT, settings);
        const option = kebab(key!);

        if (typeof value === 'boolean') {
          expect(host.classList.contains(`cms-testimonial--${option}`)).toBe(value);
        } else {
          expect(host.classList).toContain(`cms-testimonial--${option}-${value}`);
        }
      },
    );

    it.each(['h2', 'h3', 'h4'] as const)('renders the heading as %s', (headingLevel) => {
      const { host } = render(TESTIMONIAL_SAMPLE_CONTENT, { headingLevel });

      expect(host.querySelector(headingLevel)?.textContent).toBe('What our clients say');
      expect(host.querySelectorAll('h2, h3, h4').length).toBe(1);
    });

    it('hides the decorative quote mark from assistive technology and removes it when switched off', () => {
      const shown = render(TESTIMONIAL_SAMPLE_CONTENT, { showQuoteMark: true }).host;
      expect(shown.querySelector('.cms-testimonial__mark')?.getAttribute('aria-hidden')).toBe('true');

      const hidden = render(TESTIMONIAL_SAMPLE_CONTENT, { showQuoteMark: false }).host;
      expect(hidden.querySelector('.cms-testimonial__mark')).toBeNull();
    });

    it.each([
      ['unknown values', { tone: 'neon', layout: 'diagonal' }],
      ['wrong types', { headingLevel: 2, showQuoteMark: 'yes' }],
      ['retired keys', { colour: 'red', legacyTheme: true }],
      ['null', null],
      ['an array', []],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(TESTIMONIAL_SAMPLE_CONTENT, stored);

      expect(host.classList).toContain('cms-testimonial--tone-light');
      expect(host.classList).toContain('cms-testimonial--layout-stacked');
      expect(host.querySelector('h2')).not.toBeNull();
      expect(host.className).not.toMatch(/neon|diagonal|red|legacy/);
    });

    it('updates when settings change', () => {
      const { fixture, host } = render(TESTIMONIAL_SAMPLE_CONTENT, { tone: 'light' });

      fixture.componentRef.setInput('settings', { tone: 'brand' });
      fixture.detectChanges();

      expect(host.classList).toContain('cms-testimonial--tone-brand');
      expect(host.classList).not.toContain('cms-testimonial--tone-light');
    });
  });

  describe('editor panel', () => {
    function renderPanel() {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', TESTIMONIAL_DEFINITION);
      fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      return { fixture, element };
    }

    it('offers a control for every styling option', () => {
      const { element } = renderPanel();
      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());

      for (const field of Object.values(TESTIMONIAL_SCHEMA)) {
        expect(labels).toContain(field.label);
      }
    });

    it('updates the live preview when an editor picks a tone', () => {
      const { fixture, element } = renderPanel();

      element.querySelector<HTMLInputElement>('input[type="radio"][value="brand"]')!.click();
      fixture.detectChanges();

      expect(element.querySelector('cms-testimonial')?.classList).toContain('cms-testimonial--tone-brand');
      expect(fixture.componentInstance.settings()).toMatchObject({ tone: 'brand' });
    });
  });
});
```

### `lib/components/testimonial/testimonial.a11y.spec.ts`

```ts
// components/testimonial/testimonial.a11y.spec.ts
// axe-core in jsdom: structure, names, roles, ARIA, landmarks, headings, alt text.
// Colour contrast cannot be computed in jsdom; it is covered by the Playwright axe test that runs against the editor app.
import { TestBed } from '@angular/core/testing';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, settingsVariants } from '../../testing/cms-testing';
import { CmsTestimonialComponent } from './testimonial.component';
import { TESTIMONIAL_DEFINITION } from './testimonial.definition';
import { TESTIMONIAL_SAMPLE_CONTENT, TESTIMONIAL_SCHEMA, TestimonialContent } from './testimonial.schema';

function render(content: TestimonialContent = TESTIMONIAL_SAMPLE_CONTENT, settings?: unknown): HTMLElement {
  const fixture = TestBed.createComponent(CmsTestimonialComponent);
  fixture.componentRef.setInput('content', content);
  if (settings !== undefined) {
    fixture.componentRef.setInput('settings', settings);
  }
  fixture.detectChanges();
  return fixture.nativeElement;
}

describe('CmsTestimonialComponent accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CmsTestimonialComponent, CmsStylePanelComponent] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(TESTIMONIAL_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(TESTIMONIAL_SAMPLE_CONTENT, settings));
  });

  it('has no violations with minimal content', async () => {
    await expectNoAxeViolations(render({ quote: 'Lovely.', author: 'Sam' }));
  });

  it('has no violations with a decorative image', async () => {
    await expectNoAxeViolations(render({ ...TESTIMONIAL_SAMPLE_CONTENT, image: { src: '/x.jpg', alt: '' } }));
  });

  it('has no violations with long content', async () => {
    const long = 'The team were patient, gentle and thorough from start to finish. '.repeat(12);
    await expectNoAxeViolations(
      render({ ...TESTIMONIAL_SAMPLE_CONTENT, heading: long.slice(0, 120), quote: long, role: long.slice(0, 80) }),
    );
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', TESTIMONIAL_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
```


## Browser contrast check (Playwright, against the editor app)

jsdom cannot measure colour contrast, so one Playwright test per component runs axe in a real browser. It goes through the editor app's own style panel: open the route that shows the component's panel, pick each tone with the real controls, and scan the panel plus live preview. This also proves the editor works end to end. Put it in the editor app's e2e folder and set `EDITOR_ROUTE` to the app's real route for this block type. Reuse an existing shared `expectNoViolations` helper if the workspace has one.

### `<editor-app>/e2e/a11y/testimonial.a11y.spec.ts`

```ts
// e2e/a11y/testimonial.a11y.spec.ts — real-browser axe scan, including colour contrast, through the editor app's own style panel.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** The editor-app route that shows this component's style panel. Use the app's real route. */
const EDITOR_ROUTE = '/blocks/testimonial';

async function expectNoViolations(page: Page): Promise<void> {
  // Settle transitions so axe doesn't sample colours mid-fade.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });

  const results = await new AxeBuilder({ page })
    .include('cms-style-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('Testimonial in the editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EDITOR_ROUTE);
    await page.locator('cms-style-panel cms-testimonial').waitFor();
  });

  test('default settings have no violations', async ({ page }) => {
    await expectNoViolations(page);
  });

  // Every colour option is scanned in a real browser, which is the only place contrast can be measured.
  for (const tone of ['Light', 'Soft grey', 'Brand']) {
    test(`tone "${tone}" has no violations`, async ({ page }) => {
      await page.getByRole('group', { name: 'Colour scheme' }).getByLabel(tone, { exact: true }).check();
      await expectNoViolations(page);
    });
  }

  test('editor changes reach the live preview', async ({ page }) => {
    await page.getByRole('group', { name: 'Colour scheme' }).getByLabel('Brand', { exact: true }).check();
    await expect(page.locator('cms-testimonial')).toHaveClass(/cms-testimonial--tone-brand/);
  });

  test('every control is reachable with the keyboard', async ({ page }) => {
    const controls = page.locator('cms-style-panel').locator('select, input[type="checkbox"], button');
    const count = await controls.count();
    for (let index = 0; index < count; index++) {
      await controls.nth(index).focus();
      await expect(controls.nth(index)).toBeFocused();
    }
  });
});
```

## Registration

```ts
// lib/cms-components.ts
export const CMS_COMPONENT_DEFINITIONS = [TESTIMONIAL_DEFINITION /*, ...others */] as const;

// public-api.ts
export * from './lib/components/testimonial';
```
