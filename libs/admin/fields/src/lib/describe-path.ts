import { type BlockType, type FieldDef, isTranslated, LOCALE_CODE_PATTERN } from '@novan/shared-schemas';
import type { z } from 'zod';
import { childrenField } from './blocks';

/** Names for the parts of values that are not fields of their own (links, media). */
const partLabels: Record<string, string> = {
  type: 'Link to',
  entryId: 'Page',
  anchor: 'Section on the page',
  url: 'Web address',
  email: 'Email address',
  text: 'Link text',
  assetId: 'Asset id',
  alt: 'Alternative text',
  _block: 'Block type',
  _uid: 'Block id',
};

/**
 * A readable name for the value at a dotted path, using field labels and block names, for the error
 * summary: `body.1.heading` becomes `Content › Hero block 2 › Heading`, and one locale's value of a translated field,
 * `title.fr-FR`, becomes `Title (French)` with `localeName`.
 */
export function describePath(
  path: string,
  fields: readonly FieldDef[],
  data: unknown,
  blockTypes: readonly BlockType[],
  localeName: (code: string) => string = (code) => code,
): string {
  const parts = path.split('.');
  const labels: string[] = [];
  let available: readonly FieldDef[] | undefined = fields;
  let value: unknown = data;
  let block: BlockType | undefined;

  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    const field: FieldDef | undefined =
      key === 'children' && block ? childrenField(block) : available?.find((candidate) => candidate.apiId === key);
    value = child(value, key);
    if (!field) {
      labels.push(partLabels[key] ?? (/^\d+$/.test(key) ? `Item ${Number(key) + 1}` : key));
      available = undefined;
      continue;
    }
    available = undefined;
    block = undefined;
    const next = parts[i + 1];
    if (isTranslated(field) && next !== undefined && LOCALE_CODE_PATTERN.test(next)) {
      labels.push(`${field.label} (${localeName(next)})`);
      i++;
      value = child(value, next);
      continue;
    }
    labels.push(field.label);

    const index = next !== undefined && /^\d+$/.test(next) ? Number(next) : null;
    if (field.type === 'blocks' && index !== null) {
      i++;
      value = child(value, next);
      const name = typeof (value as { _block?: unknown })?._block === 'string' ? (value as { _block: string })._block : '';
      block = blockTypes.find((type) => type.apiId === name);
      labels.push(`${block?.name ?? 'Block'} block ${index + 1}`);
      available = block?.fields;
    } else if (field.type === 'group') {
      available = field.fields;
      if (field.multiple && index !== null) {
        i++;
        value = child(value, next);
        labels.push(`Item ${index + 1}`);
      }
    }
  }
  return labels.join(' › ');
}

/** Validation issues as the API reports them: dotted path to messages. */
export function errorsFromIssues(issues: readonly z.core.$ZodIssue[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join('.') || '(root)';
    (errors[path] ??= []).push(issue.message);
  }
  return errors;
}

function child(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value[Number(key)];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
