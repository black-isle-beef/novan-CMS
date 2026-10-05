// components/rich-text/rich-text.component.ts — styles: src/styles/_rich-text.scss.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type NovanBlock, NovanRichText, type ProseMirrorNode } from '@black-isle-beef/cms-angular';

import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { RICH_TEXT_SCHEMA, type RichTextFields, type RichTextSettings } from './rich-text.schema';

/**
 * Formatted text: paragraphs, headings, lists, quotes and links, rendered by the SDK's `<novan-rich-text>`
 * (no `innerHTML`; unsafe links are dropped). Nothing is rendered for an empty document.
 */
@Component({
  selector: 'novan-rich-text-block',
  imports: [NovanRichText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
  template: `
    @if (hasContent()) {
      <div class="novan-rich-text-block__inner container">
        <novan-rich-text class="novan-rich-text-block__body" [doc]="body()" />
      </div>
    }
  `,
})
export class RichTextBlock implements NovanBlock<RichTextFields> {
  static readonly novanBlock = { apiId: 'richText', schemaVersion: 1 };

  readonly body = input<ProseMirrorNode | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<RichTextSettings> | CmsStoredSettings | null | undefined>(undefined);

  protected readonly resolved = computed(() => resolveSettings(RICH_TEXT_SCHEMA, this.settings()));
  protected readonly hasContent = computed(() => {
    const body = this.body();
    return typeof body === 'object' && body !== null && Array.isArray(body.content) && body.content.length > 0;
  });
  protected readonly hostClasses = computed(() =>
    [
      'novan-rich-text-block',
      ...modifierClasses('novan-rich-text-block', RICH_TEXT_SCHEMA, this.resolved()),
      ...(this.hasContent() ? [] : ['novan-rich-text-block--empty']),
    ].join(' '),
  );
}
