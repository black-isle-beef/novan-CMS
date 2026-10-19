import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { type Change, diffSchemas } from '@novan/schema-sync';
import { CliError } from './errors';
import { type BlockTypeFile, type SchemaSet, toBlockTypeFile } from './schema-files';

/**
 * Where `@novan/blocks` describes its blocks: `--manifest`, then the installed package's `block-types.json`, then
 * `libs/blocks/block-types.json` in the monorepo, then the copy the published CLI ships with.
 */
export function findManifest(option: string | undefined, cwd: string, cliDir: string): string {
  if (option) return resolve(cwd, option);
  try {
    return createRequire(join(cwd, 'noop.js')).resolve('@novan/blocks/block-types.json');
  } catch {
    // Not installed here; look further.
  }
  const candidates: string[] = [];
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    candidates.push(join(dir, 'libs/blocks/block-types.json'));
    if (dirname(dir) === dir) break;
  }
  candidates.push(join(cliDir, 'block-types.json'));
  const found = candidates.find((file) => existsSync(file));
  if (!found) throw new CliError('Could not find the blocks manifest (@novan/blocks/block-types.json). Pass --manifest <file>.');
  return found;
}

export function readManifest(file: string): BlockTypeFile[] {
  const json = JSON.parse(readFileSync(file, 'utf8')) as { blockTypes?: unknown[] };
  if (!Array.isArray(json.blockTypes)) throw new CliError(`${file} has no "blockTypes" list.`);
  return json.blockTypes.map((type, index) => toBlockTypeFile(type, `${file} blockTypes[${index}]`));
}

/**
 * The block type changes `blocks sync` makes: every named block (all of them with none named) is created or brought
 * in line with the manifest. Without names, only blocks the space already has are updated, so a kit that does not use
 * a block never gets it. Nothing is deleted, and content types are left alone.
 */
export function planBlockSync(manifest: readonly BlockTypeFile[], remote: SchemaSet, names: readonly string[]): { local: SchemaSet; changes: Change[]; skipped: string[] } {
  const unknown = names.filter((name) => !manifest.some((type) => type.apiId === name));
  if (unknown.length) throw new CliError(`@novan/blocks has no block ${unknown.join(', ')}. It has: ${manifest.map((t) => t.apiId).join(', ')}.`);
  const remoteIds = new Set(remote.blockTypes.map((type) => type.apiId));
  const chosen = manifest.filter((type) => (names.length ? names.includes(type.apiId) : remoteIds.has(type.apiId)));
  const skipped = names.length ? [] : manifest.filter((type) => !remoteIds.has(type.apiId)).map((type) => type.apiId);
  const local: SchemaSet = {
    contentTypes: remote.contentTypes,
    blockTypes: [...remote.blockTypes.filter((type) => !chosen.some((c) => c.apiId === type.apiId)), ...chosen],
  };
  const changes = diffSchemas(local, remote).filter((change) => change.action !== 'delete');
  return { local, changes, skipped };
}
