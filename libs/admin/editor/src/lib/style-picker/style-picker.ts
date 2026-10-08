import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { BlockStyle, StyleField, StyleOptions } from '@novan/shared-schemas';

interface StyleControl {
  key: string;
  field: StyleField;
  value: string | boolean;
}

/**
 * A block's style options (its type's `styleOptions`) as preset pickers: radio buttons, a select or a switch,
 * each starting at the option's default. Editors only ever choose named presets, never raw values.
 */
@Component({
  selector: 'nv-style-picker',
  templateUrl: './style-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StylePicker {
  readonly options = input.required<StyleOptions>();
  readonly value = input<BlockStyle | undefined>(undefined);
  readonly disabled = input(false);
  /** Prefix for control ids; unique on the page. */
  readonly idPrefix = input.required<string>();
  /** The complete style, every option set. */
  readonly valueChange = output<BlockStyle>();

  protected readonly controls = computed<StyleControl[]>(() => {
    const value = this.value() ?? {};
    return Object.entries(this.options()).map(([key, field]) => ({ key, field, value: current(field, value[key]) }));
  });

  protected id(key: string, suffix = ''): string {
    return `${this.idPrefix()}-${key}${suffix ? `-${suffix}` : ''}`;
  }

  protected choose(key: string, value: string | boolean): void {
    const style: BlockStyle = Object.fromEntries(this.controls().map((control) => [control.key, control.value]));
    style[key] = value;
    this.valueChange.emit(style);
  }

  protected onSelect(key: string, event: Event): void {
    this.choose(key, (event.target as HTMLSelectElement).value);
  }

  protected onToggle(key: string, event: Event): void {
    this.choose(key, (event.target as HTMLInputElement).checked);
  }
}

/** The stored value when it is still one of the field's choices, else the default. */
function current(field: StyleField, stored: string | boolean | undefined): string | boolean {
  if (field.kind === 'toggle') return typeof stored === 'boolean' ? stored : field.default;
  return typeof stored === 'string' && field.options.some((option) => option.value === stored) ? stored : field.default;
}
