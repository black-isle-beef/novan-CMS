// components/card-grid/card-grid.component.spec.ts
import { TestBed } from '@angular/core/testing';
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { CardGridBlock } from './card-grid.component';
import { CARD_GRID_DEFINITION } from './card-grid.definition';
import { CARD_GRID_SAMPLE_CONTENT, CARD_GRID_SCHEMA, type CardGridFields } from './card-grid.schema';

const photo = CARD_GRID_SAMPLE_CONTENT.cards?.[0].image as NovanAsset;
const render = (content: Partial<CardGridFields> = CARD_GRID_SAMPLE_CONTENT, settings?: unknown) =>
  renderBlock(CardGridBlock, content, settings);

describe('CardGridBlock', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CardGridBlock, CmsStylePanelComponent] });
  });

  it('declares the block it renders', () => {
    expect(CardGridBlock.novanBlock).toEqual({ apiId: 'cardGrid', schemaVersion: 1 });
  });

  describe('content', () => {
    it('renders the heading, introduction and a list of cards', () => {
      const { host } = render();

      expect(host.querySelector('h2')?.textContent).toBe('Recently pampered');
      expect(host.querySelector('.novan-card-grid-block__intro')?.textContent).toContain('A few of the dogs');
      const cards = host.querySelectorAll('ul > li');
      expect(cards).toHaveLength(3);
      expect(cards[0].querySelector('img')?.getAttribute('alt')).toBe(photo.alt);
      expect(cards[0].querySelector('h3')?.textContent).toBe('Bramble');
      expect(cards[0].querySelector('.novan-card-grid-block__subtitle')?.textContent).toBe('Cockapoo');
      expect(cards[0].querySelector('.ds-badge')?.textContent).toBe('Full groom');
    });

    it('names the section by its heading', () => {
      const { host } = render();

      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    });

    it('offers image sizes that follow the column count', () => {
      expect(
        render(CARD_GRID_SAMPLE_CONTENT, { columns: 'four' }).host.querySelector('img')?.getAttribute('sizes'),
      ).toContain('25vw');
    });

    it('keeps photo-only and text-only cards, and skips empty and malformed ones', () => {
      const { host } = render({
        cards: [
          { image: photo, title: '' },
          { title: 'No photo', subtitle: '', tag: null },
          { title: '  ' },
          { image: 'photo.jpg' as never, title: '' },
          null as never,
          'card' as never,
        ],
      });

      const cards = host.querySelectorAll('li');
      expect(cards).toHaveLength(2);
      expect(cards[0].querySelector('.novan-card-grid-block__body')).toBeNull();
      expect(cards[1].querySelector('img, .novan-card-grid-block__subtitle, .ds-badge')).toBeNull();
    });

    it('renders a decorative photo with empty alt text', () => {
      expect(
        render({ cards: [{ image: { ...photo, alt: null }, title: 'Bramble' }] })
          .host.querySelector('img')
          ?.getAttribute('alt'),
      ).toBe('');
    });

    it('leaves out the heading, introduction and list when they are empty', () => {
      const { host } = render({ heading: '', intro: undefined, cards: [] });

      expect(host.querySelector('h2, h3, h4, p, ul')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    });

    it('updates in place when content changes (live preview)', () => {
      const { fixture, host } = render({ cards: [{ title: 'One' }] });
      expect(host.querySelector('h2')?.textContent).toBe('One');

      fixture.componentRef.setInput('heading', 'Added heading');
      fixture.componentRef.setInput('cards', [{ title: 'One', image: photo }, { title: 'Two' }]);
      fixture.detectChanges();
      expect(host.querySelector('h2')?.textContent).toBe('Added heading');
      expect([...host.querySelectorAll('li h3')].map((h) => h.textContent)).toEqual(['One', 'Two']);
      expect(host.querySelectorAll('img')).toHaveLength(1);

      fixture.componentRef.setInput('heading', '');
      fixture.componentRef.setInput('cards', null);
      fixture.detectChanges();
      expect(host.querySelector('ul, h2, h3, img')).toBeNull();
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      expect(render().host.className.split(' ').sort()).toEqual(
        [
          'novan-card-grid-block',
          'novan-card-grid-block--columns-three',
          'novan-card-grid-block--tone-light',
          'novan-card-grid-block--heading-level-h2',
        ].sort(),
      );
    });

    it.each(settingsVariants(CARD_GRID_SCHEMA).filter((variant) => variant.key !== null))(
      'applies $name',
      ({ key, value, settings }) => {
        expect(render(CARD_GRID_SAMPLE_CONTENT, settings).host.classList).toContain(
          `novan-card-grid-block--${kebab(key as string)}-${String(value)}`,
        );
      },
    );

    it.each([
      ['h2', 'h3'],
      ['h3', 'h4'],
      ['h4', 'h5'],
    ] as const)('with a %s heading, card titles are %s', (headingLevel, itemLevel) => {
      const { host } = render(CARD_GRID_SAMPLE_CONTENT, { headingLevel });

      expect(host.querySelector(`section > ${headingLevel}`)?.textContent).toBe('Recently pampered');
      expect(host.querySelectorAll(`li ${itemLevel}`)).toHaveLength(3);
    });

    it('without a heading, card titles take the heading level', () => {
      const { host } = render({ cards: CARD_GRID_SAMPLE_CONTENT.cards }, { headingLevel: 'h3' });

      expect(host.querySelectorAll('li h3')).toHaveLength(3);
    });

    it.each([
      ['unknown values', { columns: 'nine', tone: 'neon' }],
      ['wrong types', { headingLevel: 2 }],
      ['null', null],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(CARD_GRID_SAMPLE_CONTENT, stored);

      expect(host.classList).toContain('novan-card-grid-block--columns-three');
      expect(host.classList).toContain('novan-card-grid-block--tone-light');
      expect(host.querySelector('section > h2')).not.toBeNull();
    });

    it('updates when settings change', () => {
      const { fixture, host } = render();

      fixture.componentRef.setInput('settings', { columns: 'two', headingLevel: 'h3' });
      fixture.detectChanges();

      expect(host.classList).toContain('novan-card-grid-block--columns-two');
      expect(host.querySelector('section > h3')).not.toBeNull();
      expect(host.querySelectorAll('li h4')).toHaveLength(3);
    });
  });

  describe('editor panel', () => {
    it('offers a control for every style option and updates the preview', () => {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', CARD_GRID_DEFINITION);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
      for (const field of Object.values(CARD_GRID_SCHEMA)) expect(labels).toContain(field.label);

      element.querySelector<HTMLInputElement>('input[type="radio"][value="four"]')?.click();
      fixture.detectChanges();
      expect(element.querySelector('novan-card-grid-block')?.classList).toContain(
        'novan-card-grid-block--columns-four',
      );
    });
  });
});
