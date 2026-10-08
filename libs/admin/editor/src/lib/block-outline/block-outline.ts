import { CdkDrag, type CdkDragDrop, CdkDragHandle, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injector, input, output } from '@angular/core';
import { DsBadgeComponent } from '@black-isle-beef/novan-design-system';
import type { BlockNode, BlockType } from '@novan/shared-schemas';
import { type BlockList, type BlockPlace, canHold, type OutlineList } from '../block-tree';

/** A block to move, and where to: `index` counts places in `to` before the move. */
export interface BlockMove {
  from: BlockPlace;
  to: BlockList;
  index: number;
}

/** Where to add a block. */
export interface BlockSlot {
  list: BlockList;
  index: number;
}

/**
 * The page's blocks as a tree: select one, reorder by dragging (also into and out of blocks that hold others)
 * or with the arrow buttons, and add blocks at the end of each list. Moves into and out of blocks are in the
 * selected block's panel too, for keyboard users.
 */
@Component({
  selector: 'nv-block-outline',
  imports: [CdkDrag, CdkDragHandle, CdkDropList, CdkDropListGroup, DsBadgeComponent, NgTemplateOutlet],
  templateUrl: './block-outline.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockOutline {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly lists = input.required<readonly OutlineList[]>();
  readonly blockTypes = input.required<readonly BlockType[]>();
  readonly selected = input<string | null>(null);
  readonly readonly = input(false);

  readonly selectBlock = output<string>();
  readonly move = output<BlockMove>();
  readonly add = output<BlockSlot>();

  protected name(node: BlockNode): string {
    return this.type(node)?.name ?? node._block;
  }

  protected icon(node: BlockNode): string | null {
    return this.type(node)?.icon ?? null;
  }

  protected buttonId(node: BlockNode, action: string): string {
    return `nv-outline-${action}-${node._uid}`;
  }

  /** Only lists that take the block, and never the block's own children. */
  protected readonly accepts = (drag: CdkDrag<BlockPlace>, drop: CdkDropList<BlockList>): boolean => {
    const from = drag.data;
    const own = [...from.list.path, from.index];
    const inside = own.every((key, i) => drop.data.path[i] === key);
    return canHold(drop.data, from.node._block) && !inside;
  };

  protected dropped(event: CdkDragDrop<BlockList, BlockList, BlockPlace>): void {
    const from = event.item.data;
    const same = event.previousContainer === event.container;
    if (same && event.previousIndex === event.currentIndex) return;
    // CDK gives the index after the move; in the same list, a later place counts the block itself.
    const index = same && event.currentIndex > event.previousIndex ? event.currentIndex + 1 : event.currentIndex;
    this.move.emit({ from, to: event.container.data, index });
  }

  protected moveBy(place: BlockPlace, offset: -1 | 1, count: number): void {
    this.move.emit({ from: place, to: place.list, index: offset < 0 ? place.index - 1 : place.index + 2 });
    // The row moves in the page, which loses focus: keep it on the button used, or the other one at the end.
    const atEnd = offset < 0 ? place.index - 1 === 0 : place.index + 1 === count - 1;
    const used = offset < 0 ? 'up' : 'down';
    const other = offset < 0 ? 'down' : 'up';
    const id = this.buttonId(place.node, atEnd ? other : used);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus(), { injector: this.injector });
  }

  private type(node: BlockNode): BlockType | undefined {
    return this.blockTypes().find((type) => type.apiId === node._block);
  }
}
