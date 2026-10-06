import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Line widths (Bootstrap columns) that look like text rather than a grid. */
const widths = [10, 12, 7, 11, 8, 9];

/**
 * A loading placeholder in the shape of the content to come (Bootstrap placeholders from the design system).
 * Screen readers hear `label` once, as a status; the grey lines are hidden from them.
 */
@Component({
  selector: 'nv-skeleton',
  template: `
    <div role="status" class="placeholder-glow">
      <span class="visually-hidden">{{ label() }}</span>
      @for (width of lineWidths(); track $index) {
        <span aria-hidden="true" [class]="'placeholder rounded d-block mb-3 col-' + width" [class.placeholder-lg]="$first && heading()"></span>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Skeleton {
  /** What is loading, e.g. "Loading pages". */
  readonly label = input.required<string>();
  readonly lines = input(4);
  /** Draws the first line taller, like a heading. */
  readonly heading = input(false);

  protected readonly lineWidths = computed(() => Array.from({ length: this.lines() }, (_, i) => (this.heading() && i === 0 ? 5 : widths[i % widths.length])));
}
