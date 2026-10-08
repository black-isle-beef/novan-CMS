import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DsModalComponent } from '@black-isle-beef/novan-design-system';
import type { BlockType } from '@novan/shared-schemas';

/**
 * Chooses a block to add: the block types allowed where it goes (`allowedBlocks` or `allowed_children`), each
 * with its icon, name and preview image. A preview image path is an address on the space's site (`/blocks/hero.png`)
 * or a full https address.
 */
@Component({
  selector: 'nv-block-picker',
  imports: [DsModalComponent],
  templateUrl: './block-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockPicker {
  /** Open while set: the allowed types and where the block goes, in words ("in Content", "inside Columns"). */
  readonly request = input<{ types: readonly BlockType[]; where: string } | null>(null);
  /** The space's site, for preview images given as site paths. */
  readonly siteUrl = input<string | null>(null);
  readonly picked = output<BlockType>();
  readonly cancelled = output<void>();

  protected readonly choices = computed(() =>
    (this.request()?.types ?? []).map((type) => ({ type, image: this.imageUrl(type.previewImagePath) })),
  );

  private imageUrl(path: string | null): string | null {
    if (!path) return null;
    if (/^https:\/\//i.test(path)) return path;
    const site = this.siteUrl();
    return site && path.startsWith('/') && !path.startsWith('//') ? `${site}${path}` : null;
  }
}
