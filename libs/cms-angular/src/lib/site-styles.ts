// site-styles.ts — loads the design systems attached to the site in Novan CMS (docs/build/24-design-systems.md):
// their stylesheets into `<head>` (on the server, so the first paint has them) and the class adapter that writes
// editors' breakpoint and state classes in the design system's own syntax.
import { DOCUMENT } from '@angular/common';
import { inject, Injectable, Injector, RendererFactory2, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NovanContentService } from './content.service';
import { adapterFor, type ClassAdapter, plainAdapter } from './overrides';
import type { NovanSiteStyles } from './types';

/** Marks the `<link>`s the SDK adds, so it finds them again after hydration and when the list changes. */
const MARK = 'data-novan-ds';

@Injectable({ providedIn: 'root' })
export class NovanDesignSystems {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly renderer = inject(RendererFactory2).createRenderer(null, null);

  /** The site's class adapter: plain CSS until a design system says otherwise. */
  readonly adapter = signal<ClassAdapter>(plainAdapter);
  /** What was loaded; null before, or when the API has nothing to say. */
  readonly styles = signal<NovanSiteStyles | null>(null);

  /** Asks the API once and applies the answer. Never fails: without it the site renders with its own styles. */
  async load(): Promise<void> {
    let styles: NovanSiteStyles | null = null;
    try {
      styles = await firstValueFrom(this.injector.get(NovanContentService).siteStyles());
    } catch {
      return;
    }
    this.apply(styles);
  }

  /** Links each stylesheet once, in order, removes ones no longer attached, and sets the adapter. */
  apply(styles: NovanSiteStyles | null): void {
    this.styles.set(styles);
    this.adapter.set(adapterFor(styles?.adapter));
    const head = this.document.head;
    if (!head) return;
    const wanted = (styles?.stylesheets ?? []).map((sheet) => sheet.href).filter(isHttpUrl);
    const existing = Array.from(head.querySelectorAll<HTMLLinkElement>(`link[${MARK}]`));
    for (const link of existing) {
      if (!wanted.includes(link.getAttribute('href') ?? '')) this.renderer.removeChild(head, link);
    }
    for (const href of wanted) {
      if (existing.some((link) => link.getAttribute('href') === href && link.isConnected)) continue;
      const link = this.renderer.createElement('link') as HTMLLinkElement;
      this.renderer.setAttribute(link, 'rel', 'stylesheet');
      this.renderer.setAttribute(link, 'href', href);
      this.renderer.setAttribute(link, MARK, '');
      this.renderer.appendChild(head, link);
    }
  }
}

/** Only http(s) stylesheets are linked; the API sends nothing else, but the page should not trust that blindly. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
