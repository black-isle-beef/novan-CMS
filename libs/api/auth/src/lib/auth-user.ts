import type { JwtClaims } from '@novan/api-db';
import type { SpaceClaim } from '@novan/shared-schemas';
import type { Request } from 'express';

/** The signed-in user, built from verified Supabase access-token claims (see 0003_auth_hook.sql). */
export interface AuthUser {
  id: string;
  email: string | null;
  aal: 'aal1' | 'aal2';
  /** From the `agency_staff` claim. Privileges apply only at AAL2 ({@link hasStaffAccess}). */
  agencyStaff: boolean;
  spaces: SpaceClaim[];
  /** The full verified claims, passed to `DbService.userDb` so RLS sees the same token. */
  claims: JwtClaims;
}

/** The space resolved by `SpaceGuard` from `:spaceId`. */
export interface SpaceAccess {
  id: string;
  /** The caller's role key, or null for agency staff who are not members. */
  role: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  space?: SpaceAccess;
}

/** Agency staff count only with a second factor, matching `public.is_agency_staff()`. */
export const hasStaffAccess = (user: AuthUser): boolean => user.agencyStaff && user.aal === 'aal2';

export function toAuthUser(claims: JwtClaims): AuthUser {
  const spaces = Array.isArray(claims['spaces'])
    ? (claims['spaces'] as unknown[]).filter(
        (s): s is SpaceClaim =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as SpaceClaim).id === 'string' &&
          typeof (s as SpaceClaim).role === 'string',
      )
    : [];
  return {
    id: claims.sub as string,
    email: typeof claims['email'] === 'string' ? claims['email'] : null,
    aal: claims['aal'] === 'aal2' ? 'aal2' : 'aal1',
    agencyStaff: claims['agency_staff'] === true,
    spaces,
    claims,
  };
}
