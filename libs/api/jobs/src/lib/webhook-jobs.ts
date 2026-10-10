import type { Database, DbTransaction } from '@novan/api-db';
import { randomUUID } from 'node:crypto';
import { enqueue, type Job } from './queues';

/** A change to tell the space's webhooks about; the worker makes one delivery per subscribed webhook (`@novan/api-webhooks`). */
export interface WebhookDispatchJob extends Job {
  type: 'dispatch';
  spaceId: string;
  /** The change's id, in every delivery of it. */
  eventId: string;
  occurredAt: string;
  event: { type: string; [key: string]: unknown };
}

/** Queues the webhook dispatch for `event` in `tx`, so it happens exactly when the change commits. */
export function dispatchWebhooks(tx: Database | DbTransaction, spaceId: string, event: { type: string }): Promise<void> {
  return enqueue(tx, 'webhooks', {
    type: 'dispatch',
    spaceId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    event: { ...event },
  } satisfies WebhookDispatchJob);
}
