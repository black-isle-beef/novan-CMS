import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A closing call to action: a heading, a sentence and the actions projected inside. */
@Component({
  selector: 'mk-cta-band',
  template: `
    <section class="mk-cta-band" [attr.aria-labelledby]="headingId">
      <div class="mk-container mk-cta-band__inner">
        <h2 class="mk-cta-band__title" [id]="headingId">{{ heading() }}</h2>
        @if (text(); as text) {
          <p class="mk-cta-band__text">{{ text }}</p>
        }
        <div class="mk-cta-band__actions"><ng-content /></div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkCtaBand {
  readonly heading = input.required<string>();
  readonly text = input<string>();

  protected readonly headingId = 'mk-cta-band-heading';
}
