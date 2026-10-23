import { ChangeDetectionStrategy, Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';
import { primaryNav } from '@novan/marketing-content';

/** An unknown address: a 404 status from the server, and links back into the site. */
@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  template: `
    <section class="mk-container mk-not-found" aria-labelledby="not-found-heading">
      <p class="mk-eyebrow">Error 404</p>
      <h1 id="not-found-heading" class="mk-not-found__title">We could not find that page</h1>
      <p class="mk-not-found__text">The address may be mistyped, or the page may have moved. Try one of these instead:</p>
      <ul class="mk-not-found__links">
        @for (link of links; track link.path) {
          <li><a [routerLink]="link.path">{{ link.label }}</a></li>
        }
      </ul>
      <a routerLink="/" class="btn btn-primary">Go to the home page</a>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {
  protected readonly links = primaryNav.filter((link) => link.path !== '/');

  constructor() {
    // Rendered on the server: answer 404, so search engines and the CDN do not treat it as a page.
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
  }
}
