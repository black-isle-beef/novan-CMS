import { ProblemException } from '@novan/api-common';
import { githubSchemaSourceRequestSchema } from '@novan/shared-schemas';
import { GITHUB_LIMITS, readGithubSchema } from './github-schema-source';

const SHA = 'a'.repeat(40);
const text = (apiId: string) => ({ id: apiId, apiId, label: apiId, type: 'text' });
const page = { apiId: 'page', name: 'Page', kind: 'page', fields: [text('title')] };
const hero = { apiId: 'hero', name: 'Hero', fields: [text('heading')] };

type Route = (url: URL, init: RequestInit) => Response | undefined;

/** A GitHub stand-in: a repo `acme/site` on branch `main`, with `novan/schema` holding `files`. */
function github(files: Record<string, unknown>, extra: Route = () => undefined) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), headers: init.headers as Record<string, string> });
    const answer = extra(url, init);
    if (answer) return answer;
    const path = decodeURIComponent(url.pathname);
    if (path === '/repos/acme/site') return Response.json({ default_branch: 'main' });
    if (path === '/repos/acme/site/commits/main') return new Response(SHA);
    const listing = path.match(/^\/repos\/acme\/site\/contents\/(novan\/schema\/(?:content-types|block-types))$/);
    if (listing) {
      const inDir = Object.keys(files).filter((file) => file.startsWith(`${listing[1]}/`));
      if (!inDir.length) return new Response('{"message":"Not Found"}', { status: 404 });
      return Response.json(inDir.map((file) => ({ type: 'file', name: file.split('/').at(-1), path: file, size: JSON.stringify(files[file]).length })));
    }
    const file = path.match(/^\/repos\/acme\/site\/contents\/(.+)$/)?.[1];
    if (file && file in files) return new Response(typeof files[file] === 'string' ? (files[file] as string) : JSON.stringify(files[file]));
    return new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const request = (body: Record<string, unknown> = {}) => githubSchemaSourceRequestSchema.parse({ repoUrl: 'https://github.com/acme/site', ...body });

async function problem(promise: Promise<unknown>): Promise<{ status: number; code: string; detail?: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProblemException) {
      const { status, code, detail } = error.toProblem();
      return { status, code, detail };
    }
    throw error;
  }
  throw new Error('Expected a problem');
}

describe('githubSchemaSourceRequestSchema', () => {
  it.each(['https://github.com/acme/site', 'https://github.com/acme/site.git', 'https://github.com/acme/site/', 'https://github.com/a-b/my.site_2'])('accepts %s', (repoUrl) => {
    expect(githubSchemaSourceRequestSchema.safeParse({ repoUrl }).success).toBe(true);
  });

  it.each([
    'http://github.com/acme/site',
    'https://gitlab.com/acme/site',
    'https://github.com.evil.test/acme/site',
    'https://github.com/acme',
    'https://github.com/acme/site/tree/main',
    'https://github.com/acme/..',
    'https://user@github.com/acme/site',
    'git@github.com:acme/site.git',
  ])('refuses %s', (repoUrl) => {
    expect(githubSchemaSourceRequestSchema.safeParse({ repoUrl }).success).toBe(false);
  });

  it('refuses paths and refs that climb out', () => {
    expect(githubSchemaSourceRequestSchema.safeParse({ repoUrl: 'https://github.com/acme/site', path: '../secrets' }).success).toBe(false);
    expect(githubSchemaSourceRequestSchema.safeParse({ repoUrl: 'https://github.com/acme/site', ref: 'main/../x' }).success).toBe(false);
    expect(request().path).toBe('novan/schema');
  });
});

describe('readGithubSchema', () => {
  const files = { 'novan/schema/content-types/page.json': page, 'novan/schema/block-types/hero.json': hero };

  it('reads the default branch at one commit, with the token, from api.github.com only', async () => {
    const { fetcher, calls } = github(files);
    const source = await readGithubSchema(request(), { token: 'ghp_secret', fetcher });

    expect(source).toEqual(
      expect.objectContaining({ repo: 'acme/site', ref: 'main', commitSha: SHA, path: 'novan/schema', contentTypes: [expect.objectContaining({ apiId: 'page' })] }),
    );
    expect(source.blockTypes.map((t) => t.apiId)).toEqual(['hero']);
    expect(calls.every((call) => call.url.startsWith('https://api.github.com/repos/acme/site'))).toBe(true);
    expect(calls.every((call) => call.headers['Authorization'] === 'Bearer ghp_secret')).toBe(true);
    expect(calls.filter((call) => call.url.includes('/contents/')).every((call) => call.url.endsWith(`?ref=${SHA}`))).toBe(true);
  });

  it('sends no Authorization header without a token (public repos)', async () => {
    const { fetcher, calls } = github(files);
    await readGithubSchema(request(), { token: '', fetcher });
    expect(calls.some((call) => 'Authorization' in call.headers)).toBe(false);
  });

  it('uses the ref it is given', async () => {
    const { fetcher, calls } = github(files, (url) => (url.pathname === '/repos/acme/site/commits/release/1.0' ? new Response(SHA) : undefined));
    const source = await readGithubSchema(request({ ref: 'release/1.0' }), { token: '', fetcher });
    expect(source.ref).toBe('release/1.0');
    expect(calls.some((call) => call.url === 'https://api.github.com/repos/acme/site')).toBe(false);
  });

  it('answers repo_not_found, ref_not_found and schema_not_found', async () => {
    const missingRepo = github(files, (url) => (url.pathname === '/repos/acme/site' ? new Response('', { status: 404 }) : undefined));
    expect(await problem(readGithubSchema(request(), { token: '', fetcher: missingRepo.fetcher }))).toEqual(expect.objectContaining({ status: 404, code: 'repo_not_found' }));

    expect(await problem(readGithubSchema(request({ ref: 'nope' }), { token: '', fetcher: github(files).fetcher }))).toEqual(
      expect.objectContaining({ status: 404, code: 'ref_not_found' }),
    );
    expect(await problem(readGithubSchema(request({ path: 'other' }), { token: '', fetcher: github(files).fetcher }))).toEqual(
      expect.objectContaining({ status: 404, code: 'schema_not_found' }),
    );
  });

  it('treats a 403 as not found, unless it is the rate limit', async () => {
    const forbidden = github(files, () => new Response('', { status: 403 }));
    expect((await problem(readGithubSchema(request(), { token: '', fetcher: forbidden.fetcher }))).code).toBe('repo_not_found');

    const limited = github(files, () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
    expect(await problem(readGithubSchema(request(), { token: '', fetcher: limited.fetcher }))).toEqual(expect.objectContaining({ status: 502, code: 'github_unavailable' }));
  });

  it('answers github_unavailable for a refused token and an unreachable GitHub, without the token', async () => {
    const refused = github(files, () => new Response('', { status: 401 }));
    const answer = await problem(readGithubSchema(request(), { token: 'ghp_secret', fetcher: refused.fetcher }));
    expect(answer.code).toBe('github_unavailable');
    expect(JSON.stringify(answer)).not.toContain('ghp_secret');

    const down = (async () => {
      throw new Error('getaddrinfo ENOTFOUND ghp_secret');
    }) as typeof fetch;
    const unreachable = await problem(readGithubSchema(request(), { token: 'ghp_secret', fetcher: down }));
    expect(unreachable.code).toBe('github_unavailable');
    expect(JSON.stringify(unreachable)).not.toContain('ghp_secret');
  });

  it('answers schema_invalid for bad JSON, a bad definition or a misnamed file', async () => {
    const bad = (extra: Record<string, unknown>) => readGithubSchema(request(), { token: '', fetcher: github({ ...files, ...extra }).fetcher });

    expect(await problem(bad({ 'novan/schema/block-types/cta.json': '{ nope' }))).toEqual(
      expect.objectContaining({ status: 422, code: 'schema_invalid', detail: expect.stringContaining('novan/schema/block-types/cta.json is not valid JSON') }),
    );
    expect((await problem(bad({ 'novan/schema/content-types/post.json': { ...page, apiId: 'post', kind: 'nope' } }))).detail).toContain('is not a valid definition');
    expect((await problem(bad({ 'novan/schema/content-types/home.json': page }))).detail).toContain('name the file page.json');
  });

  it('refuses directories over the limits before fetching their files', async () => {
    const many = Object.fromEntries(Array.from({ length: GITHUB_LIMITS.files + 1 }, (_, i) => [`novan/schema/block-types/b${i}.json`, { ...hero, apiId: `b${i}` }]));
    const { fetcher, calls } = github(many);
    expect((await problem(readGithubSchema(request(), { token: '', fetcher }))).code).toBe('schema_invalid');
    expect(calls.filter((call) => call.url.includes('.json')).length).toBe(0);
  });
});
