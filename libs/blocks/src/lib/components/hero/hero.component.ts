// components/hero/hero.component.ts — styles: src/styles/_hero.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type NovanAsset, type NovanBlock, novanImage, type NovanLinkValue } from '@black-isle-beef/cms-angular';

import { BlockActionComponent, blockLink } from '../../block-action/block-action.component';
import { blockId, blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { HERO_SCHEMA, type HeroFields, type HeroSettings } from './hero.schema';

/**
 * The opening banner of a page: a heading, a short introduction, an optional background image and a button.
 * Styling comes only from `settings` (the block's `_style`), checked against HERO_SCHEMA, so stored data from
 * older versions still renders.
 */
@Component({
  selector: 'novan-hero-block',
  imports: [BlockActionComponent],
  templateUrl: './hero.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
})
export class HeroBlock implements NovanBlock<HeroFields> {
  static readonly novanBlock = { apiId: 'hero', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly subheading = input<string>();
  readonly image = input<NovanAsset | null>();
  readonly action = input<NovanLinkValue | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<HeroSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly headingId = blockId('novan-hero-block', 'heading');
  protected readonly resolved = computed(() => resolveSettings(HERO_SCHEMA, this.settings()));
  protected readonly headingText = computed(() => blockText(this.heading()));
  protected readonly subheadingText = computed(() => blockText(this.subheading()));
  protected readonly link = computed(() => blockLink(this.action()));
  protected readonly imageUrl = computed(() => novanImage(this.image(), { width: 1920 }) || null);
  protected readonly imageAlt = computed(() => this.image()?.alt ?? '');
  /** The button stands out against the background: light on brand and dark, dark on light. */
  protected readonly actionOn = computed(() => (this.resolved().tone === 'light' ? 'light' : 'dark'));
  protected readonly hostClasses = computed(() =>
    [
      'novan-hero-block',
      ...modifierClasses('novan-hero-block', HERO_SCHEMA, this.resolved()),
      ...(this.imageUrl() ? ['novan-hero-block--has-image'] : []),
    ].join(' '),
  );
}
