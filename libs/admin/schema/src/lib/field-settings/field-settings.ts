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
  output,
} from '@angular/core';
import { DsBadgeComponent } from '@black-isle-beef/novan-design-system';
import {
  type FieldDef,
  type FieldDefOf,
  type FieldType,
  mediaKinds,
  richTextMarks,
  richTextNodes,
} from '@novan/shared-schemas';
import { FieldList } from '../field-list/field-list';
import { fieldTypeLabel, type ModelOptions, noModelOptions, toApiId } from '../field-types';

let nextId = 0;

const markLabels: Record<(typeof richTextMarks)[number], string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  code: 'Code',
  link: 'Link',
  subscript: 'Subscript',
  superscript: 'Superscript',
};
const nodeLabels: Record<(typeof richTextNodes)[number], string> = {
  heading: 'Headings',
  bulletList: 'Bulleted lists',
  orderedList: 'Numbered lists',
  blockquote: 'Quotes',
  codeBlock: 'Code blocks',
  horizontalRule: 'Dividers',
  hardBreak: 'Line breaks',
};
const mediaLabels: Record<(typeof mediaKinds)[number], string> = { image: 'Images', video: 'Videos', file: 'Files' };

/** A checkbox in a group that edits a string list setting. */
interface ListChoice {
  value: string;
  label: string;
}

/** Settings of one field, shown in the builder's side panel. Emits the whole field on every change. */
@Component({
  selector: 'nv-field-settings',
  imports: [DsBadgeComponent, forwardRef(() => FieldList)],
  templateUrl: './field-settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldSettings {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly field = input.required<FieldDef>();
  /** Keep the API id in step with the label (fields added in this session only). */
  readonly autoApiId = input(false);
  readonly options = input<ModelOptions>(noModelOptions);
  /** Heading level of the panel title, so nested groups keep the page outline. */
  readonly level = input(3);
  readonly fieldChange = output<FieldDef>();

  protected readonly uid = `nv-field-settings-${nextId++}`;
  protected readonly headingId = `${this.uid}-heading`;
  protected readonly typeLabel = computed(() => fieldTypeLabel(this.field().type));

  protected readonly markChoices: ListChoice[] = richTextMarks.map((value) => ({ value, label: markLabels[value] }));
  protected readonly nodeChoices: ListChoice[] = richTextNodes.map((value) => ({ value, label: nodeLabels[value] }));
  protected readonly mediaChoices: ListChoice[] = mediaKinds.map((value) => ({ value, label: mediaLabels[value] }));
  protected readonly blockChoices = computed<ListChoice[]>(() =>
    this.options().blockTypes.map((type) => ({ value: type.apiId, label: type.name })),
  );
  protected readonly contentTypeChoices = computed<ListChoice[]>(() =>
    this.options().contentTypes.map((type) => ({ value: type.apiId, label: type.name })),
  );

  // One accessor per type with extra settings, so the template reads narrowed fields.
  protected readonly text = this.ofType('text');
  protected readonly richText = this.ofType('richText');
  protected readonly number = this.ofType('number');
  protected readonly boolean = this.ofType('boolean');
  protected readonly date = this.ofType('date');
  protected readonly select = this.ofType('select');
  protected readonly media = this.ofType('media');
  protected readonly link = this.ofType('link');
  protected readonly reference = this.ofType('reference');
  protected readonly blocks = this.ofType('blocks');
  protected readonly group = this.ofType('group');

  /** Select options as editable text, one `value | Label` per line. */
  protected readonly optionsText = computed(
    () => this.select()?.options.map((option) => `${option.value} | ${option.label}`).join('\n') ?? '',
  );

  /** Moves focus to the panel title (after opening the panel). */
  focusHeading(): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${this.headingId}`)?.focus(), {
      injector: this.injector,
    });
  }

  protected id(name: string): string {
    return `${this.uid}-${name}`;
  }

  protected setLabel(event: Event): void {
    const label = valueOf(event);
    this.patch(this.autoApiId() ? { label, apiId: toApiId(label) || 'field' } : { label });
  }

  protected setText(key: string, event: Event): void {
    this.patch({ [key]: valueOf(event) });
  }

  /** Optional text settings: empty removes them. */
  protected setOptionalText(key: string, event: Event): void {
    this.patch({ [key]: valueOf(event).trim() || undefined });
  }

  protected setFlag(key: string, event: Event): void {
    this.patch({ [key]: (event.target as HTMLInputElement).checked });
  }

  /** Number settings: empty removes them. Applied on change, so typing "1." is not rewritten. */
  protected setNumber(key: string, event: Event): void {
    const raw = valueOf(event).trim();
    const value = raw === '' ? undefined : Number(raw);
    this.patch({ [key]: value === undefined || Number.isNaN(value) ? undefined : value });
  }

  protected setBooleanDefault(event: Event): void {
    const value = valueOf(event);
    this.patch({ default: value === '' ? undefined : value === 'true' });
  }

  protected isChecked(key: string, value: string): boolean {
    const list = (this.field() as unknown as Record<string, unknown>)[key];
    return Array.isArray(list) && list.includes(value);
  }

  /** Adds or removes `value` from a list setting, keeping the order of `choices`. */
  protected toggle(key: string, value: string, choices: readonly ListChoice[], event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = new Set((this.field() as unknown as Record<string, unknown[]>)[key] as string[]);
    if (checked) current.add(value);
    else current.delete(value);
    this.patch({ [key]: choices.map((choice) => choice.value).filter((choice) => current.has(choice)) });
  }

  /** Parses `value | Label` lines (a bare value is its own label). Applied on change, not per keystroke. */
  protected setOptions(event: Event): void {
    const options = valueOf(event)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [value, ...label] = line.split('|');
        return { value: value.trim(), label: label.join('|').trim() || value.trim() };
      });
    this.patch({ options });
  }

  protected setGroupFields(fields: FieldDef[]): void {
    this.patch({ fields });
  }

  /**
   * Emits the field with `changes` applied; `undefined` removes a setting. The builder validates the
   * whole field list with the shared Zod schema and shows all problems before saving.
   */
  private patch(changes: Record<string, unknown>): void {
    const next: Record<string, unknown> = { ...this.field(), ...changes };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete next[key];
    }
    this.fieldChange.emit(next as FieldDef);
  }

  private ofType<T extends FieldType>(type: T) {
    return computed(() => {
      const field = this.field();
      return field.type === type ? (field as FieldDefOf<T>) : null;
    });
  }
}

const valueOf = (event: Event): string => (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
