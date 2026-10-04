import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { richTextModel } from './rich-text-model';

/**
 * Renders a rich text field (Tiptap's ProseMirror JSON) as Angular DOM, without `innerHTML`: paragraphs,
 * headings, lists, block quotes, code, rules, line breaks, images, and bold, italic, underline, strike,
 * code, subscript, superscript and link formatting. Links to site paths use the router. Unknown content,
 * unsafe addresses and attributes other than the ones above are dropped.
 */
@Component({
  selector: 'novan-rich-text',
  imports: [NgTemplateOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rich-text.component.html',
})
export class NovanRichText {
  /** The rich text value, e.g. `block.body`. */
  readonly doc = input<unknown>(null);

  protected readonly nodes = computed(() => richTextModel(this.doc()));
  /** Site links use `routerLink` when the app has routes (`provideRouter`), plain links otherwise. */
  protected readonly hasRouter = inject(ActivatedRoute, { optional: true }) !== null;
}
