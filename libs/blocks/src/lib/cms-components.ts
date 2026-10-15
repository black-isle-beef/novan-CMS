import { BADGE_LIST_DEFINITION } from './components/badge-list';
import { CARD_GRID_DEFINITION } from './components/card-grid';
import { CTA_DEFINITION } from './components/cta';
import { FEATURE_GRID_DEFINITION } from './components/feature-grid';
import { FORM_DEFINITION } from './components/form';
import { HERO_DEFINITION } from './components/hero';
import { IMAGE_DEFINITION } from './components/image';
import { LISTING_DEFINITION } from './components/listing';
import { MEDIA_TEXT_DEFINITION } from './components/media-text';
import { RICH_TEXT_DEFINITION } from './components/rich-text';

/** Every block this library provides, in the order an editor lists them. */
export const CMS_COMPONENT_DEFINITIONS = [
  HERO_DEFINITION,
  RICH_TEXT_DEFINITION,
  IMAGE_DEFINITION,
  MEDIA_TEXT_DEFINITION,
  FEATURE_GRID_DEFINITION,
  CARD_GRID_DEFINITION,
  BADGE_LIST_DEFINITION,
  CTA_DEFINITION,
  FORM_DEFINITION,
  LISTING_DEFINITION,
] as const;
