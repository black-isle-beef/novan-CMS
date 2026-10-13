import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CliError } from './errors';
import { readSchemaDir, type SchemaSet } from './schema-files';

/** A folder of seed pages, e.g. the blog's posts under `/blog`. */
export interface SeedFolder {
  /** How entries name it in `folder`. */
  key: string;
  name: string;
  slug: string;
  parent?: string;
}

/**
 * One page or other entry to create and publish. `data` is written plainly, in the space's default language:
 * translated fields are wrapped in a locale map when seeding, and blocks get a `_uid` when they have none. Point at
 * another seed entry with `{ "$entry": "<key>" }`, e.g. an internal link's `"entryId": { "$entry": "about" }`.
 */
export interface SeedEntry {
  key: string;
  contentType: string;
  slug: string;
  folder?: string;
  /** Default true: publish once created. */
  publish?: boolean;
  data: Record<string, unknown>;
}

export interface SeedFile {
  folders?: SeedFolder[];
  entries: SeedEntry[];
}

export interface Kit {
  name: string;
  description: string;
  dir: string;
  schemaDir: string;
  schema: SchemaSet;
  seed: SeedFile;
}

/** `--kits-dir`, `NOVAN_KITS_DIR`, a `kits/` folder here or above (the monorepo's), then the kits the CLI ships with. */
export function findKitsDir(option: string | undefined, cwd: string, cliDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = option ?? env['NOVAN_KITS_DIR'];
  if (explicit) return resolve(cwd, explicit);
  const candidates: string[] = [];
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    candidates.push(join(dir, 'kits'));
    if (dirname(dir) === dir) break;
  }
  candidates.push(join(cliDir, 'kits'));
  const found = candidates.find((dir) => existsSync(join(dir, 'brochure', 'kit.json')));
  if (!found) throw new CliError('Could not find the starter kits. Pass --kits-dir <dir>.');
  return found;
}

export function kitNames(kitsDir: string): string[] {
  return readdirSync(kitsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(kitsDir, entry.name, 'kit.json')))
    .map((entry) => entry.name)
    .sort();
}

export function loadKit(kitsDir: string, name: string): Kit {
  const dir = join(kitsDir, name);
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(join(dir, 'kit.json'))) {
    throw new CliError(`There is no kit "${name}". Kits: ${kitNames(kitsDir).join(', ')}.`);
  }
  const meta = JSON.parse(readFileSync(join(dir, 'kit.json'), 'utf8')) as { name: string; description: string };
  const schemaDir = join(dir, 'schema');
  const seedFile = join(dir, 'seed.json');
  if (!existsSync(seedFile)) throw new CliError(`The ${name} kit has no seed.json.`);
  const seed = JSON.parse(readFileSync(seedFile, 'utf8')) as SeedFile;
  return { name: meta.name, description: meta.description, dir, schemaDir, schema: readSchemaDir(schemaDir), seed };
}
