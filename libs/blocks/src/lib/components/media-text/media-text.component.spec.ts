// components/media-text/media-text.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { MediaTextBlock } from './media-text.component';
import { MEDIA_TEXT_DEFINITION } from './media-text.definition';
import { MEDIA_TEXT_SAMPLE_CONTENT, MEDIA_TEXT_SCHEMA, type MediaTextFields } from './media-text.schema';

const photo = MEDIA_TEXT_SAMPLE_CONTENT.image as NovanAsset;
const render = (content: Partial<MediaTextFields> = MEDIA_TEXT_SAMPLE_CONTENT, settings?: unknown) =>
  renderBlock(MediaTextBlock, content, settings);

describe('MediaTextBlock', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MediaTextBlock, CmsStylePanelComponent],
      providers: [provideRouter([])],
    });
  });

  it('declares the block it renders', () => {
    expect(MediaTextBlock.novanBlock).toEqual({ apiId: 'mediaText', schemaVersion: 1 });
  });

  describe('content', () => {
    it('renders the heading, a paragraph per blank-line-separated part, the image and the button', () => {
      const { host } = render();

      expect(host.querySelector('h2')?.textContent).toBe('Every groom ends with a report');
      const paragraphs = host.querySelectorAll('.novan-media-text-block__text');
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[1].textContent).toContain('Photos, the care we gave');
      const image = host.querySelector('img');
      expect(image?.getAttribute('alt')).toBe(photo.alt);
      expect(image?.getAttribute('width')).toBe('1200');
      expect(image?.getAttribute('srcset')).toContain('480w');
      const button = host.querySelector('a.btn');
      expect(button?.getAttribute('href')).toBe('/gallery');
      expect(button?.textContent?.trim()).toBe('See our gallery');
    });

    it('puts the text before the image in reading order', () => {
      const children = [...(render().host.querySelector('section')?.children ?? [])].map((child) => child.className);

      expect(children).toEqual(['novan-media-text-block__body', 'novan-media-text-block__media']);
    });

    it('names the section by its heading', () => {
      const { host } = render();

      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    });

    it('renders a decorative image with empty alt text', () => {
      expect(
        render({ ...MEDIA_TEXT_SAMPLE_CONTENT, image: { ...photo, alt: null } })
          .host.querySelector('img')
          ?.getAttribute('alt'),
      ).toBe('');
    });

    it('leaves out what is missing, without empty wrappers', () => {
      const { host } = render({ heading: 'Only a heading', text: '  ', image: null, action: null });

      expect(host.querySelector('p, img, .novan-media-text-block__media, novan-block-action')).toBeNull();
      expect(host.classList).toContain('novan-media-text-block--no-image');
    });

    it('ignores malformed stored values', () => {
      const { host } = render({
        heading: 42 as never,
        text: ['x'] as never,
        image: 'photo.jpg' as never,
        action: { type: 'internal' } as never,
      });

      expect(host.querySelector('h2, p, img, a')).toBeNull();
    });

    it('updates in place when content changes (live preview)', () => {
      const { fixture, host } = render({ text: 'Text first' });
      expect(host.querySelector('h2')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);

      fixture.componentRef.setInput('heading', 'Now a heading');
      fixture.componentRef.setInput('image', photo);
      fixture.detectChanges();
      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
      expect(host.querySelector('img')).not.toBeNull();
      expect(host.classList).not.toContain('novan-media-text-block--no-image');

      fixture.componentRef.setInput('heading', '');
      fixture.componentRef.setInput('image', null);
      fixture.detectChanges();
      expect(host.querySelector('h2, img')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      expect(render().host.className.split(' ').sort()).toEqual(
        [
          'novan-media-text-block',
          'novan-media-text-block--tone-light',
          'novan-media-text-block--image-position-end',
          'novan-media-text-block--heading-level-h2',
        ].sort(),
      );
    });

    it.each(settingsVariants(MEDIA_TEXT_SCHEMA).filter((variant) => variant.key !== null))(
      'applies $name',
      ({ key, value, settings }) => {
        expect(render(MEDIA_TEXT_SAMPLE_CONTENT, settings).host.classList).toContain(
          `novan-media-text-block--${kebab(key as string)}-${String(value)}`,
        );
      },
    );

    it.each(['h2', 'h3', 'h4'] as const)('renders the heading as %s', (headingLevel) => {
      expect(render(MEDIA_TEXT_SAMPLE_CONTENT, { headingLevel }).host.querySelector(headingLevel)?.textContent).toBe(
        'Every groom ends with a report',
      );
    });

    it('styles the button for the background it sits on', () => {
      expect(render(MEDIA_TEXT_SAMPLE_CONTENT, { tone: 'light' }).host.querySelector('a.btn')?.classList).toContain(
        'btn-hero-dark',
      );
      expect(render(MEDIA_TEXT_SAMPLE_CONTENT, { tone: 'brand' }).host.querySelector('a.btn')?.classList).toContain(
        'btn-hero-light',
      );
    });

    it.each([
      ['unknown values', { tone: 'neon', imagePosition: 'top' }],
      ['wrong types', { headingLevel: 2 }],
      ['null', null],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(MEDIA_TEXT_SAMPLE_CONTENT, stored);

      expect(host.classList).toContain('novan-media-text-block--tone-light');
      expect(host.classList).toContain('novan-media-text-block--image-position-end');
      expect(host.querySelector('h2')).not.toBeNull();
    });

    it('updates when settings change', () => {
      const { fixture, host } = render();

      fixture.componentRef.setInput('settings', { imagePosition: 'start', headingLevel: 'h3' });
      fixture.detectChanges();

      expect(host.classList).toContain('novan-media-text-block--image-position-start');
      expect(host.querySelector('h3')).not.toBeNull();
    });
  });

  describe('editor panel', () => {
    it('offers a control for every style option and updates the preview', () => {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', MEDIA_TEXT_DEFINITION);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
      for (const field of Object.values(MEDIA_TEXT_SCHEMA)) expect(labels).toContain(field.label);

      element.querySelector<HTMLInputElement>('input[type="radio"][value="start"]')?.click();
      fixture.detectChanges();
      expect(element.querySelector('novan-media-text-block')?.classList).toContain(
        'novan-media-text-block--image-position-start',
      );
    });
  });
});
