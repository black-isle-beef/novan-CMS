// Kept free of `@novan/shared-schemas` imports, like can-model.ts: the shell loads this at startup.

/** Roles that write drafts and add folders. The API and RLS apply the same rule (0006_entries.sql). */
const authorRoles: readonly string[] = ['admin', 'developer', 'editor', 'author'];

/** Roles that publish, unpublish, use the bin and rename or move folders. */
const editorRoles: readonly string[] = ['admin', 'developer', 'editor'];

/** Whether someone with `role` in a space, or agency staff, can save drafts. */
export function canEditContent(role: string | null | undefined, agencyStaff: boolean): boolean {
  return agencyStaff || authorRoles.includes(role ?? '');
}

/** Whether someone with `role` in a space, or agency staff, can publish. */
export function canPublishContent(role: string | null | undefined, agencyStaff: boolean): boolean {
  return agencyStaff || editorRoles.includes(role ?? '');
}
