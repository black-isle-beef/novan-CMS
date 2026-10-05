/** A text field's value to show, or null when it is missing, empty or not text (stored data is untrusted). */
export function blockText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

let nextId = 0;

/** A page-unique id for wiring `aria-labelledby`, e.g. `novan-hero-block-heading-3`. */
export function blockId(block: string, part: string): string {
  return `${block}-${part}-${nextId++}`;
}
