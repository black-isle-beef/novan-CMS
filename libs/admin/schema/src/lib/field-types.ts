import { type FieldDef, type FieldDefInput, fieldDefSchema, type FieldType } from '@novan/shared-schemas';

/** Types in the same environment that fields can point at (allowed blocks, references, children). */
export interface ModelOptions {
  blockTypes: readonly { apiId: string; name: string }[];
  contentTypes: readonly { apiId: string; name: string }[];
}

export const noModelOptions: ModelOptions = { blockTypes: [], contentTypes: [] };

/** A field type offered in the builder's palette. */
export interface FieldTypeOption {
  type: FieldType;
  label: string;
  description: string;
  /** Bootstrap Icons name. */
  icon: string;
}

export const fieldTypeOptions: readonly FieldTypeOption[] = [
  { type: 'text', label: 'Text', description: 'A line or paragraph of plain text.', icon: 'fonts' },
  { type: 'richText', label: 'Rich text', description: 'Formatted text with headings, lists and links.', icon: 'text-paragraph' },
  { type: 'number', label: 'Number', description: 'A whole or decimal number.', icon: '123' },
  { type: 'boolean', label: 'Yes or no', description: 'An on or off switch.', icon: 'toggle-on' },
  { type: 'date', label: 'Date', description: 'A date, with or without a time.', icon: 'calendar-event' },
  { type: 'select', label: 'Choice', description: 'One or more options from a fixed list.', icon: 'ui-radios' },
  { type: 'media', label: 'Media', description: 'Images, videos or files from the media library.', icon: 'image' },
  { type: 'link', label: 'Link', description: 'A page on the site, a web address or an email address.', icon: 'link-45deg' },
  { type: 'reference', label: 'Reference', description: 'Another entry, such as an author or related page.', icon: 'diagram-2' },
  { type: 'blocks', label: 'Blocks', description: 'Blocks that editors add and arrange.', icon: 'bricks' },
  { type: 'group', label: 'Group', description: 'Related fields kept together, optionally repeatable.', icon: 'collection' },
  { type: 'json', label: 'JSON', description: 'Raw structured data, for developers.', icon: 'braces' },
];

export function fieldTypeLabel(type: FieldType): string {
  return fieldTypeOptions.find((option) => option.type === type)?.label ?? type;
}

/** A camelCase API id from a label: "Meta title" becomes "metaTitle". */
export function toApiId(label: string): string {
  const words = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const camel = words
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
  const id = /^[a-z]/.test(camel) ? camel : `field${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
  return id.slice(0, 64);
}

/** `base`, or `base2`, `base3`... whichever is not taken yet. */
export function uniqueApiId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** A new field of `type` with every default filled in and an API id not used by its siblings. */
export function newField(type: FieldType, siblings: readonly FieldDef[]): FieldDef {
  const label = fieldTypeLabel(type);
  const taken = new Set(siblings.map((field) => field.apiId));
  const common = { id: crypto.randomUUID(), apiId: uniqueApiId(toApiId(label), taken), label };

  let input: FieldDefInput;
  if (type === 'select') {
    input = { ...common, type, options: [{ value: 'option1', label: 'Option 1' }] };
  } else if (type === 'group') {
    input = { ...common, type, fields: [{ id: crypto.randomUUID(), apiId: 'text', label: 'Text', type: 'text' }] };
  } else {
    input = { ...common, type } as FieldDefInput;
  }
  return fieldDefSchema.parse(input);
}
