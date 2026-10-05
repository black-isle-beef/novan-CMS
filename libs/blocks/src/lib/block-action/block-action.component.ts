import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { novanLinkHref, type NovanLinkValue } from '@black-isle-beef/cms-angular';

/** A `link` field ready to render: its visible text, and the router path for site pages. */
export interface BlockLink {
  readonly text: string;
  readonly href: string;
  /** Set for site paths, which navigate with the router. */
  readonly route: { readonly path: string; readonly fragment: string | undefined } | null;
}

/**
 * A `link` field as a link to render, or null when it has no visible text or no safe address (an unpublished
 * page, an unsafe URL). A link is never shown as a bare address: the button text is what people read.
 */
export function blockLink(link: NovanLinkValue | null | undefined): BlockLink | null {
  const href = novanLinkHref(link);
  const text = typeof link?.text === 'string' ? link.text.trim() : '';
  if (!href || !text) return null;
  if (!href.startsWith('/')) return { text, href, route: null };
  const [path, fragment] = href.split('#', 2);
  return { text, href, route: { path, fragment: fragment || undefined } };
}

/**
 * A block's call-to-action button: a link styled as a design-system hero button. `on="dark"` sits on brand and
 * dark backgrounds, `on="light"` on light ones.
 */
@Component({
  selector: 'novan-block-action',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'novan-block-action' },
  template: `
    @if (link(); as link) {
      @if (link.route && hasRouter) {
        <a [class]="classes()" [routerLink]="link.route.path" [fragment]="link.route.fragment">{{ link.text }}</a>
      } @else {
        <a [class]="classes()" [href]="link.href">{{ link.text }}</a>
      }
    }
  `,
})
export class BlockActionComponent {
  readonly link = input<BlockLink | null>(null);
  /** The background the button sits on. */
  readonly on = input<'light' | 'dark'>('light');

  /** Site links use `routerLink` when the app has routes (`provideRouter`), plain links otherwise. */
  protected readonly hasRouter = inject(ActivatedRoute, { optional: true }) !== null;
  protected readonly classes = computed(() => `btn btn-lg ${this.on() === 'dark' ? 'btn-hero-light' : 'btn-hero-dark'}`);
}
