import { Injectable, signal } from '@angular/core';
import type { BlockType } from '@novan/shared-schemas';

/** An entry that reference and internal link fields can point at. */
export interface ReferenceOption {
  id: string;
  title: string;
  /** Content type api id. */
  contentType: string;
  path: string;
}

/**
 * What every field control in one form shares, however deeply nested: the environment's block types,
 * the entries references can choose from, the current validation errors (dotted path to messages, as
 * the API and `buildEntrySchema` report them) and whether the form is read-only.
 *
 * Provide one per form, on the page component that hosts it.
 */
@Injectable()
export class FieldFormContext {
  readonly blockTypes = signal<BlockType[]>([]);
  readonly entries = signal<ReferenceOption[]>([]);
  readonly errors = signal<Record<string, string[]>>({});
  readonly readonly = signal(false);

  blockType(apiId: string): BlockType | undefined {
    return this.blockTypes().find((type) => type.apiId === apiId);
  }

  /** Whether there are errors at `path` or inside it (for example a field inside a collapsed block). */
  hasErrorsWithin(path: string): boolean {
    return Object.keys(this.errors()).some((key) => key === path || key.startsWith(`${path}.`));
  }
}

/** `parent.child`, or just `child` at the root. */
export function joinPath(parent: string, child: string | number): string {
  return parent ? `${parent}.${child}` : String(child);
}

/** A DOM id for the control at `path`, also the target of the error summary's links. */
export function fieldId(path: string): string {
  return `field-${path.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
