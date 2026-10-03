import { hasStaffAccess, type AuthUser, type SpaceAccess } from '@novan/api-auth';
import type { SpaceRole } from '@novan/shared-schemas';

/** Roles that write drafts and folders. RLS applies the same rule (0006_entries.sql). */
export const AUTHORS: SpaceRole[] = ['admin', 'developer', 'editor', 'author'];

/** Roles that publish, unpublish, use the bin and rename or move folders. */
export const EDITORS: SpaceRole[] = ['admin', 'developer', 'editor'];

export function canPublish(user: AuthUser, space: SpaceAccess): boolean {
  return hasStaffAccess(user) || (EDITORS as readonly string[]).includes(space.role ?? '');
}
