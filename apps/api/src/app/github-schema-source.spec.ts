import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { GITHUB_READER_CONFIG, type GithubReaderConfig } from '@novan/api-content-model';
import { auditEvents, DbService } from '@novan/api-db';
import { and, desc, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// The audit check needs the local Supabase database (`npm run db:start && npm run db:reset`).
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
const githubToken = 'ghp_TestTokenThatMustNeverLeaveTheApi';

// Seeded fixture (supabase/seed.sql).
const agencyId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const demoSpaceId = '00000000-0000-4000-8000-000000000200';

function token(sub: string, spaces: { id: string; role: string }[], staff = false): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: staff ? 'aal2' : 'aal1', spaces, agency_staff: staff })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

const SHA = 'b'.repeat(40);
const files: Record<string, unknown> = {
  'novan/schema/content-types/page.json': { apiId: 'page', name: 'Page', kind: 'page', fields: [{ id: 'title', apiId: 'title', label: 'Title', type: 'text' }] },
};

/** GitHub with one repo, `acme/site`; records the Authorization headers it was sent. */
const sentTokens: string[] = [];
const github: GithubReaderConfig = {
  token: githubToken,
  fetcher: (async (input: string | URL, init: RequestInit = {}) => {
    sentTokens.push((init.headers as Record<string, string>)['Authorization'] ?? '');
    const path = decodeURIComponent(new URL(String(input)).pathname);
    if (path === '/repos/acme/site') return Response.json({ default_branch: 'main' });
    if (path === '/repos/acme/site/commits/main') return new Response(SHA);
    if (path === '/repos/acme/site/contents/novan/schema/content-types') {
      return Response.json(Object.keys(files).map((file) => ({ type: 'file', name: file.split('/').at(-1), path: file, size: 100 })));
    }
    const file = path.replace('/repos/acme/site/contents/', '');
    if (file in files) return new Response(JSON.stringify(files[file]));
    return new Response('', { status: 404 });
  }) as typeof fetch,
};

const url = `/v1/management/spaces/${demoSpaceId}/schema-source/github`;

describe('schema from GitHub API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER_CONFIG)
      .useValue({ secret })
      .overrideProvider(GITHUB_READER_CONFIG)
      .useValue(github)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['admin', 'developer'])('answers 403 to a space %s who is not agency staff', async (role) => {
    const res = await request(app.getHttpServer())
      .post(url)
      .auth(await token(clientId, [{ id: demoSpaceId, role }]), { type: 'bearer' })
      .send({ repoUrl: 'https://github.com/acme/site' });

    expect(res.status).toBe(403);
    expect(sentTokens).toEqual([]);
  });

  it('validates the address before calling GitHub', async () => {
    const res = await request(app.getHttpServer())
      .post(url)
      .auth(await token(agencyId, [], true), { type: 'bearer' })
      .send({ repoUrl: 'https://evil.test/acme/site' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.errors).toHaveProperty(['repoUrl']);
    expect(sentTokens).toEqual([]);
  });

  it('answers repo_not_found for a repo the token cannot read', async () => {
    const res = await request(app.getHttpServer())
      .post(url)
      .auth(await token(agencyId, [], true), { type: 'bearer' })
      .send({ repoUrl: 'https://github.com/acme/private' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('repo_not_found');
    expect(JSON.stringify(res.body)).not.toContain(githubToken);
  });

  describe.skipIf(!hasDatabase)('with the database', () => {
    it('answers the parsed schema to agency staff, never the token, and records an audit event', async () => {
      const res = await request(app.getHttpServer())
        .post(url)
        .auth(await token(agencyId, [], true), { type: 'bearer' })
        .send({ repoUrl: 'https://github.com/acme/site.git' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({ repo: 'acme/site', ref: 'main', commitSha: SHA, path: 'novan/schema', blockTypes: [], contentTypes: [expect.objectContaining({ apiId: 'page', description: null })] }),
      );
      expect(JSON.stringify(res.body)).not.toContain(githubToken);
      expect(sentTokens.at(-1)).toBe(`Bearer ${githubToken}`);

      const [event] = await app
        .get(DbService)
        .serviceDb.select()
        .from(auditEvents)
        .where(and(eq(auditEvents.spaceId, demoSpaceId), eq(auditEvents.action, 'schema.github_read')))
        .orderBy(desc(auditEvents.createdAt))
        .limit(1);
      expect(event).toEqual(expect.objectContaining({ actorId: agencyId, diff: expect.objectContaining({ repo: 'acme/site', commitSha: SHA }) }));
    });
  });
});
