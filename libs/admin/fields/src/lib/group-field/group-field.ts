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
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldForm } from '../field-form/field-form';
import { FieldMessages } from '../field-messages/field-messages';

type Item = Record<string, unknown>;

/** A set of fields stored together, or (when repeatable) a list of such sets. */
@Component({
  selector: 'nv-group-field',
  imports: [FieldMessages, forwardRef(() => FieldForm)],
  templateUrl: './group-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupField extends FieldControl<FieldDefOf<'group'>> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly object = computed<Item>(() => (isItem(this.value()) ? (this.value() as Item) : {}));
  protected readonly items = computed<Item[]>(() => (Array.isArray(this.value()) ? (this.value() as unknown[]).filter(isItem) : []));
  protected readonly announcement = signal('');

  protected override readonly hint = computed(() => {
    const { multiple, min, max } = this.field();
    if (!multiple) return null;
    if (min !== undefined && max !== undefined) return `Add ${min} to ${max}.`;
    if (max !== undefined) return `Add up to ${max}.`;
    if (min !== undefined) return `Add at least ${min}.`;
    return null;
  });

  protected itemPath(index: number): string {
    return `${this.path()}.${index}`;
  }

  protected setItem(index: number, item: Item): void {
    this.value.set(this.items().map((existing, i) => (i === index ? item : existing)));
  }

  protected add(): void {
    const items = [...this.items(), {}];
    this.value.set(items);
    this.announcement.set(`Added item ${items.length}.`);
    this.focus(`${this.id()}-item-${items.length - 1}`);
  }

  protected move(index: number, offset: -1 | 1): void {
    const target = index + offset;
    const items = [...this.items()];
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    this.value.set(items);
    this.announcement.set(`Item moved to position ${target + 1} of ${items.length}.`);
    // Keep focus on the button used; at the end of the list it is disabled, so use the opposite one.
    const used = offset < 0 ? 'up' : 'down';
    const opposite = offset < 0 ? 'down' : 'up';
    const atEnd = offset < 0 ? target === 0 : target === items.length - 1;
    this.focus(`${this.id()}-${atEnd ? opposite : used}-${target}`);
  }

  protected remove(index: number): void {
    const items = this.items().filter((_, i) => i !== index);
    this.value.set(items);
    this.announcement.set(`Removed item ${index + 1}.`);
    this.focus(items.length ? `${this.id()}-item-${Math.min(index, items.length - 1)}` : `${this.id()}-add`);
  }

  private focus(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${elementId}`)?.focus(), {
      injector: this.injector,
    });
  }
}

function isItem(value: unknown): value is Item {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
