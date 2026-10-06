import { requirePermission } from '@novan/admin-spaces';

/**
 * API tokens (and webhooks, package 17) are for space admins, developers and agency staff: the roles the API
 * and RLS allow to manage them (0008_api_tokens.sql). Everyone else is sent to the space's dashboard; the menu
 * hides the links too.
 */
export const requireSettingsAccess = requirePermission('settings.update');

/** Space settings (name and site address) are for space admins and agency staff, as RLS on spaces (0004). */
export const requireSpaceSettingsAccess = requirePermission('space.update');