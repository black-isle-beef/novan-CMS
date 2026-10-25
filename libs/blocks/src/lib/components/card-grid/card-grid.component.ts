// components/card-grid/card-grid.component.ts — styles: src/styles/_card-grid.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { NovanBlock } from '@black-isle-beef/cms-angular';

import { type BlockPicture, blockPicture } from '../../block-picture';
import { blockId, blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { type Card, CARD_GRID_SCHEMA, type CardGridFields, type CardGridSettings } from './card-grid.schema';

interface CardView {
  picture: BlockPicture | null;
  title: string | null;
  subtitle: string | null;
  tag: string | null;
}

/** The heading level of each card's title: one below the block's heading, or the same when there is none. */
const ITEM_LEVEL = { h2: 'h3', h3: 'h4', h4: 'h5' } as const;

/** Image widths offered to the browser, and how wide a card is shown for each column count. */
const WIDTHS = [400, 640, 960] as const;
const SIZES: Record<CardGridSettings['columns'], string> = {
  two: '(min-width: 36rem) 50vw, 100vw',
  three: '(min-width: 62rem) 33vw, (min-width: 36rem) 50vw, 100vw',
  four: '(min-width: 62rem) 25vw, (min-width: 36rem) 50vw, 100vw',
};

/**
 * A heading, a short introduction and a grid of cards, each with an optional photo, a title, a subtitle and
 * a tag. Cards are a list (`ul`) so screen readers announce how many there are.
 */
@Component({
  selector: 'novan-card-grid-block',
  templateUrl: './card-grid.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-novan-part': 'root', '[class]': 'hostClasses()' },
})
export class CardGridBlock implements NovanBlock<CardGridFields> {
  static readonly novanBlock = { apiId: 'cardGrid', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly intro = input<string>();
  readonly cards = input<Card[] | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<CardGridSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly headingId = blockId('novan-card-grid-block', 'heading');
  protected readonly resolved = computed(() => resolveSettings(CARD_GRID_SCHEMA, this.settings()));
  protected readonly headingText = computed(() => blockText(this.heading()));
  protected readonly introText = computed(() => blockText(this.intro()));
  protected readonly itemLevel = computed(() => {
    const level = this.resolved().headingLevel;
    return this.headingText() ? ITEM_LEVEL[level] : level;
  });
  /** Cards with something to show; the list is stored data, so each item is checked. */
  protected readonly items = computed<CardView[]>(() => {
    const cards: unknown = this.cards();
    if (!Array.isArray(cards)) return [];
    const sizes = SIZES[this.resolved().columns];
    return cards
      .filter((card): card is Record<string, unknown> => typeof card === 'object' && card !== null)
      .map((card) => ({
        picture: blockPicture(card['image'], WIDTHS, sizes),
        title: blockText(card['title']),
        subtitle: blockText(card['subtitle']),
        tag: blockText(card['tag']),
      }))
      .filter((card) => card.title || card.picture);
  });
  protected readonly hostClasses = computed(() =>
    ['novan-card-grid-block', ...modifierClasses('novan-card-grid-block', CARD_GRID_SCHEMA, this.resolved())].join(' '),
  );
}
