import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { FieldForm } from '@novan/admin-fields';
import type { BlockNode, BlockStyle, BlockType } from '@novan/shared-schemas';
import type { BlockPlace } from '../block-tree';
import { StylePicker } from '../style-picker/style-picker';

/**
 * The selected block's fields (the same controls as the form view, so validation messages match) and its style
 * options as preset pickers, plus what can be done with it: move into the block before it or out of the one it
 * is in, duplicate, hide and delete. Changes go out as just the keys that changed, so two made before the panel
 * catches up do not undo each other.
 */
@Component({
  selector: 'nv-block-panel',
  imports: [DsAlertComponent, FieldForm, StylePicker],
  templateUrl: './block-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockPanel {
  readonly place = input.required<BlockPlace>();
  readonly type = input<BlockType | undefined>(undefined);
  /** The block's dotted path in the page data, e.g. `body.2`, which validation messages use. */
  readonly path = input.required<string>();
  readonly readonly = input(false);
  /** The block before this one, when it can hold this block. */
  readonly intoName = input<string | null>(null);
  /** The block this one is in, when its list can hold this block. */
  readonly outOfName = input<string | null>(null);

  readonly blockChange = output<Partial<BlockNode>>();
  readonly moveInto = output<void>();
  readonly moveOut = output<void>();
  readonly duplicate = output<void>();
  readonly toggleHidden = output<void>();
  readonly remove = output<void>();

  protected readonly node = computed(() => this.place().node);
  protected readonly name = computed(() => this.type()?.name ?? this.node()._block);
  protected readonly hasStyles = computed(() => Object.keys(this.type()?.styleOptions ?? {}).length > 0);
  protected readonly textHint = computed(() => !this.readonly() && (this.type()?.fields ?? []).some((field) => field.type === 'text'));

  protected setFields(value: Record<string, unknown>): void {
    const node = this.node();
    const changed = Object.keys(value).filter((key) => !key.startsWith('_') && key !== 'children' && value[key] !== node[key]);
    if (changed.length) this.blockChange.emit(Object.fromEntries(changed.map((key) => [key, value[key]])));
  }

  protected setStyle(style: BlockStyle): void {
    this.blockChange.emit({ _style: style });
  }
}
