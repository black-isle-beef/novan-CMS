// components/media-text/media-text.component.ts — styles: src/styles/_media-text.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { NovanAsset, NovanBlock, NovanLinkValue } from '@black-isle-beef/cms-angular';

import { BlockActionComponent, blockLink } from '../../block-action/block-action.component';
import { blockPicture } from '../../block-picture';
import { blockId, blockParagraphs, blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { MEDIA_TEXT_SCHEMA, type MediaTextFields, type MediaTextSettings } from './media-text.schema';

/** Image widths offered to the browser: the image takes half the content width from 48rem up. */
const WIDTHS = [480, 720, 1200] as const;
const SIZES = '(min-width: 80rem) 37rem, (min-width: 48rem) 50vw, 100vw';

/**
 * An image beside a heading, text and an optional button. The text comes first in reading order whichever
 * side the image is shown on; below 48rem the image sits under the text.
 */
@Component({
  selector: 'novan-media-text-block',
  imports: [BlockActionComponent],
  templateUrl: './media-text.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
})
export class MediaTextBlock implements NovanBlock<MediaTextFields> {
  static readonly novanBlock = { apiId: 'mediaText', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly text = input<string>();
  readonly image = input<NovanAsset | null>();
  readonly action = input<NovanLinkValue | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<MediaTextSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly headingId = blockId('novan-media-text-block', 'heading');
  protected readonly resolved = computed(() => resolveSettings(MEDIA_TEXT_SCHEMA, this.settings()));
  protected readonly headingText = computed(() => blockText(this.heading()));
  protected readonly paragraphs = computed(() => blockParagraphs(this.text()));
  protected readonly picture = computed(() => blockPicture(this.image(), WIDTHS, SIZES));
  protected readonly link = computed(() => blockLink(this.action()));
  protected readonly actionOn = computed(() => (this.resolved().tone === 'light' ? 'light' : 'dark'));
  protected readonly hostClasses = computed(() =>
    [
      'novan-media-text-block',
      ...modifierClasses('novan-media-text-block', MEDIA_TEXT_SCHEMA, this.resolved()),
      ...(this.picture() ? [] : ['novan-media-text-block--no-image']),
    ].join(' '),
  );
}
