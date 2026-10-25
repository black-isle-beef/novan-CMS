// components/badge-list/badge-list.component.ts — styles: src/styles/_badge-list.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { NovanBlock } from '@black-isle-beef/cms-angular';

import { blockId, blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { type Badge, BADGE_LIST_SCHEMA, type BadgeListFields, type BadgeListSettings } from './badge-list.schema';

/**
 * A heading, a short introduction and a list of short labels shown as badges: qualifications, memberships,
 * awards. The badges are a list (`ul`) so screen readers announce how many there are.
 */
@Component({
  selector: 'novan-badge-list-block',
  templateUrl: './badge-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-novan-part': 'root', '[class]': 'hostClasses()' },
})
export class BadgeListBlock implements NovanBlock<BadgeListFields> {
  static readonly novanBlock = { apiId: 'badgeList', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly intro = input<string>();
  readonly badges = input<Badge[] | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<BadgeListSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly headingId = blockId('novan-badge-list-block', 'heading');
  protected readonly resolved = computed(() => resolveSettings(BADGE_LIST_SCHEMA, this.settings()));
  protected readonly headingText = computed(() => blockText(this.heading()));
  protected readonly introText = computed(() => blockText(this.intro()));
  /** Labels to show; the list is stored data, so each item is checked. */
  protected readonly labels = computed<string[]>(() => {
    const badges: unknown = this.badges();
    if (!Array.isArray(badges)) return [];
    return badges
      .map((badge) =>
        typeof badge === 'object' && badge !== null ? blockText((badge as Record<string, unknown>)['label']) : null,
      )
      .filter((label): label is string => label !== null);
  });
  protected readonly hostClasses = computed(() =>
    ['novan-badge-list-block', ...modifierClasses('novan-badge-list-block', BADGE_LIST_SCHEMA, this.resolved())].join(
      ' ',
    ),
  );
}
