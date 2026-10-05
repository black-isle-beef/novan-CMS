// components/cta/cta.component.ts — styles: src/styles/_cta.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { NovanBlock, NovanLinkValue } from '@black-isle-beef/cms-angular';

import { BlockActionComponent, blockLink } from '../../block-action/block-action.component';
import { blockId, blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { CTA_SCHEMA, type CtaFields, type CtaSettings } from './cta.schema';

/** A call to action: a heading, a sentence and one button (a page, web address or email). */
@Component({
  selector: 'novan-cta-block',
  imports: [BlockActionComponent],
  templateUrl: './cta.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
})
export class CtaBlock implements NovanBlock<CtaFields> {
  static readonly novanBlock = { apiId: 'cta', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly text = input<string>();
  readonly action = input<NovanLinkValue | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<CtaSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly headingId = blockId('novan-cta-block', 'heading');
  protected readonly resolved = computed(() => resolveSettings(CTA_SCHEMA, this.settings()));
  protected readonly headingText = computed(() => blockText(this.heading()));
  protected readonly bodyText = computed(() => blockText(this.text()));
  protected readonly link = computed(() => blockLink(this.action()));
  protected readonly actionOn = computed(() => (this.resolved().tone === 'light' ? 'light' : 'dark'));
  protected readonly hostClasses = computed(() =>
    ['novan-cta-block', ...modifierClasses('novan-cta-block', CTA_SCHEMA, this.resolved())].join(' '),
  );
}
