import type { Database, DbTransaction } from '@novan/api-db';
import { sql } from 'drizzle-orm';

/** The Supabase Queues (pgmq) the worker reads, created in 0014_jobs.sql. */
export const QUEUES = ['publish', 'purge', 'webhooks', 'housekeeping'] as const;
export type QueueName = (typeof QUEUES)[number];

/**
 * A job: `type` picks its handler on the queue, the rest is its data. Jobs about one space name it in `spaceId`, which
 * also lets tests read only their own jobs. Stored as JSON, so dates are ISO strings.
 */
export interface Job {
  type: string;
  spaceId?: string;
  [key: string]: unknown;
}

/**
 * Sends `job` to `queue` in `tx`, so it exists exactly when the change that caused it commits. Inside
 * `DbService.userDb` the transaction runs as `authenticated`, which has no access to the queues (0014), so the send
 * steps back to the connection's own role for that one statement.
 */
export async function enqueue(tx: Database | DbTransaction, queue: QueueName, job: Job, delaySeconds = 0): Promise<void> {
  const [{ role }] = await tx.execute<{ role: string }>(sql`select current_user::text as role`);
  const asUser = role === 'authenticated';
  if (asUser) await tx.execute(sql`set local role none`);
  await tx.execute(sql`select pgmq.send(${queue}, ${JSON.stringify(job)}::jsonb, ${delaySeconds}::int)`);
  if (asUser) await tx.execute(sql`set local role authenticated`);
}
