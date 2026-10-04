import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type NovanAsset, type NovanBlock, novanImage, type NovanLinkValue, novanLinkHref } from '@black-isle-beef/cms-angular';

interface HeroFields {
  heading: string;
  subheading: string;
  image: NovanAsset | null;
  action: NovanLinkValue | null;
}

@Component({
  selector: 'site-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="py-11">
      <h1>{{ heading() }}</h1>
      @if (subheading()) {
        <p class="lead">{{ subheading() }}</p>
      }
      @if (image(); as image) {
        <img [src]="imageUrl()" [alt]="image.alt ?? ''" width="1200" height="600" />
      }
      @if (href(); as href) {
        <a class="btn btn-primary" [href]="href">{{ action()?.text || 'Find out more' }}</a>
      }
    </section>
  `,
})
export class HeroBlock implements NovanBlock<HeroFields> {
  static readonly novanBlock = { apiId: 'hero', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly subheading = input<string>();
  readonly image = input<NovanAsset | null>();
  readonly action = input<NovanLinkValue | null>();

  protected readonly href = computed(() => novanLinkHref(this.action()));
  protected readonly imageUrl = computed(() => novanImage(this.image(), { width: 1200, height: 600, fit: 'cover' }));
}
