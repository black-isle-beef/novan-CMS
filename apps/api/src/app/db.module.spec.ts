import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService, spaces } from '@novan/api-db';
import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Integration test against the local Supabase database (`npm run db:start && npm run db:reset`).
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);

describe.skipIf(!process.env['DATABASE_URL'])('DbModule', () => {
  let moduleRef: TestingModule;
  let db: DbService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [DbModule] }).compile();
    db = moduleRef.get(DbService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('serviceDb can select from spaces', async () => {
    const rows = await db.serviceDb.select({ slug: spaces.slug }).from(spaces);

    expect(rows).toContainEqual({ slug: 'demo-site' });
  });

  it('userDb without claims sees 0 rows', async () => {
    const rows = await db.userDb(null, (tx) => tx.select().from(spaces));

    expect(rows).toHaveLength(0);
  });

  it('userDb runs as authenticated with the claims set, only inside the transaction', async () => {
    const claims = { sub: '00000000-0000-4000-8000-000000000002', role: 'authenticated' };

    const inside = await db.userDb(claims, (tx) =>
      tx.execute<{ role: string; claims: string }>(
        sql`select current_user as role, current_setting('request.jwt.claims', true) as claims`,
      ),
    );
    const after = await db.serviceDb.execute<{ role: string }>(sql`select current_user as role`);

    expect(inside[0].role).toBe('authenticated');
    expect(JSON.parse(inside[0].claims)).toEqual(claims);
    expect(after[0].role).not.toBe('authenticated');
  });

  it('runs afterCommit callbacks once the transaction commits, and never after a rollback', async () => {
    const calls: string[] = [];
    await db.userDb(null, async (tx) => {
      db.afterCommit(tx, () => calls.push('committed'));
      expect(calls).toEqual([]);
    });
    await expect(
      db.transaction(async (tx) => {
        db.afterCommit(tx, () => calls.push('rolled back'));
        throw new Error('no');
      }),
    ).rejects.toThrow('no');

    expect(calls).toEqual(['committed']);
    await db.serviceDb.transaction(async (tx) => expect(() => db.afterCommit(tx, () => undefined)).toThrow('afterCommit needs'));
  });
});
