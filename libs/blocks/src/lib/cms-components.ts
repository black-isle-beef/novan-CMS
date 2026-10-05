import { CTA_DEFINITION } from './components/cta';
import { FEATURE_GRID_DEFINITION } from './components/feature-grid';
import { HERO_DEFINITION } from './components/hero';
import { IMAGE_DEFINITION } from './components/image';
import { RICH_TEXT_DEFINITION } from './components/rich-text';

/** Every block this library provides, in the order an editor lists them. */
export const CMS_COMPONENT_DEFINITIONS = [
  HERO_DEFINITION,
  RICH_TEXT_DEFINITION,
  IMAGE_DEFINITION,
  FEATURE_GRID_DEFINITION,
  CTA_DEFINITION,
] as const;
