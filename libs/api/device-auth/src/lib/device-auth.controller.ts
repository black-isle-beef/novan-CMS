import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser, CurrentUser } from '@novan/api-auth';
import { ProblemException, ZodValidationPipe } from '@novan/api-common';
import {
  decideDeviceAuthorizationRequestSchema,
  type DeviceAuthorization,
  type DeviceAuthorizationDecision,
  type DeviceAuthSettings,
  type DeviceToken,
  deviceTokenRequestSchema,
  startDeviceAuthorizationRequestSchema,
} from '@novan/shared-schemas';
import type { z } from 'zod';
import { MinuteLimiter } from './device-codes';
import { DeviceAuthService } from './device-auth.service';

const tooMany = (detail: string): ProblemException =>
  new ProblemException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many requests', detail);

/**
 * The CLI's side of device sign-in, before anyone is signed in: ask for a code pair, then poll with the device code
 * until the person approves it (docs/build/19-schema-cli-starter-kits.md).
 */
@Controller('v1/auth/device-authorizations')
export class DeviceAuthController {
  /** Code pairs a minute from one address. Polling is limited per code by `slow_down`. */
  private readonly starts = new MinuteLimiter(10);

  constructor(private readonly devices: DeviceAuthService) {}

  @Post()
  @HttpCode(201)
  start(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(startDeviceAuthorizationRequestSchema)) body: z.output<typeof startDeviceAuthorizationRequestSchema>,
  ): Promise<DeviceAuthorization> {
    if (!this.starts.allow(ip)) throw tooMany('Too many sign-ins were started from here. Wait a minute, then try again.');
    return this.devices.start(body.clientName);
  }

  /**
   * Supabase's public address and anon key, for a CLI signing in without a browser (CI, with `NOVAN_EMAIL` and
   * `NOVAN_PASSWORD`). Both are public: the admin ships them to every browser.
   */
  @Get('settings')
  settings(): DeviceAuthSettings {
    return this.devices.settings();
  }

  /** 400 `authorization_pending`, `slow_down`, `expired_token` or `access_denied` until there is a sign-in to give. */
  @Post('token')
  @HttpCode(200)
  token(@Body(new ZodValidationPipe(deviceTokenRequestSchema)) body: z.output<typeof deviceTokenRequestSchema>): Promise<DeviceToken> {
    return this.devices.token(body.deviceCode);
  }
}

/** The person's side: approve or deny the code the CLI shows, signed in to the admin. */
@Controller('v1/management/device-authorizations')
@UseGuards(AuthGuard)
export class DeviceDecisionController {
  /** Decisions a minute per person, so codes cannot be guessed. */
  private readonly decisions = new MinuteLimiter(10);

  constructor(private readonly devices: DeviceAuthService) {}

  /** 404 `device_code_not_found` for a code that is unknown, expired or already decided. */
  @Post('decide')
  @HttpCode(200)
  decide(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(decideDeviceAuthorizationRequestSchema)) body: z.output<typeof decideDeviceAuthorizationRequestSchema>,
  ): Promise<DeviceAuthorizationDecision> {
    if (!this.decisions.allow(user.id)) throw tooMany('Too many codes were tried. Wait a minute, then try again.');
    return this.devices.decide(user, body.userCode, body.approve);
  }
}
