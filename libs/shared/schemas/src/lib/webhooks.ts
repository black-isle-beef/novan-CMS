import { z } from 'zod';

// Webhooks (docs/build/17-scheduling-releases-webhooks.md, docs/webhooks.md).

/** The changes a webhook can be told about. `ping` is sent only by "Send a test". */
export const webhookEventTypes = [
  'entry.published',
  'entry.unpublished',
  'paths.changed',
  'redirects.changed',
  'locales.changed',
  'asset.replaced',
  'asset.deleted',
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

/** Plain words for each event, for the admin. */
export const webhookEventLabels: Readonly<Record<WebhookEventType, string>> = {
  'entry.published': 'A page or entry is published',
  'entry.unpublished': 'A page or entry is unpublished',
  'paths.changed': 'Published addresses change (a page or folder moved)',
  'redirects.changed': 'Redirects change',
  'locales.changed': 'Languages change',
  'asset.replaced': 'A file is replaced',
  'asset.deleted': 'A file is deleted',
};

/** The JSON body of every webhook request. */
export interface WebhookPayload {
  /** The change's id: the same in every delivery of it, so receivers can ignore one they have seen. */
  id: string;
  type: WebhookEventType | 'ping';
  /** When the change happened, UTC ISO 8601. */
  createdAt: string;
  spaceId: string;
  /** What changed: for pages, `entryId`, `environmentId`, `contentType`, `path`, `cacheTags` and more. */
  data: Record<string, unknown>;
}

export const webhookDeliveryStatuses = ['pending', 'delivered', 'failed'] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatuses)[number];

export const webhookDeliverySchema = z.object({
  id: z.uuid(),
  webhookId: z.uuid(),
  eventId: z.uuid(),
  event: z.string(),
  status: z.enum(webhookDeliveryStatuses),
  /** The receiver's HTTP status, when it answered. */
  responseCode: z.number().int().nullable(),
  /** Tries so far. */
  attempt: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const webhookSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  url: z.string(),
  events: z.array(z.enum(webhookEventTypes)),
  active: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastDelivery: webhookDeliverySchema.pick({ status: true, responseCode: true, createdAt: true }).nullable(),
});
export type Webhook = z.infer<typeof webhookSchema>;

/** Returned when a webhook is made or its secret replaced: the only time the secret is shown. */
export const webhookWithSecretSchema = webhookSchema.extend({ secret: z.string() });
export type WebhookWithSecret = z.infer<typeof webhookWithSecretSchema>;

const webhookUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Give the full address it should call, starting https://.');

export const createWebhookRequestSchema = z.strictObject({
  name: z.string().trim().min(1, 'Give it a name.').max(120),
  url: webhookUrl,
  events: z.array(z.enum(webhookEventTypes)).min(1, 'Choose at least one event.'),
  active: z.boolean().default(true),
});
export type CreateWebhookRequest = z.input<typeof createWebhookRequestSchema>;

export const updateWebhookRequestSchema = z.strictObject({
  name: z.string().trim().min(1, 'Give it a name.').max(120).optional(),
  url: webhookUrl.optional(),
  events: z.array(z.enum(webhookEventTypes)).min(1, 'Choose at least one event.').optional(),
  active: z.boolean().optional(),
});
export type UpdateWebhookRequest = z.input<typeof updateWebhookRequestSchema>;
