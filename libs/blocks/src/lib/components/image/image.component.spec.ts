// components/image/image.component.spec.ts
import { TestBed } from '@angular/core/testing';
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { ImageBlock } from './image.component';
import { IMAGE_DEFINITION } from './image.definition';
import { IMAGE_SAMPLE_CONTENT, IMAGE_SCHEMA, type ImageFields } from './image.schema';

const photo = IMAGE_SAMPLE_CONTENT.image as NovanAsset;
const render = (content: Partial<ImageFields> = IMAGE_SAMPLE_CONTENT, settings?: unknown) => renderBlock(ImageBlock, content, settings);

describe('ImageBlock', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ImageBlock, CmsStylePanelComponent] });
  });

  it('declares the block it renders', () => {
    expect(ImageBlock.novanBlock).toEqual({ apiId: 'image', schemaVersion: 1 });
  });

  describe('content', () => {
    it('renders a figure with the image, its alt text, size and caption', () => {
      const { host } = render();

      const img = host.querySelector('figure > img');
      expect(img?.getAttribute('alt')).toBe('The grooming salon, with a bath and two grooming tables');
      expect(img?.getAttribute('width')).toBe('1600');
      expect(img?.getAttribute('height')).toBe('900');
      expect(img?.getAttribute('loading')).toBe('lazy');
      expect(host.querySelector('figure > figcaption')?.textContent).toBe('Our salon on the high street.');
    });

    it('offers resized versions for the chosen width', () => {
      const img = render(IMAGE_SAMPLE_CONTENT, { width: 'narrow' }).host.querySelector('img');

      expect(img?.getAttribute('src')).toBe(`${photo.url}?width=1440`);
      expect(img?.getAttribute('srcset')).toBe(`${photo.url}?width=480 480w, ${photo.url}?width=720 720w, ${photo.url}?width=1440 1440w`);
      expect(img?.getAttribute('sizes')).toBe('(min-width: 48rem) 45rem, 100vw');
    });

    it('has no srcset for a file the API cannot resize (a preview URL)', () => {
      const signed = { ...photo, url: 'https://storage.example.com/object/sign/media/salon.jpg?token=abc' };
      const img = render({ image: signed }).host.querySelector('img');

      expect(img?.getAttribute('src')).toBe(signed.url);
      expect(img?.hasAttribute('srcset')).toBe(false);
      expect(img?.hasAttribute('sizes')).toBe(false);
    });

    it('treats an image without alt text as decorative', () => {
      expect(render({ image: { ...photo, alt: null } }).host.querySelector('img')?.getAttribute('alt')).toBe('');
    });

    it('renders nothing without an image, and no caption without text', () => {
      expect(render({ image: null, caption: 'Orphan caption' }).host.children).toHaveLength(0);
      expect(render({ image: photo, caption: '  ' }).host.querySelector('figcaption')).toBeNull();
    });

    it('updates in place when content changes (live preview)', () => {
      const { fixture, host } = render({ image: null });
      expect(host.querySelector('img')).toBeNull();

      fixture.componentRef.setInput('image', photo);
      fixture.componentRef.setInput('caption', 'Added');
      fixture.detectChanges();
      expect(host.querySelector('figcaption')?.textContent).toBe('Added');

      fixture.componentRef.setInput('caption', '');
      fixture.componentRef.setInput('image', { ...photo, alt: 'Changed' });
      fixture.detectChanges();
      expect(host.querySelector('figcaption')).toBeNull();
      expect(host.querySelector('img')?.getAttribute('alt')).toBe('Changed');
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      expect(render().host.className.split(' ').sort()).toEqual(['novan-image-block', 'novan-image-block--width-wide']);
    });

    it.each(settingsVariants(IMAGE_SCHEMA).filter((variant) => variant.key !== null))('applies $name', ({ key, value, settings }) => {
      const { host } = render(IMAGE_SAMPLE_CONTENT, settings);
      const option = kebab(key as string);

      if (typeof value === 'boolean') {
        expect(host.classList.contains(`novan-image-block--${option}`)).toBe(value);
      } else {
        expect(host.classList).toContain(`novan-image-block--${option}-${String(value)}`);
      }
    });

    it.each([
      ['unknown values', { width: 'huge', rounded: 'yes' }],
      ['null', null],
      ['an array', ['full']],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(IMAGE_SAMPLE_CONTENT, stored);

      expect(host.classList).toContain('novan-image-block--width-wide');
      expect(host.classList).not.toContain('novan-image-block--rounded');
    });

    it('updates when settings change', () => {
      const { fixture, host } = render();

      fixture.componentRef.setInput('settings', { width: 'full', rounded: true });
      fixture.detectChanges();

      expect(host.classList).toContain('novan-image-block--width-full');
      expect(host.classList).toContain('novan-image-block--rounded');
      expect(host.querySelector('img')?.getAttribute('sizes')).toBe('100vw');
    });
  });

  describe('editor panel', () => {
    it('offers a control for every style option and updates the preview', () => {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', IMAGE_DEFINITION);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
      for (const field of Object.values(IMAGE_SCHEMA)) expect(labels).toContain(field.label);

      element.querySelector<HTMLInputElement>('[role="switch"]')?.click();
      fixture.detectChanges();
      expect(element.querySelector('novan-image-block')?.classList).toContain('novan-image-block--rounded');
      expect(fixture.componentInstance.settings()).toEqual({ width: 'wide', rounded: true });
    });
  });
});
