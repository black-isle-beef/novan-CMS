import { requirePermission } from '@novan/admin-spaces';

/**
 * Schema screens are for space admins, developers and agency staff (not while viewing as a client role).
 * Everyone else is sent to the space's dashboard; the menu hides the link too, and the API refuses their writes.
 */
export const requireSchemaAccess = requirePermission('schema.write');