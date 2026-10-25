import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type BlockOverrides, bootstrapAdapter } from '@novan/shared-design-system';
import axe from 'axe-core';
import { EditorClassIndex } from '../class-index';
import { ClassOverrides, partLabel } from './class-overrides';

@Component({
  imports: [ClassOverrides],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<nv-class-overrides
    [uid]="uid()"
    [overrides]="overrides()"
    [parts]="parts()"
    [readonly]="readonly()"
    (overridesChange)="changed($event)"
    (pointPart)="pointed.push($event)"
  />`,
})
class Host {
  readonly uid = signal('b1');
  readonly overrides = signal<BlockOverrides | undefined>(undefined);
  readonly parts = signal<readonly string[] | null>(['root', 'heading', 'action']);
  readonly readonly = signal(false);
  readonly changes: (BlockOverrides | undefined)[] = [];
  readonly pointed: (string | null)[] = [];
  changed(overrides: BlockOverrides | undefined): void {
    this.changes.push(overrides);
    this.overrides.set(overrides);
  }
}

describe('ClassOverrides', () => {
  function render(overrides?: BlockOverrides, parts: readonly string[] | null = ['root', 'heading', 'action']) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.overrides.set(overrides);
    fixture.componentInstance.parts.set(parts);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = () => el.querySelector<HTMLSelectElement>('select') as HTMLSelectElement;
    const options = () => [...select().options].map((option) => option.textContent?.trim());
    const choose = (part: string) => {
      select().value = part;
      select().dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    const add = (text: string) => {
      const box = el.querySelector<HTMLInputElement>('input[type="text"]') as HTMLInputElement;
      box.value = text;
      box.dispatchEvent(new Event('input'));
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
    };
    const click = (name: string) => {
      [...el.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)?.click();
      fixture.detectChanges();
    };
    return { fixture, el, select, options, choose, add, click, host: fixture.componentInstance };
  }

  it('names parts in words', () => {
    expect(partLabel('root')).toBe('Whole block');
    expect(partLabel('card-title')).toBe('Card title');
  });

  it('offers the parts the site reported, the whole block first, with how many classes each has', () => {
    const { options } = render({ parts: { heading: { base: ['display-4', 'mb-0'] } } });
    expect(options()).toEqual(['Whole block', 'Heading (2)', 'Action']);
  });

  it('offers the whole block, and parts with classes, before the site has said', () => {
    expect(render({ parts: { heading: { base: ['x'] } } }, null).options()).toEqual(['Whole block', 'Heading (1)']);
  });

  it('keeps parts the page no longer shows, so their classes can be cleared', () => {
    expect(render({ parts: { subtitle: { base: ['x'] } } }).options()).toEqual(['Whole block', 'Heading', 'Action', 'Subtitle (1), not on the page']);
  });

  it("adds classes to the chosen part's base, keeping the rest", () => {
    const { choose, add, host } = render({ v: '00000000-0000-4000-8000-000000000001', parts: { root: { base: ['mt-8'], md: ['px-8'] } }, tokens: { '--x': '1px' } });
    choose('action');
    add('btn-primary');
    expect(host.changes.at(-1)).toEqual({
      v: '00000000-0000-4000-8000-000000000001',
      parts: { root: { base: ['mt-8'], md: ['px-8'] }, action: { base: ['btn-primary'] } },
      tokens: { '--x': '1px' },
    });
  });

  it('clears one part, then everything, leaving no overrides behind', () => {
    const { choose, click, host } = render({ parts: { root: { base: ['mt-8'] }, heading: { base: ['h1'] } } });
    choose('heading');
    click('Clear classes on heading');
    expect(host.changes.at(-1)).toEqual({ parts: { root: { base: ['mt-8'] } } });
    click('Clear all classes');
    expect(host.changes.at(-1)).toBeUndefined();
  });

  it('asks the site to outline the part being chosen or edited', () => {
    const { select, choose, host } = render();
    select().dispatchEvent(new Event('focus'));
    choose('heading');
    select().dispatchEvent(new Event('blur'));
    expect(host.pointed).toEqual(['root', 'heading', null]);
  });

  it('goes back to the whole block when another block is selected', () => {
    const { choose, select, host, fixture } = render();
    choose('heading');
    host.uid.set('b2');
    fixture.detectChanges();
    expect(select().value).toBe('root');
  });

  it('only shows the classes to read-only editors', () => {
    const { host, fixture, el } = render({ parts: { root: { base: ['mt-8'] } } });
    host.readonly.set(true);
    fixture.detectChanges();
    expect(el.querySelector('input[type="text"]')).toBeNull();
    expect([...el.querySelectorAll('button')]).toEqual([]);
    expect(el.querySelector('.nv-class-chip__name')?.textContent?.trim()).toBe('mt-8');
  });

  describe('with the site’s design systems', () => {
    const index = {
      adapter: signal(bootstrapAdapter),
      label: signal<string | null>('Bootstrap 5.3.8'),
      suggest: vi.fn(async () => []),
      exists: vi.fn(async (name: string) => name !== 'made-up'),
    };

    function renderWithIndex(overrides?: BlockOverrides) {
      TestBed.configureTestingModule({ providers: [{ provide: EditorClassIndex, useValue: index }] });
      return render(overrides);
    }

    it('offers the breakpoints the design system can write, and writes to the one chosen', async () => {
      const { el, fixture, add, host } = renderWithIndex();
      const applies = el.querySelector<HTMLSelectElement>('#nv-classes-b1-bucket') as HTMLSelectElement;
      expect([...applies.options].map((option) => option.textContent?.trim())).toEqual([
        'All screen sizes',
        'Small screens and up',
        'Medium screens and up',
        'Large screens and up',
        'Extra-large screens and up',
      ]);
      applies.value = 'md';
      applies.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(el.querySelector('label[for="nv-classes-b1-md"]')?.textContent).toBe('Classes on Whole block, medium screens and up');
      add('px-4');
      expect(host.changes.at(-1)).toEqual({ parts: { root: { md: ['px-4'] } } });
    });

    it('says when a class does nothing at that size, or no design system has it', async () => {
      const { el, fixture } = renderWithIndex({ parts: { root: { base: ['made-up'], md: ['text-primary'] } } });
      await vi.waitFor(() => expect(index.exists).toHaveBeenCalledWith('made-up'));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.textContent).toContain('made-up: Not found in Bootstrap 5.3.8.');
      const applies = el.querySelector<HTMLSelectElement>('#nv-classes-b1-bucket') as HTMLSelectElement;
      applies.value = 'md';
      applies.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(el.textContent).toContain('text-primary: Bootstrap cannot apply this medium screens and up, so it does nothing here.');
    });

    it('still shows buckets that hold classes but the site cannot write', () => {
      const { el } = renderWithIndex({ parts: { root: { hover: ['shadow'] } } });
      const applies = el.querySelector<HTMLSelectElement>('#nv-classes-b1-bucket') as HTMLSelectElement;
      expect([...applies.options].map((option) => option.value)).toContain('hover');
    });
  });

  it.each([
    ['no classes', undefined],
    ['classes on several parts', { parts: { root: { base: ['mt-8'] }, heading: { base: ['display-4'] } } }],
  ])('has no axe violations with %s', async (_, overrides) => {
    const { el } = render(overrides);
    const results = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
