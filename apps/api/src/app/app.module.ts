import { Module } from '@nestjs/common';
import { APP_FILTER, DiscoveryModule } from '@nestjs/core';
import { AuditLogModule } from '@novan/api-audit';
import { ProblemDetailsFilter } from '@novan/api-common';
import { ContentModule } from '@novan/api-content';
import { ContentModelModule } from '@novan/api-content-model';
import { DbModule } from '@novan/api-db';
import { DeliveryModule } from '@novan/api-delivery';
import { DesignSystemsModule } from '@novan/api-design-systems';
import { DeviceAuthModule } from '@novan/api-device-auth';
import { FormsModule } from '@novan/api-forms';
import { JobsModule } from '@novan/api-jobs';
import { MediaModule } from '@novan/api-media';
import { SearchModule } from '@novan/api-search';
import { SiteModule } from '@novan/api-site';
import { SpacesModule } from '@novan/api-spaces';
import { WebhooksModule } from '@novan/api-webhooks';
import { APP_VERSION, resolveAppVersion } from './app-version';
import { DocsController } from './docs/docs.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule, JobsModule, DiscoveryModule, SpacesModule, ContentModelModule, ContentModule, MediaModule, SiteModule, DeliveryModule, WebhooksModule, SearchModule, FormsModule, AuditLogModule, DeviceAuthModule, DesignSystemsModule],
  controllers: [HealthController, DocsController],
  providers: [
    { provide: APP_VERSION, useFactory: () => resolveAppVersion() },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
