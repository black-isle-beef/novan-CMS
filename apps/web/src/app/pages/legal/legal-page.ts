import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { legalDocuments, type LegalDocumentKey } from '@novan/marketing-content';
import { MkLegalDocument } from '@novan/marketing-ui';

// TODO(legal-review): the privacy policy, cookie policy and accessibility statement are templates
// (libs/marketing/content/src/lib/legal.data.ts) and must be reviewed by the owner before launch.

/** /privacy, /cookies and /accessibility: the document named by the route's `data.document`, laid out as a legal page. */
@Component({
  selector: 'app-legal-page',
  imports: [MkLegalDocument],
  template: '<mk-legal-document [document]="legalDocument()" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalPage {
  readonly document = input.required<LegalDocumentKey>();

  protected readonly legalDocument = computed(() => legalDocuments[this.document()]);
}
