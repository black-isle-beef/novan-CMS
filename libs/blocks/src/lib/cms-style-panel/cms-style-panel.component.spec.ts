// cms-style-panel/cms-style-panel.component.spec.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { expectNoAxeViolations } from '../../testing/cms-testing';
import { defineCmsComponent } from '../cms-registry';
import type { CmsStoredSettings, CmsStyleSchema } from '../cms-schema';
import { CmsStylePanelComponent } from './cms-style-panel.component';

interface FakeSettings {
  tone: 'light' | 'brand';
  width: 'narrow' | 'wide' | 'full';
  bordered: boolean;
}

@Component({
  selector: 'novan-fake',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="fake" [attr.data-tone]="tone()">{{ text() }}</p>`,
})
class FakeBlock {
  static readonly novanBlock = { apiId: 'fake', schemaVersion: 1 };
  readonly text = input<string>('');
  readonly settings = input<CmsStoredSettings | null>(null);
  protected tone(): unknown {
    return this.settings()?.['tone'];
  }
}

const SCHEMA: CmsStyleSchema<FakeSettings> = {
  tone: {
    kind: 'radio',
    label: 'Tone',
    hint: 'Colour scheme for the block.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'brand', label: 'Brand' },
    ],
    default: 'light',
  },
  width: {
    kind: 'select',
    label: 'Width',
    options: [
      { value: 'narrow', label: 'Narrow' },
      { value: 'wide', label: 'Wide' },
      { value: 'full', label: 'Full width' },
    ],
    default: 'wide',
  },
  bordered: { kind: 'toggle', label: 'Show border', default: false },
};

const DEFINITION = defineCmsComponent<FakeSettings, { text: string }>({
  type: 'fake',
  name: 'Fake block',
  component: FakeBlock,
  fields: { text: 'text' },
  settingsSchema: SCHEMA,
  sampleContent: { text: 'Sample text' },
});

describe('CmsStylePanelComponent', () => {
  function render(settings: CmsStoredSettings | null = null) {
    TestBed.configureTestingModule({ imports: [CmsStylePanelComponent] });
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', DEFINITION);
    fixture.componentRef.setInput('settings', settings);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('renders one control per schema field, using the right control type', () => {
    const { element } = render();

    expect(element.querySelectorAll('input[type="radio"]').length).toBe(2);
    expect(element.querySelectorAll('select option').length).toBe(3);
    expect(element.querySelector('input[type="checkbox"][role="switch"]')).not.toBeNull();
  });

  it('reflects defaults when no settings are stored', () => {
    const { element } = render();

    expect(element.querySelector<HTMLInputElement>('input[value="light"]')?.checked).toBe(true);
    expect(element.querySelector<HTMLSelectElement>('select')?.value).toBe('wide');
    expect(element.querySelector<HTMLInputElement>('[role="switch"]')?.checked).toBe(false);
  });

  it('writes back complete, valid settings when a radio changes', () => {
    const { fixture, element } = render({ tone: 'neon', legacy: true });

    element.querySelector<HTMLInputElement>('input[value="brand"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.settings()).toEqual({ tone: 'brand', width: 'wide', bordered: false });
  });

  it('writes back select and toggle changes', () => {
    const { fixture, element } = render();

    const select = element.querySelector('select') as HTMLSelectElement;
    select.value = 'full';
    select.dispatchEvent(new Event('change'));
    element.querySelector<HTMLInputElement>('[role="switch"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.settings()).toEqual({ tone: 'light', width: 'full', bordered: true });
  });

  it('resets to defaults', () => {
    const { fixture, element } = render({ tone: 'brand', width: 'full', bordered: true });

    element.querySelector<HTMLButtonElement>('.novan-style-panel__reset')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.settings()).toEqual({ tone: 'light', width: 'wide', bordered: false });
  });

  it('passes resolved settings and the content to the live preview', () => {
    const { fixture, element } = render();

    element.querySelector<HTMLInputElement>('input[value="brand"]')?.click();
    fixture.detectChanges();
    const preview = element.querySelector('.fake');
    expect(preview?.textContent).toBe('Sample text');
    expect(preview?.getAttribute('data-tone')).toBe('brand');

    fixture.componentRef.setInput('content', { text: 'Edited text' });
    fixture.detectChanges();
    expect(element.querySelector('.fake')?.textContent).toBe('Edited text');
  });

  it('hides the preview when asked', () => {
    const { fixture, element } = render();

    fixture.componentRef.setInput('showPreview', false);
    fixture.detectChanges();
    expect(element.querySelector('.fake')).toBeNull();
  });

  it('gives every control an accessible name and links hints with aria-describedby', () => {
    const { element } = render();

    for (const control of Array.from(element.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) {
      expect(control.labels?.length, `${control.id} has no label`).toBeGreaterThan(0);
    }
    const hintId = element.querySelector('fieldset')?.getAttribute('aria-describedby');
    expect(hintId && element.querySelector(`#${hintId}`)?.textContent).toContain('Colour scheme');
  });

  it('uses ids that are unique across panel instances', () => {
    const first = render().element;
    const second = TestBed.createComponent(CmsStylePanelComponent);
    second.componentRef.setInput('definition', DEFINITION);
    second.detectChanges();

    const firstIds = Array.from(first.querySelectorAll('[id]')).map((node) => node.id);
    const secondIds = Array.from((second.nativeElement as HTMLElement).querySelectorAll('[id]')).map((node) => node.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
  });

  it('has no axe violations', async () => {
    await expectNoAxeViolations(render().element);
  });
});
