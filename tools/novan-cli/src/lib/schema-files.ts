import {
  type BlockType,
  type ContentType,
  createBlockTypeRequestSchema,
  createContentTypeRequestSchema,
} from '@novan/shared-schemas';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { z } from 'zod';
import { CliError } from './errors';

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

const DIRS = { contentTypes: 'content-types', blockTypes: 'block-types' } as const;

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

export function readSchemaDir(dir: string): SchemaSet {
  if (!existsSync(dir)) throw new CliError(`There is no schema at ${dir}. Run novan schema pull, or pass --dir.`);
  const read = <T extends { apiId: string }>(sub: string, convert: (value: unknown, where: string) => T): T[] => {
    const folder = join(dir, sub);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const file = join(folder, name);
        let json: unknown;
        try {
          json = JSON.parse(readFileSync(file, 'utf8'));
        } catch (error) {
          throw new CliError(`${file} is not valid JSON: ${(error as Error).message}`);
        }
        const type = convert(json, file);
        if (`${type.apiId}.json` !== name) throw new CliError(`${file} defines "${type.apiId}": name the file ${type.apiId}.json.`);
        return type;
      });
  };
  const set = { contentTypes: read(DIRS.contentTypes, toContentTypeFile), blockTypes: read(DIRS.blockTypes, toBlockTypeFile) };
  if (!set.contentTypes.length && !set.blockTypes.length) throw new CliError(`${dir} has no content types or block types.`);
  return set;
}

/** Writes the set, removing files of types that are no longer in it. Answers the files written, relative to `dir`. */
export function writeSchemaDir(dir: string, set: SchemaSet): string[] {
  const written: string[] = [];
  for (const [key, sub] of Object.entries(DIRS) as [keyof SchemaSet, string][]) {
    const folder = join(dir, sub);
    mkdirSync(folder, { recursive: true });
    const keep = new Set<string>();
    for (const type of set[key]) {
      const file = join(folder, `${type.apiId}.json`);
      writeFileSync(file, JSON.stringify(type, null, 2) + '\n');
      keep.add(`${type.apiId}.json`);
      written.push(relative(dir, file));
    }
    for (const name of readdirSync(folder)) if (name.endsWith('.json') && !keep.has(name)) rmSync(join(folder, name));
  }
  return written;
}

function parse<T extends z.ZodType>(schema: T, value: unknown, where: string): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  throw new CliError([`${where} is not a valid definition:`, ...issues].join('\n'));
}
