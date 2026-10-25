import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { defineBlocks } from './blocks';
import { NovanBlocks } from './blocks.component';
import { NOVAN_CMS_CONFIG } from './config';
import { createTemplateAdapter, type ClassAdapter } from './overrides';
import { NOVAN_CLASS_ADAPTER, NovanBlockRoot, NovanPart } from './parts';
import { NovanPreview } from './preview';
import type { NovanBlockNode } from './types';

let created = 0;

/** A block with its own class bindings on the host and on a part, as Novan blocks have. */
@Component({
  selector: 'novan-test-card',
  imports: [NovanPart, NovanBlocks],
  hostDirectives: [NovanBlockRoot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-novan-part': 'root', '[class]': 'hostClasses()' },
  template: `
    <h3 class="card__title" data-novan-part="title">{{ title() }}</h3>
    <a data-novan-part="cta" [class]="ctaClasses()">Go</a>
    <novan-blocks [blocks]="children()" />
  `,
})
class CardBlock {
  static readonly novanBlock = { apiId: 'card', schemaVersion: 1 };
  readonly title = input<string>();
  readonly tone = input<string>('light');
  readonly children = input<NovanBlockNode[]>([]);
  protected readonly hostClasses = computed(() => `card card--${this.tone()}`);
  protected readonly ctaClasses = computed(() => `btn btn-${this.tone()}`);
  constructor() {
    created++;
  }
}

@Component({
  imports: [NovanBlocks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<novan-blocks [blocks]="blocks()" />`,
})
class Host {
  readonly blocks = signal<NovanBlockNode[]>([]);
}

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function render(blocks: unknown[], adapter?: ClassAdapter) {
  TestBed.configureTestingModule({
    providers: [
      { provide: NOVAN_CMS_CONFIG, useValue: { blocks: defineBlocks({ card: CardBlock }) } },
      { provide: NovanPreview, useValue: { active: signal(false) } },
      ...(adapter ? [{ provide: NOVAN_CLASS_ADAPTER, useValue: () => adapter }] : []),
    ],
  });
  const fixture = TestBed.createComponent(Host);
  // Content is checked at run time, so tests may pass malformed nodes.
  fixture.componentInstance.blocks.set(blocks as NovanBlockNode[]);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const card = (index = 0) => el.querySelectorAll<HTMLElement>('novan-test-card')[index];
  const classes = (element: Element | null | undefined) => [...(element?.classList ?? [])].sort();
  const update = (next: unknown[]) => {
    fixture.componentInstance.blocks.set(next as NovanBlockNode[]);
    fixture.detectChanges();
  };
  return { el, card, classes, update };
}

const card = (overrides?: unknown, extra: object = {}) => ({ _uid: uid(1), _block: 'card', title: 'Hi', _overrides: overrides, ...extra });

describe('block parts', () => {
  beforeEach(() => (created = 0));

  it('leaves a block without overrides exactly as it was', () => {
    const { card: first, classes } = render([card()]);
    expect(classes(first())).toEqual(['card', 'card--light']);
    expect(classes(first().querySelector('h3'))).toEqual(['card__title']);
    expect(classes(first().querySelector('a'))).toEqual(['btn', 'btn-light']);
    expect(first().getAttribute('style')).toBeNull();
  });

  it("adds each part's classes to the block's own, on the host and inside", () => {
    const { card: first, classes } = render([
      card(
        { parts: { root: { base: ['mt-8', 'px-4'] }, title: { base: ['display-6'] }, cta: { base: ['btn-primary'] } } },
        { tone: 'dark' },
      ),
    ]);
    expect(classes(first())).toEqual(['card', 'card--dark', 'mt-8', 'px-4']);
    expect(classes(first().querySelector('h3'))).toEqual(['card__title', 'display-6']);
    expect(classes(first().querySelector('a'))).toEqual(['btn', 'btn-dark', 'btn-primary']);
  });

  it('follows edits without re-creating the block, and removes classes taken away', () => {
    const { card: first, classes, update } = render([card({ parts: { root: { base: ['mt-8'] }, cta: { base: ['btn-primary'] } } })]);
    update([card({ parts: { root: { base: ['mt-4'] } } }, { tone: 'dark' })]);
    expect(classes(first())).toEqual(['card', 'card--dark', 'mt-4']);
    expect(classes(first().querySelector('a'))).toEqual(['btn', 'btn-dark']);
    update([card(undefined, { tone: 'dark' })]);
    expect(classes(first())).toEqual(['card', 'card--dark']);
    expect(classes(first().querySelector('a'))).toEqual(['btn', 'btn-dark']);
    expect(created).toBe(1);
  });

  it('keeps the base bucket only for plain CSS, and writes breakpoints with the site adapter', () => {
    const overrides = { parts: { root: { base: ['px-4'], md: ['px-8'], hover: ['shadow'] } } };
    expect(render([card(overrides)]).classes(document.querySelector('novan-test-card'))).toEqual(['card', 'card--light', 'px-4']);
    TestBed.resetTestingModule();
    const tailwind = createTemplateAdapter('tailwind', { breakpoints: { md: 'md:{class}' }, states: { hover: 'hover:{class}' } });
    const { card: first, classes } = render([card(overrides)], tailwind);
    expect(classes(first())).toEqual(['card', 'card--light', 'hover:shadow', 'md:px-8', 'px-4']);
  });

  it('sets safe token overrides as custom properties on the block', () => {
    const { card: first, update } = render([card({ tokens: { '--color-primary': '#c9a227', '--x': 'url(https://evil)', color: 'red' } })]);
    expect(first().style.getPropertyValue('--color-primary')).toBe('#c9a227');
    expect(first().style.getPropertyValue('--x')).toBe('');
    expect(first().style.getPropertyValue('color')).toBe('');
    update([card({ tokens: { '--space': '2rem' } })]);
    expect(first().style.getPropertyValue('--color-primary')).toBe('');
    expect(first().style.getPropertyValue('--space')).toBe('2rem');
  });

  it('ignores malformed overrides', () => {
    const { el, classes } = render([
      card('mt-8'),
      card({ parts: { root: { base: 'mt-8' } } }, { _uid: uid(2) }),
      card({ parts: { root: { base: ['x"><b>', 'a b', 'ok'] } } }, { _uid: uid(3) }),
    ]);
    expect([...el.querySelectorAll('novan-test-card')].map((element) => classes(element))).toEqual([
      ['card', 'card--light'],
      ['card', 'card--light'],
      ['card', 'card--light', 'ok'],
    ]);
  });

  it("gives a block inside a block only its own overrides", () => {
    const { card: outer, classes } = render([
      card({ parts: { root: { base: ['outer'] }, title: { base: ['outer-title'] } } }, {
        children: [{ _uid: uid(2), _block: 'card', title: 'Inner', _overrides: { parts: { title: { base: ['inner-title'] } } } }],
      }),
    ]);
    const inner = outer().querySelector('novan-test-card');
    expect(classes(outer().querySelector(':scope > h3'))).toEqual(['card__title', 'outer-title']);
    expect(classes(inner)).toEqual(['card', 'card--light']);
    expect(classes(inner?.querySelector('h3'))).toEqual(['card__title', 'inner-title']);
  });

  it('does nothing outside <novan-blocks>', () => {
    TestBed.configureTestingModule({ providers: [{ provide: NovanPreview, useValue: { active: signal(false) } }, { provide: NOVAN_CMS_CONFIG, useValue: { blocks: defineBlocks({}) } }] });
    const fixture = TestBed.createComponent(CardBlock);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect([...host.classList].sort()).toEqual(['card', 'card--light']);
    expect(host.getAttribute('data-novan-part')).toBe('root');
  });
});
