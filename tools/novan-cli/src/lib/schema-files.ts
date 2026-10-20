import { fromFiles, SCHEMA_DIRS, type SchemaFile, type SchemaSet } from '@novan/schema-sync';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CliError } from './errors';

// The file format and its parsing live in @novan/schema-sync; this is the schema directory on disk.
export { type BlockTypeFile, type ContentTypeFile, fromRemote, type SchemaSet, toBlockTypeFile, toContentTypeFile } from '@novan/schema-sync';

export function readSchemaDir(dir: string): SchemaSet {
  if (!existsSync(dir)) throw new CliError(`There is no schema at ${dir}. Run novan schema pull, or pass --dir.`);
  const files: SchemaFile[] = [];
  for (const sub of Object.values(SCHEMA_DIRS)) {
    const folder = join(dir, sub);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((name) => name.endsWith('.json'))) {
      const file = join(folder, name);
      try {
        files.push({ path: file, json: JSON.parse(readFileSync(file, 'utf8')) });
      } catch (error) {
        throw new CliError(`${file} is not valid JSON: ${(error as Error).message}`);
      }
    }
  }
  return fromFiles(files, dir);
}

/** Writes the set, removing files of types that are no longer in it. Answers the files written, relative to `dir`. */
export function writeSchemaDir(dir: string, set: SchemaSet): string[] {
  const written: string[] = [];
  for (const [key, sub] of Object.entries(SCHEMA_DIRS) as [keyof SchemaSet, string][]) {
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
