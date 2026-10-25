import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { defineBlocks } from './blocks';
import { NovanBlocks } from './blocks.component';
import { NOVAN_CMS_CONFIG } from './config';
import { NovanContentService } from './content.service';
import { NovanBlockRoot } from './parts';
import { NovanPreview } from './preview';
import { NovanDesignSystems } from './site-styles';
import type { NovanBlockNode, NovanSiteStyles } from './types';

const API = 'https://api.novan.test/v1/design-system-files';
const styles = (hrefs: string[], framework: string | null = 'bootstrap'): NovanSiteStyles => ({
  layers: '@layer novan-base, ds-vendor, ds-components, novan-overrides;',
  stylesheets: hrefs.map((href) => ({ href, designSystem: 'acme', version: '1.0.0' })),
  adapter: framework ? { framework } : null,
});

@Component({
  selector: 'novan-test-box',
  hostDirectives: [NovanBlockRoot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-novan-part': 'root', class: 'box' },
  template: '',
})
class BoxBlock {
  static readonly novanBlock = { apiId: 'box', schemaVersion: 1 };
}

@Component({
  imports: [NovanBlocks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<novan-blocks [blocks]="blocks()" />`,
})
class Host {
  readonly blocks = signal<NovanBlockNode[]>([]);
}

describe('NovanDesignSystems', () => {
  const siteStyles = vi.fn();
  const links = () => [...document.head.querySelectorAll('link[data-novan-ds]')].map((link) => link.getAttribute('href'));

  beforeEach(() => {
    siteStyles.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: NovanContentService, useValue: { siteStyles } },
        { provide: NOVAN_CMS_CONFIG, useValue: { blocks: defineBlocks({ box: BoxBlock }) } },
        { provide: NovanPreview, useValue: { active: signal(false) } },
      ],
    });
  });
  afterEach(() => document.head.querySelectorAll('link[data-novan-ds]').forEach((link) => link.remove()));

  it("links the site's stylesheets in order, once each", async () => {
    siteStyles.mockReturnValue(of(styles([`${API}/a/one.css`, `${API}/b/two.css`])));
    const service = TestBed.inject(NovanDesignSystems);
    await service.load();
    await service.load();
    expect(links()).toEqual([`${API}/a/one.css`, `${API}/b/two.css`]);
    expect(document.head.querySelector('link[data-novan-ds]')?.getAttribute('rel')).toBe('stylesheet');
  });

  it('removes stylesheets no longer attached', () => {
    const service = TestBed.inject(NovanDesignSystems);
    service.apply(styles([`${API}/a/one.css`, `${API}/b/two.css`]));
    service.apply(styles([`${API}/b/two.css`]));
    expect(links()).toEqual([`${API}/b/two.css`]);
    service.apply(null);
    expect(links()).toEqual([]);
  });

  it('links nothing that is not an http(s) address', () => {
    TestBed.inject(NovanDesignSystems).apply(styles(['javascript:alert(1)', 'data:text/css,x', '/relative.css']));
    expect(links()).toEqual([]);
  });

  it('keeps the site as it is when the API has no design systems or cannot be reached', async () => {
    const service = TestBed.inject(NovanDesignSystems);
    siteStyles.mockReturnValue(of(null));
    await service.load();
    siteStyles.mockReturnValue(throwError(() => new Error('offline')));
    await expect(service.load()).resolves.toBeUndefined();
    expect(links()).toEqual([]);
    expect(service.adapter().framework).toBe('css');
  });

  it("gives blocks the first design system's adapter, and follows a change", () => {
    const service = TestBed.inject(NovanDesignSystems);
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.blocks.set([{ _uid: 'b1', _block: 'box', _overrides: { parts: { root: { base: ['p-2'], md: ['px-3'] } } } }]);
    fixture.detectChanges();
    const box = () => [...(fixture.nativeElement as HTMLElement).querySelector('novan-test-box')?.classList ?? []].sort();
    expect(box()).toEqual(['box', 'p-2']);
    service.apply(styles([], 'bootstrap'));
    fixture.detectChanges();
    expect(box()).toEqual(['box', 'p-2', 'px-md-3']);
  });
});
