// Kept free of `@novan/shared-schemas` value imports, like can-model.ts: the shell and route guards load this at startup.

/**
 * What the admin shows and guards, by permission. Grants mirror the default roles (0001_tenancy.sql) and the
 * rules the API and RLS apply; the admin only hides what the API would refuse anyway.
 */
export type Permission =
  /** Open the space: dashboard, settings overview, team. */
  | 'space.read'
  /** Pages and other content, and forms. */
  | 'content.read'
  | 'media.read'
  /** Change the content model (Schema). */
  | 'schema.write'
  /** API tokens and webhooks. */
  | 'settings.update'
  | 'audit.read'
  /** Rename the space and set its site address (Space settings). */
  | 'space.update';

const everyone: readonly string[] = ['admin', 'developer', 'editor', 'author', 'viewer'];

const grants: Record<Permission, readonly string[]> = {
  'space.read': everyone,
  'content.read': everyone,
  'media.read': everyone,
  'schema.write': ['admin', 'developer'],
  'settings.update': ['admin', 'developer'],
  'audit.read': ['admin'],
  'space.update': ['admin'],
};

/** Who is asking: their role in the space (null for agency staff who are not members) and whether they are agency staff. */
export interface SpaceAccess {
  role: string | null;
  agencyStaff: boolean;
}

/** Agency staff have every permission; members have their role's. */
export function hasPermission(permission: Permission, access: SpaceAccess): boolean {
  return access.agencyStaff || grants[permission].includes(access.role ?? '');
}

/**
 * Agency mode (admins, developers, agency staff) adds the technical screens; everyone else sees client mode,
 * in plain language.
 */
export function isAgencyMode(access: SpaceAccess): boolean {
  return hasPermission('schema.write', access);
}
