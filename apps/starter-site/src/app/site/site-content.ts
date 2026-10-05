import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { NovanContentService, novanLinkHref, type NovanLinkValue } from '@black-isle-beef/cms-angular';
import type { FooterLinkGroup, NavItem } from '@black-isle-beef/novan-design-system';
import { catchError, forkJoin, map, type Observable, of } from 'rxjs';

/** The `navigation` singleton (supabase/seed.sql). */
export interface NavigationData {
  items?: { label?: string; link?: NovanLinkValue | null; subItems?: { label?: string; link?: NovanLinkValue | null }[] | null }[] | null;
  footerGroups?: { title?: string; links?: { label?: string; link?: NovanLinkValue | null }[] | null }[] | null;
}

/** The `siteSettings` singleton (supabase/seed.sql). */
export interface SiteSettingsData {
  siteName?: string;
  organisationName?: string;
}

/** What every page's header and footer show. */
export interface SiteContent {
  siteName: string;
  organisationName: string;
  nav: NavItem[];
  footer: FooterLinkGroup[];
}

/** Used when site settings are not published yet, so the layout still renders. */
export const FALLBACK_SITE_NAME = 'Home';

/**
 * Loads the header and footer content once per visit (once per request on the server). A singleton that is
 * missing or fails leaves its part empty rather than failing the page; the cache-tag interceptor stops a page
 * rendered after a failure from being cached.
 */
export const siteContentResolver: ResolveFn<SiteContent> = () => {
  const content = inject(NovanContentService);
  const optional = <T>(source: Observable<T>) => source.pipe(catchError(() => of(null)));
  return forkJoin([
    optional(content.singleton<NavigationData>('navigation')),
    optional(content.singleton<SiteSettingsData>('siteSettings')),
  ]).pipe(map(([navigation, settings]) => toSiteContent(navigation, settings)));
};

export function toSiteContent(navigation: NavigationData | null, settings: SiteSettingsData | null): SiteContent {
  const siteName = text(settings?.siteName) ?? FALLBACK_SITE_NAME;
  return {
    siteName,
    organisationName: text(settings?.organisationName) ?? siteName,
    nav: (navigation?.items ?? []).flatMap((item): NavItem[] => {
      const label = text(item?.label);
      const children = (item?.subItems ?? []).flatMap((sub) => link(sub?.label, sub?.link));
      const href = novanLinkHref(item?.link);
      if (!label || (!href && !children.length)) return [];
      return [{ label, href: href ?? '', ...(children.length ? { children } : {}) }];
    }),
    footer: (navigation?.footerGroups ?? []).flatMap((group): FooterLinkGroup[] => {
      const title = text(group?.title);
      const links = (group?.links ?? []).flatMap((entry) => link(entry?.label, entry?.link));
      return title && links.length ? [{ title, links }] : [];
    }),
  };
}

/** Marks the menu item for the current page (`aria-current="page"`), by path. */
export function withActive(items: NavItem[], path: string): NavItem[] {
  return items.map((item) => ({ ...item, active: item.href === path }));
}

function link(label: unknown, value: NovanLinkValue | null | undefined): { label: string; href: string }[] {
  const name = text(label);
  const href = novanLinkHref(value);
  return name && href ? [{ label: name, href }] : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
