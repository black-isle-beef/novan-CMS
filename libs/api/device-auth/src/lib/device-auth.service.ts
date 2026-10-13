import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type AuthUser, SupabaseAdmin } from '@novan/api-auth';
import { badRequest, notFound, ProblemException } from '@novan/api-common';
import { DbService, deviceAuthorizations, pgError, users } from '@novan/api-db';
import {
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  type DeviceAuthorization,
  type DeviceAuthorizationDecision,
  type DeviceAuthSettings,
  type DeviceToken,
  type DeviceTokenPendingCode,
  formatUserCode,
} from '@novan/shared-schemas';
import { eq, lt, sql } from 'drizzle-orm';
import { hashDeviceCode, newDeviceCode, newUserCode } from './device-codes';

export interface DeviceAuthConfig {
  /** The admin's address; the approval page is `<adminUrl>/device`. */
  adminUrl: string;
  /** Supabase's public address and anon key, passed to the CLI with its sign-in. Unset: device sign-in is off. */
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}

export const DEVICE_AUTH_CONFIG = Symbol('DEVICE_AUTH_CONFIG');

export function deviceAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeviceAuthConfig {
  return {
    adminUrl: (env['ADMIN_URL'] || 'http://localhost:4200').replace(/\/+$/, ''),
    supabaseUrl: env['SUPABASE_URL']?.replace(/\/+$/, '') || null,
    supabaseAnonKey: env['SUPABASE_ANON_KEY'] || null,
  };
}

const PENDING_DETAIL: Record<DeviceTokenPendingCode, string> = {
  authorization_pending: 'Waiting for the code to be approved in the admin.',
  slow_down: `Poll at most once every ${DEVICE_POLL_INTERVAL_SECONDS} seconds.`,
  expired_token: 'This code has expired or was already used. Run novan login again.',
  access_denied: 'The sign-in was denied in the admin.',
};

const pending = (code: DeviceTokenPendingCode): ProblemException => badRequest(code, PENDING_DETAIL[code]);

/** Where polling a device code got to: still waiting (with why), or approved by this person. */
type PollResult = { waiting: DeviceTokenPendingCode } | { userId: string };

/**
 * Device sign-in for the Novan CLI (RFC 8628). The CLI's two steps happen before anyone is signed in, so they run on
 * the API's own connection; approving runs as the signed-in person through `decide_device_authorization`.
 */
@Injectable()
export class DeviceAuthService {
  private readonly logger = new Logger(DeviceAuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly supabase: SupabaseAdmin,
    @Inject(DEVICE_AUTH_CONFIG) private readonly config: DeviceAuthConfig,
  ) {}

  async start(clientName: string): Promise<DeviceAuthorization> {
    this.signInSettings();
    const deviceCode = newDeviceCode();
    const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000).toISOString();

    // Rows a day past expiry are of no further use.
    await this.db.serviceDb
      .delete(deviceAuthorizations)
      .where(lt(deviceAuthorizations.expiresAt, sql`now() - interval '1 day'`));

    // A user code is unique; on the rare clash, draw another.
    for (let attempt = 0; ; attempt++) {
      const userCode = newUserCode();
      try {
        await this.db.serviceDb
          .insert(deviceAuthorizations)
          .values({ deviceCodeHash: hashDeviceCode(deviceCode), userCode, clientName, expiresAt });
        const shown = formatUserCode(userCode);
        const verificationUri = `${this.config.adminUrl}/device`;
        return {
          deviceCode,
          userCode: shown,
          verificationUri,
          verificationUriComplete: `${verificationUri}?code=${shown}`,
          expiresIn: DEVICE_CODE_TTL_SECONDS,
          interval: DEVICE_POLL_INTERVAL_SECONDS,
        };
      } catch (error) {
        if (attempt >= 3 || pgError(error).code !== '23505') throw error;
      }
    }
  }

  /** Answers the sign-in once, after the code is approved; until then 400 with an RFC 8628 code. */
  async token(deviceCode: string): Promise<DeviceToken> {
    const { supabaseUrl, supabaseAnonKey } = this.signInSettings();
    const result = await this.db.transaction(async (tx): Promise<PollResult> => {
      const [row] = await tx
        .select()
        .from(deviceAuthorizations)
        .where(eq(deviceAuthorizations.deviceCodeHash, hashDeviceCode(deviceCode)))
        .for('update');
      if (!row || row.status === 'used' || Date.parse(row.expiresAt) <= Date.now()) return { waiting: 'expired_token' };
      if (row.status === 'denied') return { waiting: 'access_denied' };
      if (row.status === 'approved' && row.userId) {
        await tx.update(deviceAuthorizations).set({ status: 'used' }).where(eq(deviceAuthorizations.id, row.id));
        return { userId: row.userId };
      }
      const tooSoon = row.lastPolledAt !== null && Date.now() - Date.parse(row.lastPolledAt) < (DEVICE_POLL_INTERVAL_SECONDS - 1) * 1000;
      await tx.update(deviceAuthorizations).set({ lastPolledAt: sql`now()` }).where(eq(deviceAuthorizations.id, row.id));
      return { waiting: tooSoon ? 'slow_down' : 'authorization_pending' };
    });
    if ('waiting' in result) throw pending(result.waiting);

    const [user] = await this.db.serviceDb.select({ email: users.email }).from(users).where(eq(users.id, result.userId));
    if (!user?.email) throw pending('access_denied');

    // A magic link's token, never emailed: the CLI swaps it for a session of its own, separate from the browser's.
    const { data, error } = await this.supabase.auth.generateLink({ type: 'magiclink', email: user.email });
    if (error || !data.properties?.hashed_token) {
      this.logger.error(`Could not make a CLI sign-in: ${error?.message ?? 'no token returned'}`);
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'device_sign_in_failed', 'Service unavailable', 'Signing in failed. Run novan login again.');
    }
    return { tokenHash: data.properties.hashed_token, email: user.email, supabaseUrl, supabaseAnonKey };
  }

  async decide(user: AuthUser, userCode: string, approve: boolean): Promise<DeviceAuthorizationDecision> {
    const [row] = await this.db.userDb(user.claims, (tx) =>
      tx.execute<{ status: string }>(sql`select public.decide_device_authorization(${userCode}, ${approve}) as status`),
    );
    if (row?.status !== 'approved' && row?.status !== 'denied') {
      throw notFound('device_code_not_found', 'This code is not right, has expired or was already used. Run novan login again for a new one.');
    }
    return { status: row.status };
  }

  settings(): DeviceAuthSettings {
    return this.signInSettings();
  }

  private signInSettings(): DeviceAuthSettings {
    const { supabaseUrl, supabaseAnonKey } = this.config;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new ProblemException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'device_sign_in_unavailable',
        'Service unavailable',
        'CLI sign-in is not set up on this API: set SUPABASE_URL and SUPABASE_ANON_KEY.',
      );
    }
    return { supabaseUrl, supabaseAnonKey };
  }
}
