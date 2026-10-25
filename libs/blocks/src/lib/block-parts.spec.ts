// block-parts.spec.ts — every block, rendered by `<novan-blocks>` as on a site, puts the classes an editor gave each
// of its parts (`_overrides`, docs/build/24-design-systems.md) on that part, alongside its own classes.
import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  NOVAN_CMS_CONFIG,
  NovanBlocks,
  type NovanBlockNode,
  NovanContentService,
  NovanForms,
  NovanLocale,
  NovanPreview,
} from '@black-isle-beef/cms-angular';
import { of } from 'rxjs';

import { CMS_COMPONENT_DEFINITIONS } from './cms-components';
import { TURNSTILE_LOADER } from './components/form/turnstile';
import { novanBlocks } from './novan-blocks';

@Component({
  imports: [NovanBlocks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<novan-blocks [blocks]="blocks()" entryId="00000000-0000-4000-8000-000000000099" />`,
})
class Page {
  readonly blocks = input<NovanBlockNode[]>([]);
}

const POSTS = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      contentType: 'post',
      path: '/blog/summer',
      locale: 'en-GB',
      updatedAt: '2026-06-02T10:00:00Z',
      data: { title: 'Summer coat care', summary: 'Keeping cool.', publishedOn: '2026-06-02' },
    },
  ],
  nextCursor: null,
};

/** The class an editor gave a part in these tests. */
const added = (part: string) => `ov-${part}`;

describe.each(CMS_COMPONENT_DEFINITIONS.map((definition) => [definition.type, definition] as const))('%s parts', (apiId, definition) => {
  async function render(overrides: unknown) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOVAN_CMS_CONFIG, useValue: { blocks: novanBlocks } },
        { provide: NovanPreview, useValue: { active: signal(false) } },
        { provide: NovanLocale, useValue: { current: signal('en-GB') } },
        { provide: NovanForms, useValue: { turnstileSiteKey: null, submit: () => Promise.resolve() } },
        { provide: NovanContentService, useValue: { entries: () => of(POSTS) } },
        { provide: TURNSTILE_LOADER, useValue: () => new Promise(() => undefined) },
      ],
    });
    const fixture = TestBed.createComponent(Page);
    const block = { _uid: '00000000-0000-4000-8000-000000000001', _block: apiId, ...definition.sampleContent, _overrides: overrides };
    fixture.componentRef.setInput('blocks', [block]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('adds each part its own classes, and only its own', async () => {
    const parts = Object.fromEntries(definition.parts.map((part) => [part, { base: [added(part)] }]));
    const el = await render({ parts });
    const rendered = [...el.querySelectorAll<HTMLElement>('[data-novan-part]')];
    expect(rendered[0].getAttribute('data-novan-part')).toBe('root');
    for (const element of rendered) {
      const part = element.getAttribute('data-novan-part') as string;
      expect(element.classList.contains(added(part)), `${apiId} ${part}`).toBe(true);
      const others = definition.parts.filter((other) => other !== part).map(added);
      expect([...element.classList].filter((name) => others.includes(name)), `${apiId} ${part}`).toEqual([]);
    }
  });

  /** Markup without the ids each render numbers afresh (`novan-cta-block-heading-3`). */
  const markup = (el: HTMLElement) => el.innerHTML.replace(/\b(id|for|aria-labelledby|aria-describedby)="[^"]*"/g, '$1=""');

  it('keeps its own classes, and renders as before without overrides', async () => {
    const plain = await render(undefined);
    const html = markup(plain);
    TestBed.resetTestingModule();
    const styled = await render({ parts: { root: { base: [added('root')] } } });
    const root = styled.querySelector<HTMLElement>('[data-novan-part="root"]');
    expect(root?.classList.contains(`novan-${apiId.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}-block`)).toBe(true);
    root?.classList.remove(added('root'));
    expect(markup(styled)).toBe(html);
  });
});
