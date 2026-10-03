import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@novan/shared-types';
import { APP_VERSION } from '../app-version';

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_VERSION) private readonly version: string) {}

  @Get()
  check(): HealthResponse {
    return { status: 'ok', version: this.version };
  }
}
