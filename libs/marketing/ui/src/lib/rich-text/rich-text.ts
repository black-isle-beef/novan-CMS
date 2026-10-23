import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Paragraph } from '@novan/marketing-content';

interface Part {
  text: string;
  href: string | null;
  internal: boolean;
}

/** A paragraph's text with its links: paths in this site use the router, anything else is a plain link. */
@Component({
  selector: 'mk-rich-text',
  imports: [RouterLink],
  template: `@for (part of parts(); track $index) {@if (!part.href) {{{ part.text }}} @else if (part.internal) {<a [routerLink]="part.href">{{ part.text }}</a>} @else {<a [href]="part.href">{{ part.text }}</a>}}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkRichText {
  readonly content = input.required<Paragraph>();

  protected readonly parts = computed<Part[]>(() => {
    const content = this.content();
    const inlines = typeof content === 'string' ? [content] : content;
    return inlines.map((inline) =>
      typeof inline === 'string'
        ? { text: inline, href: null, internal: false }
        : { text: inline.text, href: inline.href, internal: inline.href.startsWith('/') },
    );
  });
}
