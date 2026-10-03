import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden, unauthorized } from '@novan/api-common';
import { type AuthenticatedRequest, hasStaffAccess, toAuthUser } from './auth-user';
import { ALLOW_AAL1, REQUIRE_AGENCY_STAFF } from './decorators';
import { JwtVerifier } from './jwt-verifier';

/**
 * Verifies the `Authorization: Bearer <Supabase access token>` header and exposes `req.user`.
 * Agency staff must have completed MFA (AAL2) unless the route has `@AllowAal1()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly verifier: JwtVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw unauthorized('missing_token', 'Send a Supabase access token as a Bearer token.');
    }

    let user;
    try {
      user = toAuthUser(await this.verifier.verify(token));
    } catch {
      throw unauthorized('invalid_token', 'The access token is invalid or has expired.');
    }
    req.user = user;

    const targets = [context.getHandler(), context.getClass()];
    if (user.agencyStaff && user.aal !== 'aal2' && !this.reflector.getAllAndOverride<boolean>(ALLOW_AAL1, targets)) {
      throw forbidden('mfa_required', 'Agency staff must verify a second factor.');
    }
    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_AGENCY_STAFF, targets) && !hasStaffAccess(user)) {
      throw forbidden('agency_staff_only', 'Only agency staff can do this.');
    }
    return true;
  }
}
