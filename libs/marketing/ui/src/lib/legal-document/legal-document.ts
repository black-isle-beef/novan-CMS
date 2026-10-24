import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { LegalDocument } from '@novan/marketing-content';
import { ConsentService } from '../consent/consent.service';
import { MkRichText } from '../rich-text/rich-text';
import { MkStorageTable } from '../storage-table/storage-table';

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * A legal page: its `<h1>`, the date it last changed, a table of contents and its sections, at a readable measure.
 */
@Component({
  selector: 'mk-legal-document',
  imports: [MkRichText, MkStorageTable, RouterLink],
  templateUrl: './legal-document.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkLegalDocument {
  readonly document = input.required<LegalDocument>();

  protected readonly consent = inject(ConsentService);
  protected readonly lastUpdated = computed(() => longDate.format(new Date(this.document().lastUpdated)));
}
