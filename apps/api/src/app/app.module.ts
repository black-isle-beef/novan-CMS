import { Module } from '@nestjs/common';
import { DbModule } from '@novan/api-db';
import { APP_VERSION, resolveAppVersion } from './app-version';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule],
  controllers: [HealthController],
  providers: [{ provide: APP_VERSION, useFactory: () => resolveAppVersion() }],
})
export class AppModule {}
