import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Target } from './api';
import { CliError } from './errors';

/**
 * `novan.json` at a site's root: which API, space and environment its schema belongs to, and where the schema files
 * live. Committed with the site, so `novan schema diff` and `push` need no flags there.
 */
export interface ProjectConfig {
  apiUrl?: string;
  space?: string;
  environment?: string;
  /** Relative to `novan.json`. Default `novan/schema`. */
  schemaDir?: string;
}

export const PROJECT_FILE = 'novan.json';
export const DEFAULT_SCHEMA_DIR = 'novan/schema';

export interface FoundProject {
  dir: string;
  config: ProjectConfig;
}

/** The nearest `novan.json` from `cwd` upwards, if any. */
export function findProject(cwd: string): FoundProject | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const file = join(dir, PROJECT_FILE);
    if (existsSync(file)) {
      try {
        return { dir, config: JSON.parse(readFileSync(file, 'utf8')) as ProjectConfig };
      } catch (error) {
        throw new CliError(`${file} is not valid JSON: ${(error as Error).message}`);
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

export function writeProject(dir: string, config: ProjectConfig): string {
  const file = join(dir, PROJECT_FILE);
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return file;
}

/** Who `novan login` signed in as, and where. The refresh token is in the OS keychain, never in this file. */
export interface Profile {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  email: string;
}

/** `NOVAN_CONFIG_DIR`, else `%APPDATA%\novan` on Windows and `$XDG_CONFIG_HOME/novan` (`~/.config/novan`) elsewhere. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env['NOVAN_CONFIG_DIR']) return env['NOVAN_CONFIG_DIR'];
  if (process.platform === 'win32' && env['APPDATA']) return join(env['APPDATA'], 'novan');
  return join(env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'novan');
}

export function readProfile(env: NodeJS.ProcessEnv = process.env): Profile | null {
  const file = join(configDir(env), 'profile.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Profile;
}

export function writeProfile(profile: Profile | null, env: NodeJS.ProcessEnv = process.env): void {
  const dir = configDir(env);
  const file = join(dir, 'profile.json');
  if (!profile) {
    if (existsSync(file)) writeFileSync(file, '{}\n');
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(profile, null, 2) + '\n', { mode: 0o600 });
}

/** Options every command that talks to a space takes. */
export interface TargetOptions {
  api?: string;
  space?: string;
  env?: string;
}

/** The API's address: `--api`, `NOVAN_API_URL`, `novan.json`, then the signed-in profile's. */
export function resolveApiUrl(options: TargetOptions, project: FoundProject | null, env: NodeJS.ProcessEnv = process.env): string {
  const url = options.api ?? env['NOVAN_API_URL'] ?? project?.config.apiUrl ?? readProfile(env)?.apiUrl;
  if (!url) throw new CliError('Which Novan API? Pass --api <url>, set NOVAN_API_URL, or run novan login --api <url>.');
  return url.replace(/\/+$/, '');
}

/** The space and environment: flags, then `NOVAN_SPACE` / `NOVAN_ENVIRONMENT`, then `novan.json`; environment `main`. */
export function resolveTarget(options: TargetOptions, project: FoundProject | null, env: NodeJS.ProcessEnv = process.env): Target {
  const spaceId = options.space ?? env['NOVAN_SPACE'] ?? project?.config.space;
  if (!spaceId) throw new CliError(`Which space? Pass --space <id>, set NOVAN_SPACE, or add "space" to ${PROJECT_FILE}.`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spaceId)) {
    throw new CliError(`"${spaceId}" is not a space id. Space ids look like 0190a5c4-...; novan space list shows yours.`);
  }
  return {
    apiUrl: resolveApiUrl(options, project, env),
    spaceId,
    environment: options.env ?? env['NOVAN_ENVIRONMENT'] ?? project?.config.environment ?? 'main',
  };
}

/** The schema directory: `--dir`, then `novan.json`'s `schemaDir` (relative to it), then `./novan/schema`. */
export function resolveSchemaDir(dirOption: string | undefined, project: FoundProject | null, cwd: string): string {
  if (dirOption) return resolve(cwd, dirOption);
  if (project) return resolve(project.dir, project.config.schemaDir ?? DEFAULT_SCHEMA_DIR);
  return resolve(cwd, DEFAULT_SCHEMA_DIR);
}
