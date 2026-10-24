import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { site } from '@novan/marketing-content';

/**
 * The Novan CMS logo, linking home: the compass mark, the word mark and the "CMS" tag, as in the admin. The images
 * are decorative; the link's name says where it goes. Plain images with their sizes: NgOptimizedImage judges the
 * vector mark by its 1300px viewBox, and the word mark is already small.
 */
@Component({
  selector: 'mk-brand',
  imports: [RouterLink],
  template: `
    <a routerLink="/" class="mk-brand" [attr.aria-label]="label">
      <img src="logos/compass-mark-white.svg" alt="" width="36" height="36" class="mk-brand__mark" [attr.loading]="loading()" />
      <img src="logos/novan-word-white.png" alt="" width="276" height="49" class="mk-brand__word" [attr.loading]="loading()" />
      <span class="mk-brand__tag" aria-hidden="true">CMS</span>
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkBrand {
  /** Load the logo straight away: true in the header, which is on screen at once. */
  readonly priority = input(false);

  protected readonly loading = computed(() => (this.priority() ? 'eager' : 'lazy'));

  protected readonly label = `${site.productName}, home`;
}
