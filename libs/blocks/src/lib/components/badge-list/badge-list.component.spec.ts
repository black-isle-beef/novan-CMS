// components/badge-list/badge-list.component.spec.ts
import { TestBed } from '@angular/core/testing';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { BadgeListBlock } from './badge-list.component';
import { BADGE_LIST_DEFINITION } from './badge-list.definition';
import { BADGE_LIST_SAMPLE_CONTENT, BADGE_LIST_SCHEMA, type BadgeListFields } from './badge-list.schema';

const render = (content: Partial<BadgeListFields> = BADGE_LIST_SAMPLE_CONTENT, settings?: unknown) =>
  renderBlock(BadgeListBlock, content, settings);

describe('BadgeListBlock', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BadgeListBlock, CmsStylePanelComponent] });
  });

  it('declares the block it renders', () => {
    expect(BadgeListBlock.novanBlock).toEqual({ apiId: 'badgeList', schemaVersion: 1 });
  });

  describe('content', () => {
    it('renders the heading, introduction and a list of design-system badges', () => {
      const { host } = render();

      expect(host.querySelector('h2')?.textContent).toBe('Qualified and trusted');
      expect(host.querySelector('.novan-badge-list-block__intro')?.textContent).toContain('The training');
      const badges = host.querySelectorAll('ul > li.ds-badge');
      expect([...badges].map((badge) => badge.textContent)).toEqual([
        'City & Guilds Level 3 dog grooming',
        'Pet first aid',
        'Fully insured',
      ]);
    });

    it('names the section by its heading', () => {
      const { host } = render();

      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    });

    it('skips empty labels and malformed items', () => {
      const { host } = render({
        badges: [{ label: 'Kept' }, { label: '  ' }, null as never, 'text' as never, { label: 3 } as never],
      });

      expect([...host.querySelectorAll('li')].map((badge) => badge.textContent)).toEqual(['Kept']);
    });

    it('leaves out the heading, introduction and list when they are empty', () => {
      const { host } = render({ heading: '', intro: undefined, badges: [] });

      expect(host.querySelector('h2, h3, h4, p, ul')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    });

    it('updates in place when content changes (live preview)', () => {
      const { fixture, host } = render({ badges: [{ label: 'One' }] });
      expect(host.querySelector('h2')).toBeNull();

      fixture.componentRef.setInput('heading', 'Added heading');
      fixture.componentRef.setInput('badges', [{ label: 'One' }, { label: 'Two' }]);
      fixture.detectChanges();
      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
      expect([...host.querySelectorAll('li')].map((badge) => badge.textContent)).toEqual(['One', 'Two']);

      fixture.componentRef.setInput('heading', '');
      fixture.componentRef.setInput('badges', null);
      fixture.detectChanges();
      expect(host.querySelector('ul, h2')).toBeNull();
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      expect(render().host.className.split(' ').sort()).toEqual(
        [
          'novan-badge-list-block',
          'novan-badge-list-block--tone-light',
          'novan-badge-list-block--alignment-start',
          'novan-badge-list-block--heading-level-h2',
        ].sort(),
      );
    });

    it.each(settingsVariants(BADGE_LIST_SCHEMA).filter((variant) => variant.key !== null))(
      'applies $name',
      ({ key, value, settings }) => {
        expect(render(BADGE_LIST_SAMPLE_CONTENT, settings).host.classList).toContain(
          `novan-badge-list-block--${kebab(key as string)}-${String(value)}`,
        );
      },
    );

    it.each(['h2', 'h3', 'h4'] as const)('renders the heading as %s', (headingLevel) => {
      expect(render(BADGE_LIST_SAMPLE_CONTENT, { headingLevel }).host.querySelector(headingLevel)?.textContent).toBe(
        'Qualified and trusted',
      );
    });

    it.each([
      ['unknown values', { tone: 'neon', alignment: 'right' }],
      ['wrong types', { headingLevel: 2 }],
      ['null', null],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(BADGE_LIST_SAMPLE_CONTENT, stored);

      expect(host.classList).toContain('novan-badge-list-block--tone-light');
      expect(host.classList).toContain('novan-badge-list-block--alignment-start');
      expect(host.querySelector('h2')).not.toBeNull();
    });

    it('updates when settings change', () => {
      const { fixture, host } = render();

      fixture.componentRef.setInput('settings', { alignment: 'center', headingLevel: 'h4' });
      fixture.detectChanges();

      expect(host.classList).toContain('novan-badge-list-block--alignment-center');
      expect(host.querySelector('h4')).not.toBeNull();
    });
  });

  describe('editor panel', () => {
    it('offers a control for every style option and updates the preview', () => {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', BADGE_LIST_DEFINITION);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
      for (const field of Object.values(BADGE_LIST_SCHEMA)) expect(labels).toContain(field.label);

      element.querySelector<HTMLInputElement>('input[type="radio"][value="center"]')?.click();
      fixture.detectChanges();
      expect(element.querySelector('novan-badge-list-block')?.classList).toContain(
        'novan-badge-list-block--alignment-center',
      );
    });
  });
});
