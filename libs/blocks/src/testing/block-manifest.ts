// testing/block-manifest.ts — the library's block types (libs/blocks/block-types.json), for specs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SeededBlockType } from './seeded-block-types';

export interface ManifestBlockType extends SeededBlockType {
  previewImagePath: string | null;
  allowedChildren: string[];
}

export function manifestBlockTypes(): ManifestBlockType[] {
  // Tests run from the workspace root.
  return (JSON.parse(readFileSync(resolve('libs/blocks/block-types.json'), 'utf8')) as { blockTypes: ManifestBlockType[] }).blockTypes;
}
