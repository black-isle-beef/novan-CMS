import { InjectionToken, type Signal } from '@angular/core';

/** Where a block is: its own id and type, and the page or entry it is in. */
export interface NovanBlockContext {
  /** The block's `_uid`. */
  uid: string;
  /** Its block type, e.g. `form`. */
  block: string;
  /** The page or entry whose blocks these are, when `<novan-blocks [entryId]>` says so (or an outer one does). */
  entryId: string | null;
  /**
   * Each part's classes from the block's `_overrides`, written by the site's class adapter, e.g.
   * `{ root: ['mt-8'], heading: ['display-4'] }`. Kept current as the page changes; `NovanPart` applies them.
   */
  parts?: Signal<Readonly<Record<string, readonly string[]>>>;
  /** The block's token overrides that are safe to set, as `[name, value]` pairs; `NovanBlockRoot` sets them. */
  tokens?: Signal<readonly (readonly [string, string])[]>;
}

/**
 * Given by `<novan-blocks>` to each block component it renders: `inject(NOVAN_BLOCK_CONTEXT, { optional: true })`.
 * A form block needs it to send what visitors fill in, as the API finds the form by page and block id.
 */
export const NOVAN_BLOCK_CONTEXT = new InjectionToken<NovanBlockContext>('NOVAN_BLOCK_CONTEXT');
