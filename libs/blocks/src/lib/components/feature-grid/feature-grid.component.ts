// components/feature-grid/feature-grid.component.ts — styles: src/styles/_feature-grid.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { NovanBlock } from '@black-isle-beef/cms-angular';

import { blockId, blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import {
  type Feature,
  FEATURE_GRID_SCHEMA,
  FEATURE_ICONS,
  type FeatureGridFields,
  type FeatureGridSettings,
  type FeatureIcon,
} from './feature-grid.schema';

interface FeatureView {
  icon: FeatureIcon | null;
  title: string | null;
  text: string | null;
}

/** The heading level of each feature's title: one below the block's heading, or the same when there is none. */
const ITEM_LEVEL = { h2: 'h3', h3: 'h4', h4: 'h5' } as const;

/**
 * A heading, a short introduction and a list of features, each with an optional icon. Features are a list
 * (`ul`) so screen readers announce how many there are; icons are decorative.
 */
@Component({
  selector: 'novan-feature-grid-block',
  templateUrl: './feature-grid.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
})
export class FeatureGridBlock implements NovanBlock<FeatureGridFields> {
  static readonly novanBlock = { apiId: 'featureGrid', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly intro = input<string>();
  readonly features = input<Feature[] | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<FeatureGridSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly headingId = blockId('novan-feature-grid-block', 'heading');
  protected readonly resolved = computed(() => resolveSettings(FEATURE_GRID_SCHEMA, this.settings()));
  protected readonly headingText = computed(() => blockText(this.heading()));
  protected readonly introText = computed(() => blockText(this.intro()));
  protected readonly itemLevel = computed(() => {
    const level = this.resolved().headingLevel;
    return this.headingText() ? ITEM_LEVEL[level] : level;
  });
  /** Features with something to show; the list is stored data, so each item is checked. */
  protected readonly items = computed<FeatureView[]>(() => {
    const features: unknown = this.features();
    if (!Array.isArray(features)) return [];
    return features
      .filter((feature): feature is Record<string, unknown> => typeof feature === 'object' && feature !== null)
      .map((feature) => ({
        icon: (FEATURE_ICONS as readonly unknown[]).includes(feature['icon']) ? (feature['icon'] as FeatureIcon) : null,
        title: blockText(feature['title']),
        text: blockText(feature['text']),
      }))
      .filter((feature) => feature.title || feature.text);
  });
  protected readonly hostClasses = computed(() =>
    ['novan-feature-grid-block', ...modifierClasses('novan-feature-grid-block', FEATURE_GRID_SCHEMA, this.resolved())].join(' '),
  );
}
