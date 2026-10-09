import { CdkDrag, type CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { DsBadgeComponent } from '@black-isle-beef/novan-design-system';
import type { BlockNode, BlockType, FieldDefOf } from '@novan/shared-schemas';
import { blockSummary, childrenField, isBlockNode, newBlock } from '../blocks';
import { FieldControl } from '../field-control';
import { FieldForm } from '../field-form/field-form';
import { FieldMessages } from '../field-messages/field-messages';

/**
 * A list of blocks: add from the allowed block types, reorder (drag and drop, or the arrow buttons for
 * keyboard and single-pointer users), remove, and open each block to edit its fields and the blocks
 * nested inside it. Blocks keep their `_uid` however they move.
 */
@Component({
  selector: 'nv-blocks-field',
  imports: [CdkDrag, CdkDragHandle, CdkDropList, DsBadgeComponent, FieldMessages, forwardRef(() => FieldForm)],
  templateUrl: './blocks-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlocksField extends FieldControl<FieldDefOf<'blocks'>> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly blocks = computed<BlockNode[]>(() => (Array.isArray(this.value()) ? (this.value() as unknown[]).filter(isBlockNode) : []));

  /** Block types that can be added here. */
  protected readonly choices = computed<BlockType[]>(() => {
    const all = this.context.blockTypes();
    const allowed = this.field().allowedBlocks;
    return allowed.length ? allowed.flatMap((apiId) => all.filter((type) => type.apiId === apiId)) : all;
  });
  private readonly picked = signal<string | null>(null);
  protected readonly toAdd = computed(() => this.picked() ?? this.choices()[0]?.apiId ?? '');

  protected readonly open = signal<ReadonlySet<string>>(new Set());
  /** Polite announcement of the last change, for screen reader users. */
  protected readonly announcement = signal('');

  protected override readonly hint = computed(() => {
    const { min, max } = this.field();
    if (min !== undefined && max !== undefined) return `Add ${min} to ${max} blocks.`;
    if (max !== undefined) return `Add up to ${max} blocks.`;
    if (min !== undefined) return `Add at least ${min} blocks.`;
    return null;
  });

  protected readonly childrenField = childrenField;

  protected blockType(node: BlockNode): BlockType | undefined {
    return this.context.blockType(node._block);
  }

  protected blockName(node: BlockNode): string {
    return this.blockType(node)?.name ?? node._block;
  }

  protected summary(node: BlockNode): string {
    return blockSummary(node, this.blockType(node), this.locale(), this.context.defaultLocale());
  }

  protected blockPath(index: number): string {
    return `${this.path()}.${index}`;
  }

  protected controlId(name: string, node: BlockNode): string {
    return `${this.id()}-${name}-${node._uid}`;
  }

  protected isOpen(node: BlockNode): boolean {
    return this.open().has(node._uid);
  }

  protected toggle(node: BlockNode): void {
    const open = new Set(this.open());
    if (open.has(node._uid)) open.delete(node._uid);
    else open.add(node._uid);
    this.open.set(open);
  }

  protected pick(event: Event): void {
    this.picked.set((event.target as HTMLSelectElement).value);
  }

  protected add(): void {
    const type = this.choices().find((choice) => choice.apiId === this.toAdd());
    if (!type) return;
    const node = newBlock(type);
    const blocks = [...this.blocks(), node];
    this.value.set(blocks);
    this.open.set(new Set(this.open()).add(node._uid));
    this.announcement.set(`Added a ${type.name} block at position ${blocks.length} of ${blocks.length}. Its fields are open.`);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`#${this.controlId('panel', node)}`)?.querySelector<HTMLElement>(focusable)?.focus(),
      { injector: this.injector },
    );
  }

  protected setBlock(index: number, data: Record<string, unknown>): void {
    const blocks = [...this.blocks()];
    blocks[index] = { ...data, _uid: blocks[index]._uid, _block: blocks[index]._block };
    this.value.set(blocks);
  }

  protected setChildren(index: number, children: unknown): void {
    const blocks = [...this.blocks()];
    const node = { ...blocks[index] };
    if (Array.isArray(children) && children.length) node.children = children as BlockNode[];
    else delete node.children;
    blocks[index] = node;
    this.value.set(blocks);
  }

  protected move(index: number, offset: -1 | 1): void {
    const target = index + offset;
    const blocks = [...this.blocks()];
    if (target < 0 || target >= blocks.length) return;
    moveItemInArray(blocks, index, target);
    this.value.set(blocks);
    this.announceMove(blocks[target], target, blocks.length);

    // Keep focus on the button used; at the end of the list it is disabled, so use the opposite one.
    const node = blocks[target];
    const used = offset < 0 ? 'up' : 'down';
    const opposite = offset < 0 ? 'down' : 'up';
    const atEnd = offset < 0 ? target === 0 : target === blocks.length - 1;
    this.focus(this.controlId(atEnd ? opposite : used, node));
  }

  protected drop(event: CdkDragDrop<BlockNode[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const blocks = [...this.blocks()];
    moveItemInArray(blocks, event.previousIndex, event.currentIndex);
    this.value.set(blocks);
    this.announceMove(blocks[event.currentIndex], event.currentIndex, blocks.length);
  }

  protected remove(index: number): void {
    const blocks = [...this.blocks()];
    const [removed] = blocks.splice(index, 1);
    this.value.set(blocks);
    this.announcement.set(`Removed the ${this.blockName(removed)} block.`);
    const next = blocks[Math.min(index, blocks.length - 1)];
    this.focus(next ? this.controlId('edit', next) : `${this.id()}-add`);
  }

  private announceMove(node: BlockNode, index: number, count: number): void {
    this.announcement.set(`${this.blockName(node)} block moved to position ${index + 1} of ${count}.`);
  }

  private focus(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${elementId}`)?.focus(), {
      injector: this.injector,
    });
  }
}

const focusable = 'input, select, textarea, [contenteditable="true"], button';
