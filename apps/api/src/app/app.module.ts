import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ProblemDetailsFilter } from '@novan/api-common';
import { ContentModelModule } from '@novan/api-content-model';
import { DbModule } from '@novan/api-db';
import { SpacesModule } from '@novan/api-spaces';
import { APP_VERSION, resolveAppVersion } from './app-version';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule, SpacesModule, ContentModelModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_VERSION, useFactory: () => resolveAppVersion() },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
