import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { features } from '@novan/marketing-content';
import axe from 'axe-core';
import { MkFeatureGrid } from './feature-grid';

describe('MkFeatureGrid', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [MkFeatureGrid], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(MkFeatureGrid);
    fixture.componentRef.setInput('features', features);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('links each feature to its section on /features and labels planned ones in text', () => {
    const host = render();
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('h3 a'));

    expect(links.map((link) => link.getAttribute('href'))).toEqual(features.map((feature) => `/features#${feature.id}`));
    expect(host.querySelectorAll('ds-badge')).toHaveLength(features.filter((feature) => feature.status === 'planned').length);
    expect(host.querySelector('ds-badge')?.textContent?.trim()).toBe('Planned');
  });

  it('has no axe violations', async () => {
    const results = await axe.run(render(), { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
