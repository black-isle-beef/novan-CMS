import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../schema';

export const DATABASE_URL = Symbol('DATABASE_URL');

export type Database = PostgresJsDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Verified Supabase JWT claims for the signed-in user (see package 03 for the custom claims). */
export type JwtClaims = Record<string, unknown> & { sub?: string };

@Injectable()
export class DbService implements OnApplicationShutdown {
  private readonly client: postgres.Sql;

  /**
   * Connects as the `DATABASE_URL` role, which owns the tables and bypasses RLS.
   * Only for delivery reads (always filtered by the space resolved from the API token)
   * and background jobs. User requests go through {@link userDb}.
   */
  readonly serviceDb: Database;

  constructor(@Inject(DATABASE_URL) url: string) {
    // prepare: false keeps queries compatible with Supabase's transaction-mode pooler.
    this.client = postgres(url, { prepare: false, onnotice: () => undefined });
    this.serviceDb = drizzle(this.client, { schema });
  }

  /**
   * Runs `work` in a transaction as the `authenticated` role with `request.jwt.claims` set,
   * so row-level security applies exactly as it does for Supabase clients.
   * Both settings are transaction-local and reset when the transaction ends.
   */
  userDb<T>(claims: JwtClaims | null, work: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.serviceDb.transaction(async (tx) => {
      await tx.execute(sql`set local role authenticated`);
      await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims ?? {})}, true)`);
      return work(tx);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
