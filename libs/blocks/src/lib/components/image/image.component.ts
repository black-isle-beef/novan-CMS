// components/image/image.component.ts — styles: src/styles/_image.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type NovanAsset, type NovanBlock, NovanBlockRoot, NovanPart } from '@black-isle-beef/cms-angular';

import { blockPicture } from '../../block-picture';
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
  imports: [NovanPart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [NovanBlockRoot],
  host: { 'data-novan-part': 'root', '[class]': 'hostClasses()' },
  template: `
    @if (picture(); as picture) {
      <figure class="novan-image-block__figure" data-novan-part="figure">
        <img
          class="novan-image-block__image" data-novan-part="image"
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
          <figcaption class="novan-image-block__caption" data-novan-part="caption">{{ caption }}</figcaption>
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
    const { widths, sizes } = SIZES[this.resolved().width];
    return blockPicture(this.image(), widths, sizes);
  });
  protected readonly hostClasses = computed(() =>
    ['novan-image-block', ...modifierClasses('novan-image-block', IMAGE_SCHEMA, this.resolved())].join(' '),
  );
}
