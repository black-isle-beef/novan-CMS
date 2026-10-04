import { TestBed } from '@angular/core/testing';
import type { FocalPoint } from '@novan/shared-schemas';
import { FocalPointPicker } from './focal-point-picker';

async function render(value: FocalPoint | null) {
  TestBed.configureTestingModule({ imports: [FocalPointPicker] });
  const fixture = TestBed.createComponent(FocalPointPicker);
  fixture.componentRef.setInput('src', 'https://img/door.jpg');
  fixture.componentRef.setInput('value', value);
  const changed = vi.fn();
  fixture.componentInstance.changed.subscribe(changed);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const slider = (label: string) => {
    const id = [...el.querySelectorAll('label')].find((l) => l.textContent?.trim() === label)?.htmlFor;
    return el.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  };
  return { fixture, el, changed, slider };
}

describe('FocalPointPicker', () => {
  it('can be set from the keyboard with two labelled sliders', async () => {
    const { el, changed, slider } = await render({ x: 0.25, y: 0.75 });
    expect(slider('From the left').value).toBe('25');
    expect(slider('From the top').getAttribute('aria-valuetext')).toBe('75%');
    expect(el.textContent).toContain('25% from the left, 75% from the top.');

    slider('From the left').value = '60';
    slider('From the left').dispatchEvent(new Event('change'));
    expect(changed).toHaveBeenCalledWith({ x: 0.6, y: 0.75 });
  });

  it('is set by clicking the image, or with the arrow keys on it', async () => {
    const { el, changed } = await render(null);
    const frame = el.querySelector('button.nv-focal-frame') as HTMLButtonElement;
    expect(frame.querySelector('img')?.getAttribute('alt')).toBe('Set the focal point');
    frame.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 100 }) as DOMRect;
    frame.dispatchEvent(new MouseEvent('click', { clientX: 150, clientY: 125, detail: 1 }));
    expect(changed).toHaveBeenLastCalledWith({ x: 0.25, y: 0.75 });

    // Enter or Space on the button says nothing about where.
    changed.mockClear();
    frame.dispatchEvent(new MouseEvent('click', { detail: 0 }));
    expect(changed).not.toHaveBeenCalled();

    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(changed).toHaveBeenLastCalledWith({ x: 0.55, y: 0.5 });
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(changed).toHaveBeenLastCalledWith({ x: 0.5, y: 0.45 });
  });

  it('starts at the centre and can go back to it', async () => {
    const { fixture, el, changed } = await render(null);
    expect(el.textContent).toContain('Not set: crops keep the centre.');
    fixture.componentRef.setInput('value', { x: 0.1, y: 0.1 });
    await fixture.whenStable();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Back to the centre'))?.click();
    expect(changed).toHaveBeenCalledWith(null);
  });
});
