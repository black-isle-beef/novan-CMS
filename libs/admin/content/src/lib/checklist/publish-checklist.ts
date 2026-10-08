import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { CheckItem } from './checklist';

/**
 * The pre-publish checklist: what must be fixed before the page can be published, and what is worth a look.
 * Items in a block offer a button that selects it.
 */
@Component({
  selector: 'nv-publish-checklist',
  templateUrl: './publish-checklist.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublishChecklist {
  readonly items = input.required<readonly CheckItem[]>();
  /** Prefix for ids; unique on the page. */
  readonly idPrefix = input('nv-checklist');
  readonly goTo = output<string>();

  protected readonly errors = computed(() => this.items().filter((item) => item.severity === 'error'));
  protected readonly warnings = computed(() => this.items().filter((item) => item.severity === 'warning'));
}
