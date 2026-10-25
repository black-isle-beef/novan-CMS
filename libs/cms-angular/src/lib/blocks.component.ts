import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Injector, input, reflectComponentType, type Type } from '@angular/core';
import { NOVAN_BLOCK_CONTEXT, type NovanBlockContext } from './block-context';
import { NOVAN_CMS_CONFIG } from './config';
import { mergeOverrides, overrideTokens } from './overrides';
import { NOVAN_CLASS_ADAPTER } from './parts';
import { NovanPreview } from './preview';
import type { NovanBlockNode } from './types';

/** One block, ready to render. */
interface RenderedBlock {
  uid: string;
  block: string;
  component: Type<unknown> | null;
  inputs: Record<string, unknown>;
  /** Gives the component its {@link NovanBlockContext}. */
  injector: Injector;
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
 * Each component can inject {@link NOVAN_BLOCK_CONTEXT}: its _uid, block type and the entryId given here (or to an
 * outer <novan-blocks>), so a form knows what it belongs to, and the classes and tokens an editor added to its parts
 * (`_overrides`), which `NovanPart` and `NovanBlockRoot` apply.
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
            <ng-container *ngComponentOutlet="item.component; inputs: item.inputs; injector: item.injector" />
            @if (item.children) {
              <novan-blocks [blocks]="item.children" [entryId]="pageId()" />
            }
          } @else {
            <div class="alert alert-warning" role="note">
              This page uses a block called "{{ item.block }}" that this site cannot show yet. Ask your developer to
              add it, or remove the block.
            </div>
          }
        </div>
      } @else if (item.component) {
        <ng-container *ngComponentOutlet="item.component; inputs: item.inputs; injector: item.injector" />
        @if (item.children) {
          <novan-blocks [blocks]="item.children" [entryId]="pageId()" />
        }
      }
    }
  `,
})
export class NovanBlocks {
  /** The block tree, e.g. `page.data.body`. */
  readonly blocks = input<readonly NovanBlockNode[] | null | undefined>([]);
  /** The page or entry the blocks belong to, e.g. `page.id`; blocks inside blocks inherit it. */
  readonly entryId = input<string | null | undefined>(undefined);

  protected readonly preview = inject(NovanPreview);
  private readonly registry = inject(NOVAN_CMS_CONFIG).blocks;
  private readonly inputNames = new Map<Type<unknown>, ReadonlySet<string>>();
  private readonly injector = inject(Injector);
  private readonly outer = inject(NOVAN_BLOCK_CONTEXT, { optional: true });
  private readonly adapter = inject(NOVAN_CLASS_ADAPTER);
  /** One injector per block and page, kept so a live update does not re-create the block's component. */
  private injectors = new Map<string, Injector>();

  /** This one's, else the outer blocks'. */
  protected readonly pageId = computed(() => this.entryId() ?? this.outer?.entryId ?? null);

  protected readonly rendered = computed<RenderedBlock[]>(() => {
    const nodes = this.blocks();
    const entryId = this.pageId();
    if (!Array.isArray(nodes)) return [];
    const seen = new Set<string>();
    const rendered: RenderedBlock[] = [];
    const injectors = new Map<string, Injector>();
    for (const node of nodes) {
      if (!isBlockNode(node) || node._hidden === true || seen.has(node._uid)) continue;
      seen.add(node._uid);
      const key = `${node._uid}\u0000${node._block}\u0000${entryId ?? ''}`;
      const injector =
        this.injectors.get(key) ??
        Injector.create({ providers: [{ provide: NOVAN_BLOCK_CONTEXT, useValue: this.context(node, entryId) }], parent: this.injector });
      injectors.set(key, injector);
      rendered.push(this.render(node, injector));
    }
    this.injectors = injectors;
    return rendered;
  });

  /**
   * A block's context. Its overrides are read from the current blocks each time, so an edit in the visual editor
   * reaches the block's parts without re-creating its component.
   */
  private context(node: NovanBlockNode, entryId: string | null): NovanBlockContext {
    const overrides = computed(() => this.blocks()?.find((candidate) => isBlockNode(candidate) && candidate._uid === node._uid)?._overrides);
    return {
      uid: node._uid,
      block: node._block,
      entryId,
      parts: computed(() => mergeOverrides(null, overrides(), this.adapter()), { equal: sameParts }),
      tokens: computed(() => overrideTokens(overrides()), { equal: sameTokens }),
    };
  }

  private render(node: NovanBlockNode, injector: Injector): RenderedBlock {
    const component = this.registry.get(node._block) ?? null;
    const children = Array.isArray(node.children) && node.children.length ? node.children : null;
    if (!component) return { uid: node._uid, block: node._block, component: null, inputs: {}, injector, children: null };

    const names = this.inputsOf(component);
    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!key.startsWith('_') && key !== 'children' && names.has(key)) inputs[key] = value;
    }
    // The block's style options; the component checks them against its own options.
    if (names.has('settings')) inputs['settings'] = isPlainObject(node._style) ? node._style : null;
    const takesChildren = names.has('children');
    if (takesChildren) inputs['children'] = node.children ?? [];
    return { uid: node._uid, block: node._block, component, inputs, injector, children: takesChildren ? null : children };
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

function sameParts(a: Readonly<Record<string, readonly string[]>>, b: Readonly<Record<string, readonly string[]>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => b[key]?.join(' ') === a[key].join(' '));
}

function sameTokens(a: readonly (readonly [string, string])[], b: readonly (readonly [string, string])[]): boolean {
  return a.length === b.length && a.every(([name, value], index) => b[index][0] === name && b[index][1] === value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlockNode(value: unknown): value is NovanBlockNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Partial<NovanBlockNode>;
  return typeof node._uid === 'string' && typeof node._block === 'string';
}
