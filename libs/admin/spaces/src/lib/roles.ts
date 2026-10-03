import { type SpaceRole, spaceRoles } from '@novan/shared-schemas';

export interface RoleOption {
  key: SpaceRole;
  label: string;
  description: string;
}

/** Default roles in the order people usually pick them. */
export const roleOptions: RoleOption[] = [
  { key: 'editor', label: 'Editor', description: 'Writes, changes and publishes pages and media.' },
  { key: 'author', label: 'Author', description: 'Writes and changes pages, but cannot publish.' },
  { key: 'viewer', label: 'Viewer', description: 'Can look but not change anything.' },
  { key: 'developer', label: 'Developer', description: 'Editor rights, plus page types and settings.' },
  { key: 'admin', label: 'Admin', description: 'Everything, including who has access.' },
];

export function roleLabel(role: string | null | undefined): string {
  return roleOptions.find((option) => option.key === role)?.label ?? 'Agency staff';
}

export const isSpaceRole = (value: string): value is SpaceRole => (spaceRoles as readonly string[]).includes(value);

export { canModel } from './can-model';
