import { InjectionToken } from '@angular/core';

/** Where a block is: its own id and type, and the page or entry it is in. */
export interface NovanBlockContext {
  /** The block's `_uid`. */
  uid: string;
  /** Its block type, e.g. `form`. */
  block: string;
  /** The page or entry whose blocks these are, when `<novan-blocks [entryId]>` says so (or an outer one does). */
  entryId: string | null;
}

/**
 * Given by `<novan-blocks>` to each block component it renders: `inject(NOVAN_BLOCK_CONTEXT, { optional: true })`.
 * A form block needs it to send what visitors fill in, as the API finds the form by page and block id.
 */
export const NOVAN_BLOCK_CONTEXT = new InjectionToken<NovanBlockContext>('NOVAN_BLOCK_CONTEXT');
