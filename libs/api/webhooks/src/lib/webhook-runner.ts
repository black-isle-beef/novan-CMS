import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DbService, webhookDeliveries, webhooks } from '@novan/api-db';
import { enqueue, type Job, type JobContext, JobHandlers, PermanentJobError, type WebhookDispatchJob } from '@novan/api-jobs';
import type { WebhookPayload } from '@novan/shared-schemas';
import { and, arrayContains, eq } from 'drizzle-orm';
import { UnsafeWebhookUrlError, WebhookSender } from './webhook-sender';

/** One request to one webhook (a row of `webhook_deliveries`). */
export interface WebhookDeliverJob extends Job {
  type: 'deliver';
  spaceId: string;
  deliveryId: string;
}

/** The body a change is sent as. */
export function webhookPayload(job: Pick<WebhookDispatchJob, 'eventId' | 'occurredAt' | 'spaceId' | 'event'>): WebhookPayload {
  const { type, spaceId: _spaceId, ...data } = job.event;
  return { id: job.eventId, type: type as WebhookPayload['type'], createdAt: job.occurredAt, spaceId: job.spaceId, data };
}

/**
 * The worker's half of webhooks (docs/build/17-scheduling-releases-webhooks.md), on the `webhooks` queue. `dispatch`
 * records one delivery per active webhook subscribed to the change and queues each, in one transaction (a change is
 * recorded once per webhook, however often dispatch runs). `deliver` POSTs it, signed; anything but a 2xx answer is
 * thrown, so the worker retries it with back-off, and the delivery shows each attempt.
 */
@Injectable()
export class WebhookRunner implements OnModuleInit {
  private readonly logger = new Logger(WebhookRunner.name);

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobHandlers,
    private readonly sender: WebhookSender,
  ) {}

  onModuleInit(): void {
    this.jobs.register('webhooks', 'dispatch', (job) => this.dispatch(job as WebhookDispatchJob));
    this.jobs.register('webhooks', 'deliver', (job, context) => this.deliver(job as WebhookDeliverJob, context));
  }

  async dispatch(job: WebhookDispatchJob): Promise<void> {
    if (typeof job.event?.type !== 'string' || typeof job.eventId !== 'string') throw new PermanentJobError('A dispatch job needs an event and its id');
    const subscribed = await this.db.serviceDb
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.spaceId, job.spaceId), eq(webhooks.active, true), arrayContains(webhooks.events, [job.event.type])));
    if (!subscribed.length) return;
    const payload = webhookPayload(job);
    await this.db.transaction(async (tx) => {
      for (const webhook of subscribed) {
        const [created] = await tx
          .insert(webhookDeliveries)
          .values({ webhookId: webhook.id, spaceId: job.spaceId, eventId: job.eventId, event: job.event.type, payload })
          .onConflictDoNothing()
          .returning({ id: webhookDeliveries.id });
        if (created) await enqueue(tx, 'webhooks', { type: 'deliver', spaceId: job.spaceId, deliveryId: created.id } satisfies WebhookDeliverJob);
      }
    });
  }

  async deliver(job: WebhookDeliverJob, context: JobContext): Promise<void> {
    const [row] = await this.db.serviceDb
      .select({ delivery: webhookDeliveries, url: webhooks.url, secret: webhooks.secret, active: webhooks.active })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .where(eq(webhookDeliveries.id, job.deliveryId));
    // Gone with its webhook, or delivered by an attempt that died before it could finish.
    if (!row || row.delivery.status === 'delivered') return;
    if (!row.active) return this.record(job.deliveryId, { status: 'failed', attempt: row.delivery.attempt, error: 'The webhook was turned off before it could be sent.' });

    const body = JSON.stringify(row.delivery.payload);
    let status: number;
    try {
      ({ status } = await this.sender.send(row.url, row.secret, body, {
        'X-Novan-Event': row.delivery.event,
        'X-Novan-Delivery': row.delivery.id,
      }));
    } catch (error) {
      if (error instanceof UnsafeWebhookUrlError) {
        return this.record(job.deliveryId, { status: 'failed', attempt: context.attempt, error: error.message });
      }
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'It did not answer in time.' : `It could not be reached: ${describe(error)}`;
      await this.record(job.deliveryId, { status: context.final ? 'failed' : 'pending', attempt: context.attempt, error: reason });
      throw new Error(`Webhook delivery ${job.deliveryId}: ${reason}`);
    }
    if (status >= 200 && status < 300) {
      await this.record(job.deliveryId, { status: 'delivered', attempt: context.attempt, responseCode: status, error: null });
      return;
    }
    const reason = `It answered ${status}.`;
    await this.record(job.deliveryId, { status: context.final ? 'failed' : 'pending', attempt: context.attempt, responseCode: status, error: reason });
    throw new Error(`Webhook delivery ${job.deliveryId}: ${reason}`);
  }

  private async record(
    id: string,
    outcome: { status: 'pending' | 'delivered' | 'failed'; attempt: number; responseCode?: number | null; error: string | null },
  ): Promise<void> {
    await this.db.serviceDb
      .update(webhookDeliveries)
      .set({ status: outcome.status, attempt: outcome.attempt, responseCode: outcome.responseCode ?? null, error: outcome.error })
      .where(eq(webhookDeliveries.id, id));
    if (outcome.status === 'failed') this.logger.warn(`Webhook delivery ${id} failed: ${outcome.error}`);
  }
}

function describe(error: unknown): string {
  const cause = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return cause ?? (error instanceof Error ? error.message : String(error));
}
