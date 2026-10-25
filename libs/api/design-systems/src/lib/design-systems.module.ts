import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { ContentModule } from '@novan/api-content';
import { DesignSystemFiles, DesignSystemFilesController } from './design-system-files.controller';
import { DesignSystemProcessor } from './design-system-processor';
import { DesignSystemStorage } from './design-system-storage';
import { DESIGN_SYSTEMS_CONFIG, designSystemsConfigFromEnv } from './design-systems-config';
import { DesignSystemsController, SiteDesignSystemsController } from './design-systems.controller';
import { DesignSystemsService } from './design-systems.service';
import { UploadRateLimitGuard } from './upload-rate-limit.guard';

@Module({
  // ContentModule for its event bus: changing what the site loads purges the CDN (@novan/api-delivery listens).
  imports: [AuthModule, ContentModule],
  controllers: [DesignSystemsController, SiteDesignSystemsController, DesignSystemFilesController],
  providers: [
    { provide: DESIGN_SYSTEMS_CONFIG, useFactory: () => designSystemsConfigFromEnv() },
    DesignSystemsService,
    DesignSystemStorage,
    DesignSystemProcessor,
    DesignSystemFiles,
    UploadRateLimitGuard,
  ],
})
export class DesignSystemsModule {}
