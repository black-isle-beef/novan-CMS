import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';

/** A menu section that arrives in a later release (forms, webhooks, the audit log). Text from the route's data. */
@Component({
  selector: 'nv-placeholder-page',
  imports: [DsAlertComponent],
  template: `
    <h1 class="mb-1">{{ heading() }}</h1>
    <p class="lead text-body-secondary mb-4">{{ lead() }}</p>
    <ds-alert variant="info">Coming soon. There is nothing to set up here yet.</ds-alert>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPage {
  /** Route data (component input binding). */
  readonly heading = input.required<string>();
  readonly lead = input.required<string>();
}
