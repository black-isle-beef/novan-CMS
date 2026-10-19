import {
  type BlockType,
  type ContentType,
  createBlockTypeRequestSchema,
  createContentTypeRequestSchema,
} from '@novan/shared-schemas';
import type { z } from 'zod';
import { SchemaSyncError } from './errors';

/**
 * A content model as code: one JSON file per type, in `content-types/<apiId>.json` and `block-types/<apiId>.json`
 * under the schema directory. Each file is the type's create request with every default filled in, which is also
 * what the API answers, so files written by `schema pull` round-trip unchanged.
 */
export type ContentTypeFile = z.output<typeof createContentTypeRequestSchema>;
export type BlockTypeFile = z.output<typeof createBlockTypeRequestSchema>;

export interface SchemaSet {
  contentTypes: ContentTypeFile[];
  blockTypes: BlockTypeFile[];
}

/** The folders under the schema directory, by the part of the set they hold. */
export const SCHEMA_DIRS = { contentTypes: 'content-types', blockTypes: 'block-types' } as const;

/** One schema file as read from disk or a repo: its path (shown in errors) and its parsed JSON. */
export interface SchemaFile {
  /** Where it came from, ending `content-types/<apiId>.json` or `block-types/<apiId>.json`. */
  path: string;
  json: unknown;
}

/** Parses a content type file (or API answer), filling defaults and normalising empty optionals to null. */
export function toContentTypeFile(value: unknown, where = 'content type'): ContentTypeFile {
  const parsed = parse(createContentTypeRequestSchema, value, where);
  return { apiId: parsed.apiId, name: parsed.name, kind: parsed.kind, description: parsed.description ?? null, fields: parsed.fields };
}

export function toBlockTypeFile(value: unknown, where = 'block type'): BlockTypeFile {
  const parsed = parse(createBlockTypeRequestSchema, value, where);
  return {
    apiId: parsed.apiId,
    name: parsed.name,
    icon: parsed.icon ?? null,
    previewImagePath: parsed.previewImagePath ?? null,
    fields: parsed.fields,
    allowedChildren: parsed.allowedChildren,
    styleOptions: parsed.styleOptions,
  };
}

/** The space's model in file form. */
export function fromRemote(contentTypes: readonly ContentType[], blockTypes: readonly BlockType[]): SchemaSet {
  return {
    contentTypes: contentTypes.map(({ apiId, name, kind, description, fields }) => toContentTypeFile({ apiId, name, kind, description, fields })),
    blockTypes: blockTypes.map(({ apiId, name, icon, previewImagePath, fields, allowedChildren, styleOptions }) =>
      toBlockTypeFile({ apiId, name, icon, previewImagePath, fields, allowedChildren, styleOptions }),
    ),
  };
}

/**
 * The set in `files`, which may come from any schema directory: each must be in a `content-types/` or `block-types/`
 * folder and named after its type. Other files are ignored. `from` names the directory in errors.
 */
export function fromFiles(files: readonly SchemaFile[], from: string): SchemaSet {
  const read = <T extends { apiId: string }>(sub: string, convert: (value: unknown, where: string) => T): T[] =>
    files
      .map((file) => ({ file, name: fileName(file.path, sub) }))
      .filter((found): found is { file: SchemaFile; name: string } => found.name !== null)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ file, name }) => {
        const type = convert(file.json, file.path);
        if (`${type.apiId}.json` !== name) throw new SchemaSyncError(`${file.path} defines "${type.apiId}": name the file ${type.apiId}.json.`);
        return type;
      });
  const set = { contentTypes: read(SCHEMA_DIRS.contentTypes, toContentTypeFile), blockTypes: read(SCHEMA_DIRS.blockTypes, toBlockTypeFile) };
  if (!set.contentTypes.length && !set.blockTypes.length) throw new SchemaSyncError(`${from} has no content types or block types.`);
  return set;
}

/** The file's name when it is a `.json` file directly in the `sub` folder, else null. */
function fileName(path: string, sub: string): string | null {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1) ?? '';
  return parts.at(-2) === sub && name.endsWith('.json') ? name : null;
}

function parse<T extends z.ZodType>(schema: T, value: unknown, where: string): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  throw new SchemaSyncError([`${where} is not a valid definition:`, ...issues].join('\n'));
}
