import { TestBed } from '@angular/core/testing';
import { Confirm } from './confirm';
import { ConfirmHost } from './confirm-host';

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

async function render() {
  const fixture = TestBed.createComponent(ConfirmHost);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;
  return { fixture, el, button, confirm: TestBed.inject(Confirm) };
}

describe('Confirm', () => {
  it('asks in a named dialog and resolves true for the confirming button', async () => {
    const { fixture, el, button, confirm } = await render();
    const answer = confirm.ask({ heading: 'Unpublish About?', body: 'It comes off the site.', confirmLabel: 'Unpublish', destructive: true });
    await fixture.whenStable();

    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(el.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent).toContain('Unpublish About?');
    expect(dialog.textContent).toContain('It comes off the site.');
    expect(button('Unpublish')?.className).toContain('danger');

    button('Unpublish')?.click();
    await expect(answer).resolves.toBe(true);
    await fixture.whenStable();
    expect(dialog.open).toBe(false);
  });

  it('resolves false for Cancel, and for a question replaced by another', async () => {
    const { fixture, button, confirm } = await render();
    const first = confirm.ask({ heading: 'First?', body: '', confirmLabel: 'Yes' });
    const second = confirm.ask({ heading: 'Second?', body: '', confirmLabel: 'Yes', cancelLabel: 'Keep it' });
    await expect(first).resolves.toBe(false);
    await fixture.whenStable();

    button('Keep it')?.click();
    await expect(second).resolves.toBe(false);
    expect(confirm.request()).toBeNull();
  });

  it('resolves false when the dialog is closed with Escape or its close button', async () => {
    const { fixture, el, confirm } = await render();
    const answer = confirm.ask({ heading: 'Leave?', body: '', confirmLabel: 'Leave' });
    await fixture.whenStable();

    (el.querySelector('dialog') as HTMLDialogElement).close();
    await expect(answer).resolves.toBe(false);
  });
});
