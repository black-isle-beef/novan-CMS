import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '@novan/api-auth';
import { ContentModule } from '@novan/api-content';
import { MediaModule } from '@novan/api-media';
import { ApiTokenResolver } from './api-token-resolver';
import { ApiTokenGuard } from './api-token.guard';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokensService } from './api-tokens.service';
import { CacheHeadersInterceptor } from './cache-headers.interceptor';
import { CachePurge } from './cache-purge.service';
import { CLOUDFLARE_CONFIG, CloudflareClient, cloudflareConfigFromEnv } from './cloudflare-client';
import { DeliveryController, PreviewController } from './content-api.controllers';
import { ContentReader, DELIVERY_CONFIG, deliveryConfigFromEnv } from './content-reader.service';
import { PREVIEW_SIGNER_CONFIG, PreviewSigner, previewSignerConfigFromEnv } from './preview-signer';
import { PreviewDataController, PreviewSessionController, PreviewSessions, PreviewTokensController } from './preview-sessions';
import { ApiTokenThrottlerGuard, rateLimitsFromEnv, throttlerOptions } from './rate-limit';

@Module({
  imports: [
    AuthModule,
    // For their event buses: publishing and replacing files purge the CDN.
    ContentModule,
    MediaModule,
    ThrottlerModule.forRootAsync({ useFactory: () => throttlerOptions(rateLimitsFromEnv()) }),
  ],
  controllers: [DeliveryController, PreviewController, PreviewSessionController, ApiTokensController, PreviewTokensController, PreviewDataController],
  providers: [
    { provide: DELIVERY_CONFIG, useFactory: () => deliveryConfigFromEnv() },
    { provide: CLOUDFLARE_CONFIG, useFactory: () => cloudflareConfigFromEnv() },
    { provide: PREVIEW_SIGNER_CONFIG, useFactory: () => previewSignerConfigFromEnv() },
    PreviewSigner,
    PreviewSessions,
    ApiTokenResolver,
    ApiTokenGuard,
    ApiTokenThrottlerGuard,
    ApiTokensService,
    CacheHeadersInterceptor,
    CachePurge,
    CloudflareClient,
    ContentReader,
  ],
  exports: [CachePurge, CloudflareClient, CLOUDFLARE_CONFIG],
})
export class DeliveryModule {}
