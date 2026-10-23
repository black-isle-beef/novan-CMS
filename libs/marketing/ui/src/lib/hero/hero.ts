import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The top of every page, holding its only `<h1>`. `home` is the large two-column version with a visual
 * (`[mkHeroVisual]`); `page` is a compact heading and introduction for inner pages. Calls to action go in
 * `[mkHeroActions]`.
 */
@Component({
  selector: 'mk-hero',
  templateUrl: './hero.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkHero {
  readonly heading = input.required<string>();
  readonly lede = input<string>();
  /** A short label above the heading. */
  readonly eyebrow = input<string>();
  readonly variant = input<'home' | 'page'>('page');
}
