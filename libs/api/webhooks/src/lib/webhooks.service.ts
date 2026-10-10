import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@novan/api-auth';
import { badRequest, forbidden, notFound } from '@novan/api-common';
import { DbService, type DbTransaction, isInsufficientPrivilege, profiles, recordAudit, webhookDeliveries, webhooks } from '@novan/api-db';
import { enqueue } from '@novan/api-jobs';
import {
  type createWebhookRequestSchema,
  type updateWebhookRequestSchema,
  type Webhook,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEventType,
  type WebhookPayload,
  type WebhookWithSecret,
} from '@novan/shared-schemas';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { WebhookDeliverJob } from './webhook-runner';
import { UnsafeWebhookUrlError, WebhookSender } from './webhook-sender';

type CreateBody = z.output<typeof createWebhookRequestSchema>;
type UpdateBody = z.output<typeof updateWebhookRequestSchema>;

/** Every column of `webhooks` but the secret, which no client role may read (0017). */
const columns = {
  id: webhooks.id,
  spaceId: webhooks.spaceId,
  name: webhooks.name,
  url: webhooks.url,
  events: webhooks.events,
  active: webhooks.active,
  createdBy: webhooks.createdBy,
  createdAt: webhooks.createdAt,
  updatedAt: webhooks.updatedAt,
};
type WebhookRow = Omit<typeof webhooks.$inferSelect, 'secret'>;

const deliveryColumns = {
  id: webhookDeliveries.id,
  webhookId: webhookDeliveries.webhookId,
  eventId: webhookDeliveries.eventId,
  event: webhookDeliveries.event,
  status: webhookDeliveries.status,
  responseCode: webhookDeliveries.responseCode,
  attempt: webhookDeliveries.attempt,
  error: webhookDeliveries.error,
  createdAt: webhookDeliveries.createdAt,
  updatedAt: webhookDeliveries.updatedAt,
};

/**
 * A space's webhooks and their delivery log (docs/build/17-scheduling-releases-webhooks.md), for space admins,
 * developers and agency staff. Every query runs as the caller under RLS (0017). The secret is made here and returned
 * once, when the webhook is made or its secret replaced. Changes are audited.
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly db: DbService,
    private readonly sender: WebhookSender,
  ) {}

  list(user: AuthUser, spaceId: string): Promise<Webhook[]> {
    return this.db.userDb(user.claims, (tx) => readWebhooks(tx, eq(webhooks.spaceId, spaceId)));
  }

  async create(user: AuthUser, spaceId: string, body: CreateBody): Promise<WebhookWithSecret> {
    await this.checkUrl(body.url);
    const secret = newSecret();
    return this.write(user, async (tx) => {
      const [row] = await tx
        .insert(webhooks)
        .values({ spaceId, name: body.name, url: body.url, events: body.events, active: body.active, secret, createdBy: user.id })
        .returning({ id: webhooks.id });
      await audit(tx, user, spaceId, row.id, 'webhook.created', { name: body.name, url: body.url, events: body.events, active: body.active });
      return { ...(await this.one(tx, spaceId, row.id)), secret };
    });
  }

  async update(user: AuthUser, spaceId: string, id: string, body: UpdateBody): Promise<Webhook> {
    if (body.url) await this.checkUrl(body.url);
    return this.write(user, async (tx) => {
      const current = await this.one(tx, spaceId, id);
      const updated = await tx.update(webhooks).set(body).where(eq(webhooks.id, id)).returning({ id: webhooks.id });
      if (!updated.length) throw forbidden('insufficient_role', 'Only admins and developers manage webhooks.');
      await audit(tx, user, spaceId, id, 'webhook.updated', { from: pick(current, body), to: body });
      return this.one(tx, spaceId, id);
    });
  }

  /** Replaces the secret: requests are signed with the new one from now on. */
  rotateSecret(user: AuthUser, spaceId: string, id: string): Promise<WebhookWithSecret> {
    const secret = newSecret();
    return this.write(user, async (tx) => {
      await this.one(tx, spaceId, id);
      await tx.update(webhooks).set({ secret }).where(eq(webhooks.id, id));
      await audit(tx, user, spaceId, id, 'webhook.secret_rotated', {});
      return { ...(await this.one(tx, spaceId, id)), secret };
    });
  }

  remove(user: AuthUser, spaceId: string, id: string): Promise<void> {
    return this.write(user, async (tx) => {
      const current = await this.one(tx, spaceId, id);
      await tx.delete(webhooks).where(eq(webhooks.id, id));
      await audit(tx, user, spaceId, id, 'webhook.deleted', { name: current.name, url: current.url });
    });
  }

  /** The webhook's deliveries, newest first. */
  deliveries(user: AuthUser, spaceId: string, id: string, limit = 50): Promise<WebhookDelivery[]> {
    return this.db.userDb(user.claims, async (tx) => {
      await this.one(tx, spaceId, id);
      const rows = await tx
        .select(deliveryColumns)
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, id))
        .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
        .limit(limit);
      return rows.map(toDelivery);
    });
  }

  /** Sends a delivery's request again, as a new delivery of the same event (receivers see the same event id). */
  resend(user: AuthUser, spaceId: string, id: string, deliveryId: string): Promise<WebhookDelivery> {
    return this.write(user, async (tx) => {
      await this.one(tx, spaceId, id);
      const [original] = await tx
        .select({ eventId: webhookDeliveries.eventId, event: webhookDeliveries.event, payload: webhookDeliveries.payload })
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.webhookId, id)));
      if (!original) throw notFound('webhook_delivery_not_found', 'There is no such delivery for this webhook.');
      const delivery = await this.queue(tx, spaceId, id, { ...original, resendOf: deliveryId });
      await audit(tx, user, spaceId, id, 'webhook.delivery_resent', { deliveryId, newDeliveryId: delivery.id });
      return delivery;
    });
  }

  /** Sends a `ping` event, to check the receiver and its signature check. */
  test(user: AuthUser, spaceId: string, id: string): Promise<WebhookDelivery> {
    return this.write(user, async (tx) => {
      await this.one(tx, spaceId, id);
      const eventId = randomUUID();
      const payload: WebhookPayload = { id: eventId, type: 'ping', createdAt: new Date().toISOString(), spaceId, data: { webhookId: id } };
      return this.queue(tx, spaceId, id, { eventId, event: 'ping', payload, resendOf: null });
    });
  }

  private async queue(
    tx: DbTransaction,
    spaceId: string,
    webhookId: string,
    delivery: { eventId: string; event: string; payload: unknown; resendOf: string | null },
  ): Promise<WebhookDelivery> {
    const [created] = await tx
      .insert(webhookDeliveries)
      .values({ webhookId, spaceId, ...delivery })
      .returning(deliveryColumns);
    await enqueue(tx, 'webhooks', { type: 'deliver', spaceId, deliveryId: created.id } satisfies WebhookDeliverJob);
    return toDelivery(created);
  }

  private async one(tx: DbTransaction, spaceId: string, id: string): Promise<Webhook> {
    const [webhook] = await readWebhooks(tx, and(eq(webhooks.spaceId, spaceId), eq(webhooks.id, id)));
    if (!webhook) throw notFound('webhook_not_found', 'There is no such webhook in this space.');
    return webhook;
  }

  private async checkUrl(url: string): Promise<void> {
    try {
      await this.sender.checkUrl(url);
    } catch (error) {
      if (error instanceof UnsafeWebhookUrlError) throw badRequest('webhook_url_refused', error.message);
      // The host's addresses are looked up (production): one that cannot be found cannot be called either.
      if ((error as { code?: string }).code) throw badRequest('webhook_url_refused', 'That address\'s host cannot be found.');
      throw error;
    }
  }

  private async write<T>(user: AuthUser, work: (tx: DbTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.db.userDb(user.claims, work);
    } catch (error) {
      if (isInsufficientPrivilege(error)) throw forbidden('insufficient_role', 'Only admins and developers manage webhooks.');
      throw error;
    }
  }
}

/** `whsec_` and 32 random bytes. */
function newSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

function pick(webhook: Webhook, body: UpdateBody): Record<string, unknown> {
  return Object.fromEntries(Object.keys(body).map((key) => [key, webhook[key as keyof Webhook]]));
}

function audit(tx: DbTransaction, user: AuthUser, spaceId: string, id: string, action: string, diff: Record<string, unknown>): Promise<void> {
  return recordAudit(tx, { spaceId, actorId: user.id, action, targetType: 'webhook', targetId: id, diff });
}

async function readWebhooks(tx: DbTransaction, where: SQL | undefined): Promise<Webhook[]> {
  const rows = await tx
    .select({ webhook: columns, createdByName: profiles.displayName })
    .from(webhooks)
    .leftJoin(profiles, eq(profiles.userId, webhooks.createdBy))
    .where(where)
    .orderBy(webhooks.createdAt);
  if (!rows.length) return [];
  const latest = await tx
    .selectDistinctOn([webhookDeliveries.webhookId], {
      webhookId: webhookDeliveries.webhookId,
      status: webhookDeliveries.status,
      responseCode: webhookDeliveries.responseCode,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.webhookId, rows.map((row) => row.webhook.id)))
    .orderBy(webhookDeliveries.webhookId, desc(webhookDeliveries.createdAt));
  const last = new Map(latest.map((row) => [row.webhookId, row]));
  return rows.map(({ webhook, createdByName }) => toWebhook(webhook, createdByName, last.get(webhook.id)));
}

function toWebhook(row: WebhookRow, createdByName: string | null, last: { status: string; responseCode: number | null; createdAt: string } | undefined): Webhook {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events as WebhookEventType[],
    active: row.active,
    createdBy: row.createdBy,
    createdByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastDelivery: last ? { status: last.status as WebhookDeliveryStatus, responseCode: last.responseCode, createdAt: last.createdAt } : null,
  };
}

function toDelivery(row: Omit<WebhookDelivery, 'status'> & { status: string }): WebhookDelivery {
  return { ...row, status: row.status as WebhookDeliveryStatus };
}
