import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@novan/api-common';
import { fromFiles, SCHEMA_DIRS, type SchemaFile, SchemaSyncError } from '@novan/schema-sync';
import { type GithubSchemaSource, type githubSchemaSourceRequestSchema, parseGithubRepoUrl } from '@novan/shared-schemas';
import type { z } from 'zod';

/** Limits on what one read may fetch, so a wrong path cannot pull a whole repo. */
export const GITHUB_LIMITS = { files: 300, fileBytes: 512 * 1024, totalBytes: 8 * 1024 * 1024 } as const;

const GITHUB_API = 'https://api.github.com';

export interface GithubReaderConfig {
  /** `SCHEMA_GITHUB_TOKEN`: read-only Contents access to the agency's site repos. Without one, only public repos can be read. */
  token: string;
  fetcher?: typeof fetch;
}

/** `SCHEMA_GITHUB_TOKEN` from the API's environment. Never sent anywhere but api.github.com. */
export function githubReaderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GithubReaderConfig {
  return { token: env['SCHEMA_GITHUB_TOKEN'] ?? '' };
}

interface ContentsEntry {
  type: string;
  name: string;
  path: string;
  size: number;
}

/**
 * Reads the schema directory (`content-types/*.json` and `block-types/*.json`) of a GitHub repo at one commit and
 * parses it as the CLI does. Only api.github.com is called, with owner, repo and paths from validated input.
 */
export async function readGithubSchema(
  request: z.output<typeof githubSchemaSourceRequestSchema>,
  config: GithubReaderConfig,
): Promise<GithubSchemaSource> {
  const fetcher = config.fetcher ?? fetch;
  const { owner, repo } = parseGithubRepoUrl(request.repoUrl);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const name = `${owner}/${repo}`;
  const segments = (path: string) => path.split('/').map(encodeURIComponent).join('/');

  const call = async (path: string, accept: string): Promise<Response | null> => {
    let res: Response;
    try {
      res = await fetcher(`${GITHUB_API}${repoPath}${path}`, {
        headers: {
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'novan-cms',
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        redirect: 'error',
      });
    } catch {
      throw githubUnavailable('GitHub could not be reached. Try again in a minute.');
    }
    if (res.status === 404) return null;
    if (res.status === 401) throw githubUnavailable('GitHub refused the API\'s token. Check SCHEMA_GITHUB_TOKEN.');
    if (res.status === 403 || res.status === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) throw githubUnavailable('GitHub\'s rate limit was reached. Try again later.');
      // GitHub answers 403 for a repo the token may not read; treat it as not found, as it does for private repos.
      return null;
    }
    if (!res.ok) throw githubUnavailable(`GitHub answered ${res.status}. Try again later.`);
    return res;
  };
  const json = async <T>(res: Response): Promise<T> => {
    try {
      return (await res.json()) as T;
    } catch {
      throw githubUnavailable('GitHub sent an answer the API could not read.');
    }
  };

  // 1. The commit, so every file comes from the same one.
  let ref = request.ref;
  if (!ref) {
    const found = await call('', 'application/vnd.github+json');
    if (!found) throw repoNotFound(name);
    ref = (await json<{ default_branch: string }>(found)).default_branch;
  }
  const commit = await call(`/commits/${segments(ref)}`, 'application/vnd.github.sha');
  if (!commit) throw (request.ref ? notFound('ref_not_found', `${name} has no branch, tag or commit "${request.ref}".`) : repoNotFound(name));
  const commitSha = (await commit.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw githubUnavailable('GitHub sent an answer the API could not read.');

  // 2. The JSON files in each folder.
  const entries: ContentsEntry[] = [];
  for (const sub of Object.values(SCHEMA_DIRS)) {
    const listed = await call(`/contents/${segments(`${request.path}/${sub}`)}?ref=${commitSha}`, 'application/vnd.github+json');
    if (!listed) continue;
    const body = await json<ContentsEntry[] | ContentsEntry>(listed);
    if (!Array.isArray(body)) continue;
    entries.push(...body.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json')));
  }
  if (!entries.length) {
    throw notFound('schema_not_found', `${name} has no content-types/ or block-types/ JSON files in ${request.path} at ${commitSha.slice(0, 7)}.`);
  }
  if (entries.length > GITHUB_LIMITS.files) throw schemaInvalid(`${request.path} has more than ${GITHUB_LIMITS.files} schema files.`);
  const tooBig = entries.find((entry) => entry.size > GITHUB_LIMITS.fileBytes);
  if (tooBig) throw schemaInvalid(`${tooBig.path} is larger than ${GITHUB_LIMITS.fileBytes / 1024} KB.`);
  if (entries.reduce((sum, entry) => sum + entry.size, 0) > GITHUB_LIMITS.totalBytes) throw schemaInvalid(`${request.path} is larger than ${GITHUB_LIMITS.totalBytes / 1024 / 1024} MB.`);

  // 3. Each file's contents, parsed.
  const files: SchemaFile[] = [];
  for (const entry of entries) {
    const res = await call(`/contents/${segments(entry.path)}?ref=${commitSha}`, 'application/vnd.github.raw+json');
    if (!res) throw githubUnavailable(`${entry.path} disappeared while it was being read. Try again.`);
    const text = await res.text();
    if (text.length > GITHUB_LIMITS.fileBytes) throw schemaInvalid(`${entry.path} is larger than ${GITHUB_LIMITS.fileBytes / 1024} KB.`);
    try {
      files.push({ path: entry.path, json: JSON.parse(text) });
    } catch (error) {
      throw schemaInvalid(`${entry.path} is not valid JSON: ${(error as Error).message}`);
    }
  }

  try {
    const set = fromFiles(files, request.path);
    return { repo: name, ref, commitSha, path: request.path, ...set };
  } catch (error) {
    if (error instanceof SchemaSyncError) throw schemaInvalid(error.message);
    throw error;
  }
}

const repoNotFound = (name: string) =>
  notFound('repo_not_found', `GitHub has no repo ${name} that the API can read. Check the address, and that SCHEMA_GITHUB_TOKEN may read it.`);

const notFound = (code: string, detail: string) => new ProblemException(HttpStatus.NOT_FOUND, code, 'Not found', detail);

const schemaInvalid = (detail: string) => new ProblemException(HttpStatus.UNPROCESSABLE_ENTITY, 'schema_invalid', 'Unprocessable content', detail);

const githubUnavailable = (detail: string) => new ProblemException(HttpStatus.BAD_GATEWAY, 'github_unavailable', 'Bad gateway', detail);
