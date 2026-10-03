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
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { DsBadgeComponent } from '@black-isle-beef/novan-design-system';
import type { FieldDef, FieldType } from '@novan/shared-schemas';
import { FieldSettings } from '../field-settings/field-settings';
import {
  fieldTypeLabel,
  fieldTypeOptions,
  type ModelOptions,
  newField,
  noModelOptions,
  uniqueApiId,
} from '../field-types';

let nextId = 0;

/**
 * The field builder: a palette of field types, the ordered field list (drag and drop, or the move
 * buttons for keyboard and single-pointer users) and a side panel with the selected field's settings.
 * Groups nest another field list inside their settings.
 */
@Component({
  selector: 'nv-field-list',
  // FieldSettings nests a FieldList for groups, so each refers to the other lazily.
  imports: [CdkDrag, CdkDragHandle, CdkDropList, DsBadgeComponent, forwardRef(() => FieldSettings)],
  templateUrl: './field-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldList {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly settings = viewChild(FieldSettings);

  readonly fields = model.required<FieldDef[]>();
  readonly options = input<ModelOptions>(noModelOptions);
  readonly heading = input('Fields');
  /** Heading level of this list's title; the settings panel uses the next level. */
  readonly level = input(2);
  /** `side`: settings panel beside the list on wide screens. `stacked`: below it (nested groups). */
  readonly layout = input<'side' | 'stacked'>('side');

  protected readonly uid = `nv-field-list-${nextId++}`;
  protected readonly panelId = `${this.uid}-panel`;
  protected readonly fieldTypeOptions = fieldTypeOptions;
  protected readonly typeLabel = fieldTypeLabel;
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.fields().find((field) => field.id === this.selectedId()) ?? null);
  /** Polite announcement of the last change, for screen reader users. */
  protected readonly announcement = signal('');
  /** Fields added since the page loaded: their API id still follows their label. */
  private readonly added = signal<ReadonlySet<string>>(new Set());

  protected id(name: string, field?: FieldDef): string {
    return field ? `${this.uid}-${name}-${field.id}` : `${this.uid}-${name}`;
  }

  protected isNew(field: FieldDef): boolean {
    return this.added().has(field.id);
  }

  protected add(type: FieldType): void {
    const field = newField(type, this.fields());
    this.added.update((ids) => new Set(ids).add(field.id));
    this.fields.update((fields) => [...fields, field]);
    this.announcement.set(`Added a ${fieldTypeLabel(type).toLowerCase()} field. Its settings are open.`);
    this.open(field);
  }

  protected toggle(field: FieldDef): void {
    if (this.selectedId() === field.id) this.close();
    else this.open(field);
  }

  protected close(): void {
    const field = this.selected();
    this.selectedId.set(null);
    if (field) this.focus(this.id('edit', field));
  }

  protected update(changed: FieldDef): void {
    const siblings = this.fields().filter((field) => field.id !== changed.id);
    // A new field's API id follows its label, so keep it unique among its siblings.
    const field =
      this.isNew(changed) && siblings.some((sibling) => sibling.apiId === changed.apiId)
        ? { ...changed, apiId: uniqueApiId(changed.apiId, new Set(siblings.map((sibling) => sibling.apiId))) }
        : changed;
    this.fields.update((fields) => fields.map((existing) => (existing.id === field.id ? field : existing)));
  }

  protected move(index: number, offset: -1 | 1): void {
    const target = index + offset;
    const fields = [...this.fields()];
    if (target < 0 || target >= fields.length) return;
    moveItemInArray(fields, index, target);
    this.fields.set(fields);
    this.announceMove(fields[target], target, fields.length);

    // Keep focus on the button that was used; once the field reaches that end of the list the button is
    // disabled, so move focus to the opposite one.
    const field = fields[target];
    const used = offset < 0 ? 'up' : 'down';
    const opposite = offset < 0 ? 'down' : 'up';
    const atEnd = offset < 0 ? target === 0 : target === fields.length - 1;
    this.focus(this.id(atEnd ? opposite : used, field));
  }

  protected drop(event: CdkDragDrop<FieldDef[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const fields = [...this.fields()];
    moveItemInArray(fields, event.previousIndex, event.currentIndex);
    this.fields.set(fields);
    this.announceMove(fields[event.currentIndex], event.currentIndex, fields.length);
  }

  protected remove(index: number): void {
    const fields = [...this.fields()];
    const [removed] = fields.splice(index, 1);
    this.fields.set(fields);
    if (this.selectedId() === removed.id) this.selectedId.set(null);
    this.announcement.set(`Removed ${removed.label || 'the field'}.`);

    const next = fields[Math.min(index, fields.length - 1)];
    this.focus(next ? this.id('edit', next) : this.id('add-heading'));
  }

  private open(field: FieldDef): void {
    this.selectedId.set(field.id);
    afterNextRender(() => this.settings()?.focusHeading(), { injector: this.injector });
  }

  private announceMove(field: FieldDef, index: number, count: number): void {
    this.announcement.set(`${field.label || 'Field'} moved to position ${index + 1} of ${count}.`);
  }

  private focus(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${elementId}`)?.focus(), {
      injector: this.injector,
    });
  }
}
