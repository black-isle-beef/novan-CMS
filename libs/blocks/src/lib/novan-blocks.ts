import { defineBlocks } from '@black-isle-beef/cms-angular';

import { CtaBlock } from './components/cta';
import { FeatureGridBlock } from './components/feature-grid';
import { HeroBlock } from './components/hero';
import { ImageBlock } from './components/image';
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
  featureGrid: FeatureGridBlock,
  cta: CtaBlock,
});
