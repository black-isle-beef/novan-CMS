import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { DeviceAuthController, DeviceDecisionController } from './device-auth.controller';
import { DEVICE_AUTH_CONFIG, deviceAuthConfigFromEnv, DeviceAuthService } from './device-auth.service';

/** Device sign-in for the Novan CLI (docs/build/19-schema-cli-starter-kits.md). */
@Module({
  imports: [AuthModule],
  controllers: [DeviceAuthController, DeviceDecisionController],
  providers: [{ provide: DEVICE_AUTH_CONFIG, useFactory: () => deviceAuthConfigFromEnv() }, DeviceAuthService],
})
export class DeviceAuthModule {}
