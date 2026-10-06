import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DsButtonComponent, DsModalComponent } from '@black-isle-beef/novan-design-system';
import { Confirm } from './confirm';

/** Shows the {@link Confirm} service's current question. Placed once, in the shell. */
@Component({
  selector: 'nv-confirm-host',
  imports: [DsButtonComponent, DsModalComponent],
  template: `
    <ds-modal
      [open]="confirm.request() !== null"
      (openChange)="!$event && confirm.request()?.answer(false)"
      [heading]="confirm.request()?.heading ?? ''"
      size="sm"
    >
      @if (confirm.request(); as request) {
        <p class="mb-0">{{ request.body }}</p>
      }
      @if (confirm.request(); as request) {
        <div dsModalFooter class="d-flex justify-content-end gap-2">
          <ds-button variant="secondary" (pressed)="request.answer(false)">{{ request.cancelLabel }}</ds-button>
          <ds-button [variant]="request.destructive ? 'danger' : 'primary'" (pressed)="request.answer(true)">
            {{ request.confirmLabel }}
          </ds-button>
        </div>
      }
    </ds-modal>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmHost {
  protected readonly confirm = inject(Confirm);
}
