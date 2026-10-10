import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { WebhookRunner } from './webhook-runner';
import { WEBHOOKS_CONFIG, webhooksConfigFromEnv, WebhookSender } from './webhook-sender';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/** Webhooks: management routes, and the `webhooks` queue's dispatch and deliver jobs (docs/build/17-scheduling-releases-webhooks.md). */
@Module({
  imports: [AuthModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookRunner, WebhookSender, { provide: WEBHOOKS_CONFIG, useFactory: () => webhooksConfigFromEnv() }],
})
export class WebhooksModule {}
