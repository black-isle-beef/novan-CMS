import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { defineBlocks, type NovanBlock, type NovanBlockType } from './blocks';
import { NovanBlocks } from './blocks.component';
import { NOVAN_CMS_CONFIG } from './config';
import { NovanPreview } from './preview';
import type { NovanBlockNode } from './types';

interface HeroFields {
  heading: string;
  subheading?: string;
}

@Component({
  selector: 'novan-test-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h2>{{ heading() }}</h2>
    @if (subheading()) {
      <p>{{ subheading() }}</p>
    }`,
})
class HeroBlock implements NovanBlock<HeroFields> {
  static readonly novanBlock = { apiId: 'hero', schemaVersion: 1 };
  readonly heading = input<string>();
  readonly subheading = input<string>();
}

/** Places its own children. */
@Component({
  selector: 'novan-test-section',
  imports: [NovanBlocks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section [attr.aria-label]="label()"><novan-blocks [blocks]="children()" /></section>`,
})
class SectionBlock {
  static readonly novanBlock = { apiId: 'section', schemaVersion: 1 };
  readonly label = input<string>();
  readonly children = input<NovanBlockNode[]>([]);
}

/** Takes its style options. */
@Component({
  selector: 'novan-test-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p [attr.data-settings]="json()">{{ text() }}</p>`,
})
class BannerBlock {
  static readonly novanBlock = { apiId: 'banner', schemaVersion: 1 };
  readonly text = input<string>();
  readonly settings = input<unknown>('unset');
  protected json(): string {
    return JSON.stringify(this.settings());
  }
}

/** Has no `children` input: its children follow it. */
@Component({
  selector: 'novan-test-divider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<hr />`,
})
class DividerBlock {
  static readonly novanBlock = { apiId: 'divider', schemaVersion: 2 };
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

function render(blocks: unknown[], { preview = false } = {}): HTMLElement {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: NOVAN_CMS_CONFIG,
        useValue: { blocks: defineBlocks({ hero: HeroBlock, section: SectionBlock, divider: DividerBlock, banner: BannerBlock }) },
      },
      { provide: NovanPreview, useValue: { active: signal(preview) } },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  // Content is checked at run time, so tests may pass malformed nodes.
  fixture.componentInstance.blocks.set(blocks as NovanBlockNode[]);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('NovanBlocks', () => {
  it('renders each block with its registered component and fields as inputs', () => {
    const el = render([
      { _uid: uid(1), _block: 'hero', heading: 'Welcome', subheading: 'To the site', unknownField: 'ignored' },
      { _uid: uid(2), _block: 'hero', heading: 'Second' },
    ]);

    const heroes = el.querySelectorAll('novan-test-hero');
    expect(heroes).toHaveLength(2);
    expect(heroes[0].querySelector('h2')?.textContent).toBe('Welcome');
    expect(heroes[0].querySelector('p')?.textContent).toBe('To the site');
    expect(heroes[1].querySelector('p')).toBeNull();
    expect(el.innerHTML).not.toContain('ignored');
  });

  it('gives a block with a settings input its style options, or null', () => {
    const el = render([
      { _uid: uid(1), _block: 'banner', text: 'Styled', _style: { tone: 'brand', rounded: true }, settings: 'a field' },
      { _uid: uid(2), _block: 'banner', text: 'Plain' },
      { _uid: uid(3), _block: 'banner', text: 'Malformed', _style: ['brand'] },
      { _uid: uid(4), _block: 'hero', heading: 'No settings input', _style: { tone: 'brand' } },
    ]);

    const settings = [...el.querySelectorAll('novan-test-banner p')].map((p) => p.getAttribute('data-settings'));
    expect(settings).toEqual(['{"tone":"brand","rounded":true}', 'null', 'null']);
    expect(el.querySelector('novan-test-hero h2')?.textContent).toBe('No settings input');
  });

  it('gives children to a block that takes them, recursively', () => {
    const el = render([
      {
        _uid: uid(1),
        _block: 'section',
        label: 'Outer',
        children: [
          { _uid: uid(2), _block: 'hero', heading: 'Inside' },
          { _uid: uid(3), _block: 'section', label: 'Inner', children: [{ _uid: uid(4), _block: 'hero', heading: 'Deepest' }] },
        ],
      },
    ]);

    const outer = el.querySelector('section[aria-label="Outer"]');
    expect(outer?.querySelector(':scope > novan-blocks > novan-test-hero h2')?.textContent).toBe('Inside');
    expect(outer?.querySelector('section[aria-label="Inner"] h2')?.textContent).toBe('Deepest');
  });

  it('renders the children of a block that does not take them after it', () => {
    const el = render([{ _uid: uid(1), _block: 'divider', children: [{ _uid: uid(2), _block: 'hero', heading: 'After' }] }]);

    const divider = el.querySelector('novan-test-divider');
    expect(divider?.querySelector('h2')).toBeNull();
    expect(divider?.nextElementSibling?.querySelector('h2')?.textContent).toBe('After');
  });

  it('shows nothing for an unknown block on the live site', () => {
    const el = render([
      { _uid: uid(1), _block: 'carousel', slides: [] },
      { _uid: uid(2), _block: 'hero', heading: 'Still here' },
    ]);

    expect(el.querySelector('[role="note"]')).toBeNull();
    expect(el.textContent).not.toContain('carousel');
    expect(el.querySelector('h2')?.textContent).toBe('Still here');
  });

  it('flags an unknown block in preview', () => {
    const el = render([{ _uid: uid(1), _block: 'carousel' }], { preview: true });

    const note = el.querySelector('.alert-warning[role="note"]');
    expect(note?.textContent).toContain('"carousel"');
  });

  it('wraps every block, children and unknown blocks included, for the visual editor in preview', () => {
    const tree = [
      { _uid: uid(1), _block: 'divider', children: [{ _uid: uid(2), _block: 'hero', heading: 'Inside' }] },
      { _uid: uid(3), _block: 'carousel' },
    ];
    const el = render(tree, { preview: true });
    const wrappers = [...el.querySelectorAll<HTMLElement>('[data-novan-uid]')];
    expect(wrappers.map((w) => [w.dataset['novanUid'], w.dataset['novanBlock']])).toEqual([
      [uid(1), 'divider'],
      [uid(2), 'hero'],
      [uid(3), 'carousel'],
    ]);
    // A child's wrapper is inside its parent's, so selecting the child does not select the parent.
    expect(wrappers[0].contains(wrappers[1])).toBe(true);
    expect(wrappers[2].querySelector('[role="note"]')).not.toBeNull();
  });

  it('adds no wrappers on the live site', () => {
    const el = render([{ _uid: uid(1), _block: 'hero', heading: 'Live' }]);
    expect(el.querySelector('[data-novan-uid]')).toBeNull();
  });

  it('skips malformed nodes and repeated ids', () => {
    const el = render([
      null,
      'hero',
      { _block: 'hero', heading: 'No id' },
      { _uid: uid(1), heading: 'No block' },
      { _uid: uid(2), _block: 'hero', heading: 'Once' },
      { _uid: uid(2), _block: 'hero', heading: 'Twice' },
    ]);

    expect([...el.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Once']);
  });

  it('renders nothing for a missing block list', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: NOVAN_CMS_CONFIG, useValue: { blocks: defineBlocks({}) } }],
    });
    const fixture = TestBed.createComponent(NovanBlocks);
    fixture.componentRef.setInput('blocks', null);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).children).toHaveLength(0);
  });
});

describe('defineBlocks', () => {
  it('maps block type api ids to components', () => {
    const registry = defineBlocks({ hero: HeroBlock, divider: DividerBlock });
    expect(registry.get('hero')).toBe(HeroBlock);
    expect([...registry.keys()]).toEqual(['hero', 'divider']);
  });

  it('refuses a component registered for another block', () => {
    expect(() => defineBlocks({ banner: HeroBlock })).toThrow(/"banner" is registered to _?HeroBlock, which renders "hero"/);
  });

  it('refuses a component without novanBlock', () => {
    @Component({ selector: 'novan-test-plain', template: '' })
    class Plain {}
    expect(() => defineBlocks({ plain: Plain as unknown as NovanBlockType })).toThrow(/needs "static readonly novanBlock/);
  });
});
