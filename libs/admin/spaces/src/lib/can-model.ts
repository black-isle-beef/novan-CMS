// Kept free of `@novan/shared-schemas` imports: the shell and the schema route guard load this at startup,
// and importing a value from that barrel would pull Zod into the initial bundle.

/** Roles that can change the content model (schema screens). The API and RLS apply the same rule. */
const modellingRoles: readonly string[] = ['admin', 'developer'];

/** Whether someone with `role` in a space, or agency staff, can see and change its content model. */
export function canModel(role: string | null | undefined, agencyStaff: boolean): boolean {
  return agencyStaff || modellingRoles.includes(role ?? '');
}
