import type { Signal, Type } from '@angular/core';

/** What a block component says about itself: the block type it renders and the field schema it was built for. */
export interface NovanBlockMeta {
  /** The block type's api id, e.g. `hero`; the `_block` of the nodes it renders. */
  readonly apiId: string;
  /** Goes up when the component's fields change incompatibly. */
  readonly schemaVersion: number;
}

/**
 * The instance side of a block component: one `input()` per field of the block type. Fields are optional
 * in content, so each input may read `undefined`.
 *
 * ```ts
 * interface HeroFields { heading: string; subheading?: string }
 *
 * @Component({ selector: 'site-hero', template: '<h1>{{ heading() }}</h1>' })
 * export class HeroBlock implements NovanBlock<HeroFields> {
 *   static readonly novanBlock = { apiId: 'hero', schemaVersion: 1 };
 *   readonly heading = input<string>();
 *   readonly subheading = input<string>();
 * }
 * ```
 */
export type NovanBlock<TFields extends object> = {
  readonly [K in keyof TFields]-?: Signal<TFields[K] | undefined>;
};

/** The class side of a block component: an Angular component with a static `novanBlock`. */
export type NovanBlockType<T = unknown> = Type<T> & { readonly novanBlock: NovanBlockMeta };

/** Block components by `_block`, from {@link defineBlocks}. */
export type NovanBlockRegistry = ReadonlyMap<string, NovanBlockType>;

/**
 * Registers the block components a site renders, keyed by block type api id:
 * `defineBlocks({ hero: HeroBlock, richText: RichTextBlock })`. Each key must equal the component's
 * `novanBlock.apiId`, so a component cannot be registered for a block it was not built for.
 */
export function defineBlocks(blocks: Readonly<Record<string, NovanBlockType>>): NovanBlockRegistry {
  const registry = new Map<string, NovanBlockType>();
  for (const [apiId, component] of Object.entries(blocks)) {
    const meta = (component as Partial<NovanBlockType>).novanBlock;
    if (!meta || typeof meta.apiId !== 'string' || !Number.isInteger(meta.schemaVersion)) {
      throw new Error(
        `defineBlocks: ${component?.name ?? apiId} needs "static readonly novanBlock = { apiId: '${apiId}', schemaVersion: 1 }".`,
      );
    }
    if (meta.apiId !== apiId) {
      throw new Error(`defineBlocks: "${apiId}" is registered to ${component.name}, which renders "${meta.apiId}".`);
    }
    registry.set(apiId, component);
  }
  return registry;
}
