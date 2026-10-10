import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireRole, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import {
  createWebhookRequestSchema,
  updateWebhookRequestSchema,
  type Webhook,
  type WebhookDelivery,
  webhookDeliverySchema,
  webhookSchema,
  type WebhookWithSecret,
  webhookWithSecretSchema,
} from '@novan/shared-schemas';
import { z } from 'zod';
import { WebhooksService } from './webhooks.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/**
 * A space's webhooks (docs/build/17-scheduling-releases-webhooks.md, docs/webhooks.md), for admins and developers (and
 * agency staff), as API tokens. The secret is in the response only when a webhook is made or its secret replaced.
 */
@Controller('v1/management/spaces/:spaceId/webhooks')
@UseGuards(AuthGuard, SpaceGuard)
@RequireRole('admin', 'developer')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @ApiResponse(z.array(webhookSchema))
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<Webhook[]> {
    return this.webhooks.list(user, space.id);
  }

  /** Makes a webhook; the response holds its secret, shown this once (400 `webhook_url_refused`). */
  @Post()
  @HttpCode(201)
  @ApiResponse(webhookWithSecretSchema)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(createWebhookRequestSchema)) body: z.output<typeof createWebhookRequestSchema>,
  ): Promise<WebhookWithSecret> {
    return this.webhooks.create(user, space.id, body);
  }

  @Patch(':id')
  @ApiResponse(webhookSchema)
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateWebhookRequestSchema)) body: z.output<typeof updateWebhookRequestSchema>,
  ): Promise<Webhook> {
    return this.webhooks.update(user, space.id, id, body);
  }

  /** Replaces the secret; the response holds the new one, shown this once. */
  @Post(':id/rotate-secret')
  @HttpCode(200)
  @ApiResponse(webhookWithSecretSchema)
  rotateSecret(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<WebhookWithSecret> {
    return this.webhooks.rotateSecret(user, space.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<void> {
    return this.webhooks.remove(user, space.id, id);
  }

  /** The delivery log, newest first (the last 50). */
  @Get(':id/deliveries')
  @ApiResponse(z.array(webhookDeliverySchema))
  deliveries(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<WebhookDelivery[]> {
    return this.webhooks.deliveries(user, space.id, id);
  }

  /** Sends a delivery's request again, as a new delivery of the same event. */
  @Post(':id/deliveries/:deliveryId/resend')
  @HttpCode(201)
  @ApiResponse(webhookDeliverySchema)
  resend(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Param('deliveryId', idPipe) deliveryId: string,
  ): Promise<WebhookDelivery> {
    return this.webhooks.resend(user, space.id, id, deliveryId);
  }

  /** Sends a `ping` event to check the receiver. */
  @Post(':id/test')
  @HttpCode(201)
  @ApiResponse(webhookDeliverySchema)
  test(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<WebhookDelivery> {
    return this.webhooks.test(user, space.id, id);
  }
}
