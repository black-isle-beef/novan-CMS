// components/image/image.component.ts — styles: src/styles/_image.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type NovanAsset, type NovanBlock, novanImage } from '@black-isle-beef/cms-angular';

import { blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { IMAGE_SCHEMA, type ImageFields, type ImageSettings } from './image.schema';

/** Image widths offered to the browser for each width option, and how wide the image is shown. */
const SIZES: Record<ImageSettings['width'], { widths: number[]; sizes: string }> = {
  narrow: { widths: [480, 720, 1440], sizes: '(min-width: 48rem) 45rem, 100vw' },
  wide: { widths: [640, 1200, 2400], sizes: '(min-width: 80rem) 75rem, 100vw' },
  full: { widths: [800, 1600, 2500], sizes: '100vw' },
};

/** One image with an optional caption. Nothing is rendered until an image is chosen. */
@Component({
  selector: 'novan-image-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
  template: `
    @if (picture(); as picture) {
      <figure class="novan-image-block__figure">
        <img
          class="novan-image-block__image"
          [src]="picture.src"
          [attr.srcset]="picture.srcset"
          [attr.sizes]="picture.srcset ? picture.sizes : null"
          [alt]="picture.alt"
          [attr.width]="picture.width"
          [attr.height]="picture.height"
          loading="lazy"
          decoding="async"
        />
        @if (captionText(); as caption) {
          <figcaption class="novan-image-block__caption">{{ caption }}</figcaption>
        }
      </figure>
    }
  `,
})
export class ImageBlock implements NovanBlock<ImageFields> {
  static readonly novanBlock = { apiId: 'image', schemaVersion: 1 };

  readonly image = input<NovanAsset | null>();
  readonly caption = input<string>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<ImageSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly resolved = computed(() => resolveSettings(IMAGE_SCHEMA, this.settings()));
  protected readonly captionText = computed(() => blockText(this.caption()));
  protected readonly picture = computed(() => {
    const image = this.image();
    const { widths, sizes } = SIZES[this.resolved().width];
    const src = novanImage(image, { width: widths[widths.length - 1] });
    if (!image || !src) return null;
    const candidates = widths.map((width) => ({ width, url: novanImage(image, { width }) }));
    // Files the API cannot resize (preview URLs, other hosts) come back unchanged: no srcset for those.
    const resizable = new Set(candidates.map((candidate) => candidate.url)).size === candidates.length;
    return {
      src,
      srcset: resizable ? candidates.map((candidate) => `${candidate.url} ${candidate.width}w`).join(', ') : null,
      sizes,
      alt: image.alt ?? '',
      width: image.width,
      height: image.height,
    };
  });
  protected readonly hostClasses = computed(() =>
    ['novan-image-block', ...modifierClasses('novan-image-block', IMAGE_SCHEMA, this.resolved())].join(' '),
  );
}
