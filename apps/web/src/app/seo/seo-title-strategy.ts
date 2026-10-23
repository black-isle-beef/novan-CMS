import { inject, Injectable } from '@angular/core';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { notFoundPage } from '@novan/marketing-content';
import { type SeoConfig, SeoService } from './seo.service';

/** Runs once per navigation with the deepest active route's `data.seo` (the router's own hook for titles). */
@Injectable()
export class SeoTitleStrategy extends TitleStrategy {
  private readonly seo = inject(SeoService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    let route = snapshot.root;
    while (route.firstChild) route = route.firstChild;
    const config = (route.data['seo'] as SeoConfig | undefined) ?? { ...notFoundPage, noIndex: true };
    this.seo.apply(config, snapshot.url);
  }
}
