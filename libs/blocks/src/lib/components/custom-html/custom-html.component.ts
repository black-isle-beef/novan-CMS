// components/custom-html/custom-html.component.ts — styles: src/styles/_custom-html.scss.
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  input,
  RendererFactory2,
} from '@angular/core';
import { NOVAN_BLOCK_CONTEXT, type NovanBlock, NovanBlockRoot, NovanPart, NovanPreview } from '@black-isle-beef/cms-angular';

import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { CUSTOM_HTML_PREVIEW_STYLE, CUSTOM_HTML_SCOPE, scopedCustomCss } from './custom-html.css';
import { CUSTOM_HTML_SCHEMA, type CustomHtmlFields, type CustomHtmlSettings } from './custom-html.schema';

/**
 * Markup a developer or editor writes by hand, with CSS for it. The markup goes through Angular's HTML sanitiser, so
 * scripts, event handlers, frames, forms, ids and `style` attributes never reach the page; the CSS styles the block only.
 * Published CSS comes from the site's stylesheet; in preview mode the block adds its current CSS to `<head>` itself,
 * scoped the same way, and keeps it in step with the editor. Nothing is rendered without markup.
 */
@Component({
  selector: 'novan-custom-html-block',
  imports: [NovanPart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [NovanBlockRoot],
  host: { 'data-novan-part': 'root', '[class]': 'hostClasses()' },
  template: `
    @if (hasHtml()) {
      <div class="novan-custom-html-block__inner container" data-novan-part="inner">
        <div class="novan-custom-html-block__content" data-novan-part="content" [innerHTML]="html()"></div>
      </div>
    }
  `,
})
export class CustomHtmlBlock implements NovanBlock<CustomHtmlFields> {
  static readonly novanBlock = { apiId: 'customHtml', schemaVersion: 1 };

  readonly html = input<string | null>();
  readonly css = input<string | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<CustomHtmlSettings> | CmsStoredSettings | null | undefined>(undefined);

  private readonly context = inject(NOVAN_BLOCK_CONTEXT, { optional: true });
  private readonly preview = inject(NovanPreview);

  protected readonly resolved = computed(() => resolveSettings(CUSTOM_HTML_SCHEMA, this.settings()));
  protected readonly hasHtml = computed(() => {
    const html = this.html();
    return typeof html === 'string' && html.trim() !== '';
  });
  /**
   * The block's `_uid`, which its CSS is scoped to; none outside `<novan-blocks>`. Fixed for the component's life:
   * `<novan-blocks>` gives a block with another `_uid` a component of its own.
   */
  private readonly scope = this.context?.uid ?? null;
  protected readonly hostClasses = computed(() =>
    [
      'novan-custom-html-block',
      ...modifierClasses('novan-custom-html-block', CUSTOM_HTML_SCHEMA, this.resolved()),
      ...(this.hasHtml() ? [] : ['novan-custom-html-block--empty']),
    ].join(' '),
  );
  /** The `<style>` text for preview mode; null on published pages, which have the site's stylesheet. */
  private readonly previewCss = computed(() => (this.preview.active() ? scopedCustomCss(this.scope, this.css()) : null));

  constructor() {
    const document = inject(DOCUMENT);
    const renderer = inject(RendererFactory2).createRenderer(null, null);
    const uid = this.scope;
    if (uid !== null) renderer.setAttribute(inject(ElementRef).nativeElement, CUSTOM_HTML_SCOPE, uid);
    let style: HTMLStyleElement | null = null;
    const remove = () => {
      if (style?.parentNode) renderer.removeChild(style.parentNode, style);
      style = null;
    };

    effect(() => {
      const css = this.previewCss();
      if (css === null || uid === null || !document.head) {
        remove();
        return;
      }
      // After hydration, the server's element for this block is already there.
      style ??= document.head.querySelector<HTMLStyleElement>(`style[${CUSTOM_HTML_PREVIEW_STYLE}="${uid}"]`);
      if (!style) {
        style = renderer.createElement('style') as HTMLStyleElement;
        renderer.setAttribute(style, CUSTOM_HTML_PREVIEW_STYLE, uid);
        renderer.appendChild(document.head, style);
      }
      if (style.textContent !== css) renderer.setProperty(style, 'textContent', css);
    });
    inject(DestroyRef).onDestroy(remove);
  }
}
