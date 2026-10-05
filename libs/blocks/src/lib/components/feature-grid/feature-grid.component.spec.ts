// components/feature-grid/feature-grid.component.spec.ts
import { TestBed } from '@angular/core/testing';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { seededBlockTypes } from '../../../testing/seeded-block-types';
import { FeatureGridBlock } from './feature-grid.component';
import { FEATURE_GRID_DEFINITION } from './feature-grid.definition';
import { FEATURE_GRID_SAMPLE_CONTENT, FEATURE_GRID_SCHEMA, FEATURE_ICONS, type FeatureGridFields } from './feature-grid.schema';

const render = (content: Partial<FeatureGridFields> = FEATURE_GRID_SAMPLE_CONTENT, settings?: unknown) =>
  renderBlock(FeatureGridBlock, content, settings);

describe('FeatureGridBlock', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FeatureGridBlock, CmsStylePanelComponent] });
  });

  it('declares the block it renders', () => {
    expect(FeatureGridBlock.novanBlock).toEqual({ apiId: 'featureGrid', schemaVersion: 1 });
  });

  it('knows every icon editors can pick, and only those', () => {
    const seeded = seededBlockTypes().find((type) => type.apiId === 'featureGrid');
    const icon = seeded?.fields.find((field) => field.apiId === 'features')?.fields?.find((field) => field.apiId === 'icon');

    expect(icon?.options?.map((option) => option.value)).toEqual([...FEATURE_ICONS]);
  });

  describe('content', () => {
    it('renders the heading, introduction and a list of features', () => {
      const { host } = render();

      expect(host.querySelector('h2')?.textContent).toBe('Why owners choose us');
      expect(host.querySelector('.novan-feature-grid-block__intro')?.textContent).toContain('Small touches');
      const items = host.querySelectorAll('ul > li');
      expect(items).toHaveLength(3);
      expect(items[0].querySelector('h3')?.textContent).toBe('Calm handling');
      expect(items[0].querySelector('p')?.textContent).toContain('Breaks whenever');
    });

    it('shows each icon as decoration only', () => {
      const icon = render().host.querySelector('li i');

      expect(icon?.classList).toContain('bi');
      expect(icon?.classList).toContain('bi-heart');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });

    it('names the section by its heading', () => {
      const { host } = render();

      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    });

    it('skips unknown icons, empty features and malformed items', () => {
      const { host } = render({
        features: [
          { icon: 'skull' as never, title: 'Unknown icon' },
          { title: '  ', text: '' },
          null as never,
          'text' as never,
          { title: 'Text only' as string, text: null },
        ],
      });

      const items = host.querySelectorAll('li');
      expect(items).toHaveLength(2);
      expect(items[0].querySelector('i')).toBeNull();
      expect(items[1].querySelector('p')).toBeNull();
    });

    it('leaves out the heading, introduction and list when they are empty', () => {
      const { host } = render({ heading: '', intro: undefined, features: [] });

      expect(host.querySelector('h2, h3, h4, p, ul')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    });

    it('updates in place when content changes (live preview)', () => {
      const { fixture, host } = render({ features: [{ title: 'One' }] });
      expect(host.querySelector('h2')?.textContent).toBe('One');

      fixture.componentRef.setInput('heading', 'Added heading');
      fixture.componentRef.setInput('features', [{ title: 'One' }, { title: 'Two' }]);
      fixture.detectChanges();
      expect(host.querySelector('h2')?.textContent).toBe('Added heading');
      expect([...host.querySelectorAll('li h3')].map((h) => h.textContent)).toEqual(['One', 'Two']);

      fixture.componentRef.setInput('heading', '');
      fixture.componentRef.setInput('features', null);
      fixture.detectChanges();
      expect(host.querySelector('ul, h2, h3')).toBeNull();
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      expect(render().host.className.split(' ').sort()).toEqual(
        [
          'novan-feature-grid-block',
          'novan-feature-grid-block--columns-three',
          'novan-feature-grid-block--tone-light',
          'novan-feature-grid-block--heading-level-h2',
        ].sort(),
      );
    });

    it.each(settingsVariants(FEATURE_GRID_SCHEMA).filter((variant) => variant.key !== null))('applies $name', ({ key, value, settings }) => {
      expect(render(FEATURE_GRID_SAMPLE_CONTENT, settings).host.classList).toContain(
        `novan-feature-grid-block--${kebab(key as string)}-${String(value)}`,
      );
    });

    it.each([
      ['h2', 'h3'],
      ['h3', 'h4'],
      ['h4', 'h5'],
    ] as const)('with a %s heading, feature titles are %s', (headingLevel, itemLevel) => {
      const { host } = render(FEATURE_GRID_SAMPLE_CONTENT, { headingLevel });

      expect(host.querySelector(`section > ${headingLevel}`)?.textContent).toBe('Why owners choose us');
      expect(host.querySelectorAll(`li > ${itemLevel}`)).toHaveLength(3);
    });

    it('without a heading, feature titles take the heading level', () => {
      const { host } = render({ features: FEATURE_GRID_SAMPLE_CONTENT.features }, { headingLevel: 'h3' });

      expect(host.querySelectorAll('li > h3')).toHaveLength(3);
    });

    it.each([
      ['unknown values', { columns: 'nine', tone: 'neon' }],
      ['wrong types', { headingLevel: 2 }],
      ['null', null],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(FEATURE_GRID_SAMPLE_CONTENT, stored);

      expect(host.classList).toContain('novan-feature-grid-block--columns-three');
      expect(host.classList).toContain('novan-feature-grid-block--tone-light');
      expect(host.querySelector('section > h2')).not.toBeNull();
    });

    it('updates when settings change', () => {
      const { fixture, host } = render();

      fixture.componentRef.setInput('settings', { columns: 'two', headingLevel: 'h3' });
      fixture.detectChanges();

      expect(host.classList).toContain('novan-feature-grid-block--columns-two');
      expect(host.querySelector('section > h3')).not.toBeNull();
      expect(host.querySelectorAll('li > h4')).toHaveLength(3);
    });
  });

  describe('editor panel', () => {
    it('offers a control for every style option and updates the preview', () => {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', FEATURE_GRID_DEFINITION);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
      for (const field of Object.values(FEATURE_GRID_SCHEMA)) expect(labels).toContain(field.label);

      element.querySelector<HTMLInputElement>('input[type="radio"][value="four"]')?.click();
      fixture.detectChanges();
      expect(element.querySelector('novan-feature-grid-block')?.classList).toContain('novan-feature-grid-block--columns-four');
    });
  });
});
