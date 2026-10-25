import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import axe from 'axe-core';
import { ClassChips } from './class-chips';

@Component({
  imports: [ClassChips],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<nv-class-chips label="Classes on heading" inputId="chips" [classes]="classes()" [disabled]="disabled()" (classesChange)="changed($event)" />`,
})
class Host {
  readonly classes = signal<string[]>([]);
  readonly disabled = signal(false);
  readonly changes: string[][] = [];
  changed(classes: string[]): void {
    this.changes.push(classes);
    this.classes.set(classes);
  }
}

describe('ClassChips', () => {
  function render(classes: string[] = [], disabled = false) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.classes.set(classes);
    fixture.componentInstance.disabled.set(disabled);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const box = () => el.querySelector<HTMLInputElement>('#chips');
    const type = (text: string, key = 'Enter') => {
      const input = box() as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      fixture.detectChanges();
    };
    const chips = () => [...el.querySelectorAll('.nv-class-chip__name')].map((chip) => chip.textContent?.trim());
    const status = () => el.querySelector('[role="status"]')?.textContent?.trim();
    return { fixture, el, box, type, chips, status, host: fixture.componentInstance };
  }

  it('adds the classes typed, several at once, and says so', () => {
    const { type, chips, status, box } = render(['mt-8']);
    type('px-4  md:px-8 mt-8');
    expect(chips()).toEqual(['mt-8', 'px-4', 'md:px-8']);
    expect(status()).toBe('Added px-4, md:px-8.');
    expect(box()?.value).toBe('');
  });

  it('says when a class is already there, and changes nothing', () => {
    const { type, host, status } = render(['mt-8']);
    type('mt-8');
    expect(host.changes).toEqual([]);
    expect(status()).toBe('mt-8 is already added.');
  });

  it('refuses anything that is not a class name, keeping the text to fix', () => {
    const { type, el, host, box } = render();
    type('ok "><script>');
    expect(host.changes).toEqual([]);
    expect(box()?.value).toBe('ok "><script>');
    expect(box()?.getAttribute('aria-invalid')).toBe('true');
    expect(box()?.getAttribute('aria-describedby')).toBe('chips-hint chips-error');
    expect(el.querySelector('#chips-error')?.textContent).toContain('is not a class name');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('is not a class name');
  });

  it('says why it takes no more classes once full', () => {
    const { el, box } = render(Array.from({ length: 50 }, (_, n) => `c${n}`));
    expect(box()?.disabled).toBe(true);
    expect(el.querySelector('#chips-hint')?.textContent).toContain('as many classes as it can take');
  });

  it('removes a class with its button, keeping focus in the text box', () => {
    const { el, fixture, chips, status, box } = render(['mt-8', 'px-4']);
    el.querySelector<HTMLButtonElement>('.nv-class-chip__remove')?.click();
    fixture.detectChanges();
    expect(chips()).toEqual(['px-4']);
    expect(status()).toBe('Removed mt-8.');
    expect(document.activeElement).toBe(box());
  });

  it('removes the last class with Backspace in an empty text box', () => {
    const { type, chips } = render(['mt-8', 'px-4']);
    type('', 'Backspace');
    expect(chips()).toEqual(['mt-8']);
  });

  it('names each remove button after its class', () => {
    const { el } = render(['mt-8']);
    expect(el.querySelector('.nv-class-chip__remove')?.textContent?.trim()).toBe('Remove mt-8');
    expect(el.querySelector('ul')?.getAttribute('aria-label')).toBe('Classes on heading');
  });

  it('only lists the classes when it cannot change them', () => {
    const { el, chips } = render(['mt-8'], true);
    expect(chips()).toEqual(['mt-8']);
    expect(el.querySelector('input, button')).toBeNull();
    expect(el.querySelector('label')).toBeNull();
  });

  it.each([
    ['empty', [], false],
    ['with classes', ['mt-8', 'md:px-8'], false],
    ['read-only', ['mt-8'], true],
  ] as const)('has no axe violations, %s', async (_, classes, disabled) => {
    const { el } = render([...classes], disabled);
    const results = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no axe violations while showing a problem', async () => {
    const { el, type } = render();
    type('"x');
    const results = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
