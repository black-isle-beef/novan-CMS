import { Controller, Get, UseGuards } from '@nestjs/common';
import { AllowAal1, AuthGuard, type AuthUser, CurrentUser } from '@novan/api-auth';
import { DbService, profiles } from '@novan/api-db';
import type { MeResponse } from '@novan/shared-schemas';
import { eq } from 'drizzle-orm';

@Controller('v1/management/me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly db: DbService) {}

  /** Reachable at AAL1 so the admin can tell agency staff to complete their second factor. */
  @Get()
  @AllowAal1()
  async me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    const [profile] = await this.db.userDb(user.claims, (tx) =>
      tx.select({ displayName: profiles.displayName }).from(profiles).where(eq(profiles.userId, user.id)),
    );
    return {
      id: user.id,
      email: user.email,
      displayName: profile?.displayName ?? null,
      agencyStaff: user.agencyStaff,
      aal: user.aal,
      spaces: user.spaces,
    };
  }
}
