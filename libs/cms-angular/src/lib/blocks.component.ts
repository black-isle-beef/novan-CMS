import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, reflectComponentType, type Type } from '@angular/core';
import { NOVAN_CMS_CONFIG } from './config';
import { NovanPreview } from './preview';
import type { NovanBlockNode } from './types';

/** One block, ready to render. */
interface RenderedBlock {
  uid: string;
  block: string;
  component: Type<unknown> | null;
  inputs: Record<string, unknown>;
  /** Children the component does not take itself, rendered after it. */
  children: NovanBlockNode[] | null;
}

/**
 * Renders a block tree (a `blocks` field) with the components registered through `defineBlocks`. Each
 * block's fields are set on the component's inputs of the same name, and its style options (`_style`) on a
 * `settings` input, which therefore wins over a field called `settings`. A component with a `children` input
 * gets the child blocks to place itself (with its own `<novan-blocks>`); otherwise they follow it. Blocks
 * with no registered component are skipped, with a warning box in preview mode. Hidden blocks (`_hidden`)
 * are never shown.
 *
 * In preview mode each block is wrapped in a `<div data-novan-uid data-novan-block>`, which the visual
 * editor's bridge outlines and measures. Other visitors get the blocks without wrappers.
 */
@Component({
  selector: 'novan-blocks',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (item of rendered(); track item.uid) {
      @if (preview.active()) {
        <div [attr.data-novan-uid]="item.uid" [attr.data-novan-block]="item.block">
          @if (item.component) {
            <ng-container *ngComponentOutlet="item.component; inputs: item.inputs" />
            @if (item.children) {
              <novan-blocks [blocks]="item.children" />
            }
          } @else {
            <div class="alert alert-warning" role="note">
              This page uses a block called "{{ item.block }}" that this site cannot show yet. Ask your developer to
              add it, or remove the block.
            </div>
          }
        </div>
      } @else if (item.component) {
        <ng-container *ngComponentOutlet="item.component; inputs: item.inputs" />
        @if (item.children) {
          <novan-blocks [blocks]="item.children" />
        }
      }
    }
  `,
})
export class NovanBlocks {
  /** The block tree, e.g. `page.data.body`. */
  readonly blocks = input<readonly NovanBlockNode[] | null | undefined>([]);

  protected readonly preview = inject(NovanPreview);
  private readonly registry = inject(NOVAN_CMS_CONFIG).blocks;
  private readonly inputNames = new Map<Type<unknown>, ReadonlySet<string>>();

  protected readonly rendered = computed<RenderedBlock[]>(() => {
    const nodes = this.blocks();
    if (!Array.isArray(nodes)) return [];
    const seen = new Set<string>();
    const rendered: RenderedBlock[] = [];
    for (const node of nodes) {
      if (!isBlockNode(node) || node._hidden === true || seen.has(node._uid)) continue;
      seen.add(node._uid);
      rendered.push(this.render(node));
    }
    return rendered;
  });

  private render(node: NovanBlockNode): RenderedBlock {
    const component = this.registry.get(node._block) ?? null;
    const children = Array.isArray(node.children) && node.children.length ? node.children : null;
    if (!component) return { uid: node._uid, block: node._block, component: null, inputs: {}, children: null };

    const names = this.inputsOf(component);
    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!key.startsWith('_') && key !== 'children' && names.has(key)) inputs[key] = value;
    }
    // The block's style options; the component checks them against its own options.
    if (names.has('settings')) inputs['settings'] = isPlainObject(node._style) ? node._style : null;
    const takesChildren = names.has('children');
    if (takesChildren) inputs['children'] = node.children ?? [];
    return { uid: node._uid, block: node._block, component, inputs, children: takesChildren ? null : children };
  }

  /** The component's input names as templates use them. */
  private inputsOf(component: Type<unknown>): ReadonlySet<string> {
    let names = this.inputNames.get(component);
    if (!names) {
      names = new Set(reflectComponentType(component)?.inputs.map((input) => input.templateName) ?? []);
      this.inputNames.set(component, names);
    }
    return names;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlockNode(value: unknown): value is NovanBlockNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Partial<NovanBlockNode>;
  return typeof node._uid === 'string' && typeof node._block === 'string';
}
