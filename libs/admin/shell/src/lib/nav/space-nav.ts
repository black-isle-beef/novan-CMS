import type { SidebarItem } from '@black-isle-beef/novan-design-system';
import { hasPermission, type Permission, type SpaceAccess } from '@novan/admin-spaces';
import { copy } from '../copy/copy';

/** One link of the space menu. */
export interface ShellNavItem {
  label: string;
  /** Path under `/spaces/:spaceId`; `''` is the space's dashboard. */
  route: string;
  /** Bootstrap Icons classes. */
  icon: string;
  /** Who sees the link. The route's guard checks the same permission, and the API enforces it. */
  permission: Permission;
  /** Other paths under the space that belong to this section, such as `members` under Settings. */
  includes?: readonly string[];
}

/**
 * The space menu, in order. Client roles (editors, authors, viewers) get the first five; admins, developers
 * and agency staff also get the technical screens their role allows.
 */
export const spaceNav: readonly ShellNavItem[] = [
  { label: copy.dashboard, route: '', icon: 'bi bi-house', permission: 'space.read' },
  { label: copy.pages, route: 'content', icon: 'bi bi-file-earmark-richtext', permission: 'content.read' },
  { label: copy.media, route: 'media', icon: 'bi bi-images', permission: 'media.read' },
  { label: copy.forms, route: 'forms', icon: 'bi bi-ui-checks', permission: 'content.read' },
  { label: copy.settings, route: 'settings', icon: 'bi bi-gear', permission: 'space.read', includes: ['members'] },
  { label: 'Schema', route: 'schema', icon: 'bi bi-diagram-3', permission: 'schema.write' },
  { label: 'API tokens', route: 'settings/api-tokens', icon: 'bi bi-key', permission: 'settings.update' },
  { label: 'Webhooks', route: 'webhooks', icon: 'bi bi-broadcast', permission: 'settings.update' },
  { label: 'Audit log', route: 'audit-log', icon: 'bi bi-journal-text', permission: 'audit.read' },
  { label: 'Space settings', route: 'settings/space', icon: 'bi bi-sliders', permission: 'space.update' },
];

/** The links `access` may see in the space, with the section of `url` marked active (the most specific match). */
export function buildSpaceNav(spaceId: string, access: SpaceAccess, url: string, items: readonly ShellNavItem[] = spaceNav): SidebarItem[] {
  const base = `/spaces/${spaceId}`;
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  const within = path === base ? '' : path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;

  const visible = items.filter((item) => hasPermission(item.permission, access));
  const score = (item: ShellNavItem): number => {
    if (within === null) return -1;
    const routes = [item.route, ...(item.includes ?? [])];
    return Math.max(
      ...routes.map((route) => (route === '' ? (within === '' ? 0 : -1) : within === route || within.startsWith(`${route}/`) ? route.length : -1)),
    );
  };
  const best = Math.max(-1, ...visible.map(score));
  const active = best < 0 ? null : visible.find((item) => score(item) === best);

  return visible.map((item) => ({
    label: item.label,
    href: item.route ? `${base}/${item.route}` : base,
    icon: item.icon,
    active: item === active,
  }));
}
