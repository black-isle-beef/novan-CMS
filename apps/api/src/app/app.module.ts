import { Module } from '@nestjs/common';
import { APP_VERSION, resolveAppVersion } from './app-version';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [HealthController],
  providers: [{ provide: APP_VERSION, useFactory: () => resolveAppVersion() }],
})
export class AppModule {}
