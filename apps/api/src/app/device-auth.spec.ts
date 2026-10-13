import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JWT_VERIFIER_CONFIG } from '@novan/api-auth';
import { DbService, deviceAuthorizations } from '@novan/api-db';
import { DEVICE_AUTH_CONFIG } from '@novan/api-device-auth';
import type { DeviceAuthorization, DeviceToken } from '@novan/shared-schemas';
import { GoTrueClient } from '@supabase/auth-js';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';

// Device sign-in for the CLI (docs/build/19-schema-cli-starter-kits.md). Needs the local Supabase stack: the database,
// and Auth for the final swap. Who may read the codes is in supabase/tests/device_authorizations.test.sql.
const envFile = resolve(import.meta.dirname, '../../../../.env.local');
if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
const hasDatabase = Boolean(process.env['DATABASE_URL']);
const hasAuth = Boolean(process.env['SUPABASE_SERVICE_ROLE_KEY'] && process.env['SUPABASE_ANON_KEY']);
process.env['DATABASE_URL'] ??= 'postgresql://unused@127.0.0.1:1/unused';

const secret = 'test-secret-with-at-least-32-characters!';
// Seeded (supabase/seed.sql): the developer, an agency developer without staff rights, so AAL1 is enough.
const developerId = '00000000-0000-4000-8000-000000000004';

function jwt(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', aal: 'aal1', spaces: [], agency_staff: false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
}

async function makeApp(config?: object): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(JWT_VERIFIER_CONFIG).useValue({ secret });
  if (config) builder = builder.overrideProvider(DEVICE_AUTH_CONFIG).useValue(config);
  const app = (await builder.compile()).createNestApplication();
  await app.init();
  return app;
}

describe('device sign-in: validation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await makeApp({ adminUrl: 'https://admin.example', supabaseUrl: null, supabaseAnonKey: null });
  });
  afterAll(() => app.close());

  it('answers 503 device_sign_in_unavailable when Supabase is not configured', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/device-authorizations').send({ clientName: 'Novan CLI' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('device_sign_in_unavailable');
  });

  it('answers 503 for the sign-in settings too', async () => {
    const res = await request(app.getHttpServer()).get('/v1/auth/device-authorizations/settings');

    expect(res.status).toBe(503);
  });

  it('refuses a malformed device code', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/device-authorizations/token').send({ deviceCode: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('needs a signed-in person to decide', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/management/device-authorizations/decide')
      .send({ userCode: 'BCDF-GHJK', approve: true });

    expect(res.status).toBe(401);
  });
});

describe.skipIf(!hasDatabase)('device sign-in', () => {
  let app: INestApplication;
  let db: DbService;
  const started: string[] = [];

  beforeAll(async () => {
    app = await makeApp({ adminUrl: 'https://admin.example', supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon' });
    db = app.get(DbService);
  });

  afterAll(async () => {
    for (const userCode of started) {
      await db.serviceDb.delete(deviceAuthorizations).where(eq(deviceAuthorizations.userCode, userCode.replace('-', '')));
    }
    await app.close();
  });

  async function start(): Promise<DeviceAuthorization> {
    const res = await request(app.getHttpServer()).post('/v1/auth/device-authorizations').send({ clientName: 'Novan CLI on test' });
    expect(res.status).toBe(201);
    started.push(res.body.userCode);
    return res.body as DeviceAuthorization;
  }

  const poll = (deviceCode: string) => request(app.getHttpServer()).post('/v1/auth/device-authorizations/token').send({ deviceCode });
  const decide = async (userCode: string, approve: boolean) =>
    request(app.getHttpServer())
      .post('/v1/management/device-authorizations/decide')
      .auth(await jwt(developerId), { type: 'bearer' })
      .send({ userCode, approve });

  it('starts with a code pair pointing at the admin', async () => {
    const auth = await start();

    expect(auth.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(auth.verificationUri).toBe('https://admin.example/device');
    expect(auth.verificationUriComplete).toBe(`https://admin.example/device?code=${auth.userCode}`);
    expect(auth).toMatchObject({ expiresIn: 600, interval: 5 });

    const [row] = await db.serviceDb.select().from(deviceAuthorizations).where(eq(deviceAuthorizations.userCode, auth.userCode.replace('-', '')));
    expect(row?.deviceCodeHash).not.toContain(auth.deviceCode);
    expect(row?.clientName).toBe('Novan CLI on test');
  });

  it("answers Supabase's public settings without a token", async () => {
    const res = await request(app.getHttpServer()).get('/v1/auth/device-authorizations/settings');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon' });
  });

  it('answers authorization_pending, then slow_down when polled too fast', async () => {
    const { deviceCode } = await start();

    expect((await poll(deviceCode)).body.code).toBe('authorization_pending');
    expect((await poll(deviceCode)).body.code).toBe('slow_down');
  });

  it('answers expired_token for an unknown code', async () => {
    const res = await poll('A'.repeat(43));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('expired_token');
  });

  it('answers access_denied once the person denies it', async () => {
    const { deviceCode, userCode } = await start();

    expect((await decide(userCode.toLowerCase(), false)).body).toEqual({ status: 'denied' });
    expect((await poll(deviceCode)).body.code).toBe('access_denied');
  });

  it('answers 404 device_code_not_found for a code already decided', async () => {
    const { userCode } = await start();
    await decide(userCode, true);

    const res = await decide(userCode, true);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('device_code_not_found');
  });

  it.skipIf(!hasAuth)('gives the approver a one-time sign-in that Supabase Auth accepts', async () => {
    const { deviceCode, userCode } = await start();
    expect((await decide(userCode, true)).body).toEqual({ status: 'approved' });

    const res = await poll(deviceCode);
    expect(res.status).toBe(200);
    const token = res.body as DeviceToken;
    expect(token).toMatchObject({ email: 'developer@novan.test', supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon' });

    const auth = new GoTrueClient({
      url: `${process.env['SUPABASE_URL']}/auth/v1`,
      headers: { apikey: process.env['SUPABASE_ANON_KEY'] ?? '' },
      persistSession: false,
      autoRefreshToken: false,
    });
    const { data, error } = await auth.verifyOtp({ token_hash: token.tokenHash, type: 'magiclink' });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(developerId);

    // Used once: polling again gets nothing.
    expect((await poll(deviceCode)).body.code).toBe('expired_token');
  });
});
