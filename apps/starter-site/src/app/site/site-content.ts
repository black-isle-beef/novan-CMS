import { inject, Injectable } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import {
  isSafeHref,
  type NovanAsset,
  NovanContentService,
  novanLinkHref,
  type NovanLinkValue,
  novanResolveLocale,
  type NovanSiteSettings,
} from '@black-isle-beef/cms-angular';
import type { FooterLinkGroup, NavItem } from '@black-isle-beef/novan-design-system';
import { catchError, forkJoin, map, type Observable, of, shareReplay, switchMap } from 'rxjs';

/** The `navigation` singleton (supabase/seed.sql), edited in the admin's navigation editor. */
export interface NavigationData {
  items?: { label?: string; link?: NovanLinkValue | null; subItems?: { label?: string; link?: NovanLinkValue | null }[] | null }[] | null;
  footerGroups?: { title?: string; links?: { label?: string; link?: NovanLinkValue | null }[] | null }[] | null;
}

/** The `siteSettings` singleton (supabase/seed.sql), edited on the admin's site settings screen. */
export type SiteSettingsData = NovanSiteSettings;

/** A link to one of the organisation's social media profiles. */
export interface SocialLink {
  label: string;
  href: string;
}

/** What every page's header, footer and head show. */
export interface SiteContent {
  siteName: string;
  organisationName: string;
  nav: NavItem[];
  footer: FooterLinkGroup[];
  /** Shown in the header instead of the site name. */
  logo: NovanAsset | null;
  /** The browser tab icon. */
  faviconUrl: string | null;
  /** Shared on social media for pages without a sharing image of their own. */
  shareImage: NovanAsset | null;
  contact: { email: string | null; phone: string | null; address: string | null };
  social: SocialLink[];
  /** A Google Analytics 4 measurement ID. */
  analyticsId: string | null;
  /** The settings as published, for structured data. */
  settings: SiteSettingsData | null;
}

/** Used when site settings are not published yet, so the layout still renders. */
export const FALLBACK_SITE_NAME = 'Home';

/** How the footer names each network the site settings offer. */
const NETWORK_LABELS: Readonly<Record<string, string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

/** The header and footer content of each language, loaded once per visit (once per request on the server). */
@Injectable({ providedIn: 'root' })
export class SiteContentCache {
  private readonly content = inject(NovanContentService);
  private readonly loaded = new Map<string, Observable<SiteContent>>();

  /** The site's content in `locale` (the default when null). */
  get(locale: string | null): Observable<SiteContent> {
    const key = locale ?? '';
    let content = this.loaded.get(key);
    if (!content) {
      const options = locale ? { locale } : {};
      const optional = <T>(source: Observable<T>) => source.pipe(catchError(() => of(null)));
      content = forkJoin([
        optional(this.content.singleton<NavigationData>('navigation', options)),
        optional(this.content.singleton<SiteSettingsData>('siteSettings', options)),
      ]).pipe(
        map(([navigation, settings]) => toSiteContent(navigation, settings)),
        shareReplay(1),
      );
      this.loaded.set(key, content);
    }
    return content;
  }
}

/**
 * Loads the header and footer content in the language of the address (docs/build/16-localisation.md), once per
 * language and visit. A singleton that is missing or fails leaves its part empty rather than failing the page; the
 * cache-tag interceptor stops a page rendered after a failure from being cached.
 */
export const siteContentResolver: ResolveFn<SiteContent> = (_route, state) => {
  const cache = inject(SiteContentCache);
  return novanResolveLocale(state.url).pipe(switchMap(({ locale }) => cache.get(locale)));
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
    logo: image(settings?.logo),
    faviconUrl: image(settings?.favicon)?.url ?? null,
    shareImage: image(settings?.defaultOgImage),
    contact: {
      email: text(settings?.contact?.email),
      phone: text(settings?.contact?.phone),
      address: text(settings?.contact?.address),
    },
    social: (settings?.socialLinks ?? []).flatMap((profile): SocialLink[] => {
      const href = text(profile?.url);
      if (!href || !/^https:\/\//i.test(href) || !isSafeHref(href)) return [];
      const network = text(profile?.network) ?? '';
      return [{ label: NETWORK_LABELS[network] ?? hostOf(href), href }];
    }),
    analyticsId: /^G-[A-Z0-9]{4,16}$/.test(text(settings?.analyticsId) ?? '') ? (text(settings?.analyticsId) as string) : null,
    settings,
  };
}

/** Marks the menu item for the current path (`aria-current="page"`), by path. */
export function withActive(items: NavItem[], path: string): NavItem[] {
  return items.map((item) => ({ ...item, active: item.href === path }));
}

function link(label: unknown, value: NovanLinkValue | null | undefined): { label: string; href: string }[] {
  const name = text(label);
  const href = novanLinkHref(value);
  return name && href ? [{ label: name, href }] : [];
}

/** A delivered image with a usable address. */
function image(asset: NovanAsset | null | undefined): NovanAsset | null {
  return asset && /^https?:\/\/[^/]/i.test(asset.url ?? '') ? asset : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
