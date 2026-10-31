import { defineBlocks } from '@black-isle-beef/cms-angular';

import { BadgeListBlock } from './components/badge-list';
import { CardGridBlock } from './components/card-grid';
import { CtaBlock } from './components/cta';
import { CustomHtmlBlock } from './components/custom-html';
import { FeatureGridBlock } from './components/feature-grid';
import { FormBlock } from './components/form';
import { HeroBlock } from './components/hero';
import { ImageBlock } from './components/image';
import { ListingBlock } from './components/listing';
import { MediaTextBlock } from './components/media-text';
import { RichTextBlock } from './components/rich-text';

/**
 * The blocks for `provideNovanCms({ blocks: novanBlocks })`: each block type's api id to its component.
 * Their styles are global partials: `@use 'novan-blocks'` in the site's styles.scss, with
 * `libs/blocks/src/styles` on the build's `stylePreprocessorOptions.includePaths`.
 */
export const novanBlocks = defineBlocks({
  hero: HeroBlock,
  richText: RichTextBlock,
  image: ImageBlock,
  mediaText: MediaTextBlock,
  featureGrid: FeatureGridBlock,
  cardGrid: CardGridBlock,
  badgeList: BadgeListBlock,
  cta: CtaBlock,
  form: FormBlock,
  listing: ListingBlock,
  customHtml: CustomHtmlBlock,
});
