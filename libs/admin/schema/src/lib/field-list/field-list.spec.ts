import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type FieldDef, fieldListSchema } from '@novan/shared-schemas';
import { FieldList } from './field-list';

@Component({
  imports: [FieldList],
  template: `<nv-field-list [(fields)]="fields" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly fields = signal<FieldDef[]>(
    fieldListSchema.parse([
      { id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true },
      { id: 'summary', apiId: 'summary', label: 'Summary', type: 'text' },
      { id: 'body', apiId: 'body', label: 'Body', type: 'blocks' },
    ]),
  );
  readonly list = viewChild.required(FieldList);
}

describe('FieldList', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  const rows = () => [...el.querySelectorAll('ol > li')].map((li) => li.querySelector('.fw-semibold')?.textContent);
  const button = (name: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name) as HTMLButtonElement;
  const status = () => el.querySelector('[role=status]')?.textContent;
  /** A palette button, by the field type name it shows. */
  const palette = (label: string) =>
    [...el.querySelectorAll('button')].find((b) => b.querySelector('.fw-semibold')?.textContent === label) as HTMLButtonElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  it('lists the fields in order with their type and required badges', () => {
    expect(rows()).toEqual(['Title', 'Summary', 'Body']);
    expect(el.querySelector('ol > li')?.textContent).toContain('Required');
    expect(el.querySelector('ol')?.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('moves a field with the arrow buttons, announces it and keeps focus on the button', async () => {
    button('Move Summary up').click();
    await fixture.whenStable();

    expect(rows()).toEqual(['Summary', 'Title', 'Body']);
    expect(fixture.componentInstance.fields().map((f) => f.apiId)).toEqual(['summary', 'title', 'body']);
    expect(status()).toBe('Summary moved to position 1 of 3.');
    // At the top the up button is disabled, so focus moves to the down button.
    expect(button('Move Summary up').disabled).toBe(true);
    expect(document.activeElement).toBe(button('Move Summary down'));
  });

  it('reorders on drop', async () => {
    const list = fixture.componentInstance.list() as unknown as { drop(event: Partial<CdkDragDrop<FieldDef[]>>): void };
    list.drop({ previousIndex: 0, currentIndex: 2 });
    await fixture.whenStable();

    expect(rows()).toEqual(['Summary', 'Body', 'Title']);
    expect(status()).toBe('Title moved to position 3 of 3.');
  });

  it('adds a field from the palette and opens its settings', async () => {
    palette('Number').click();
    await fixture.whenStable();

    expect(rows()).toEqual(['Title', 'Summary', 'Body', 'Number']);
    expect(status()).toBe('Added a number field. Its settings are open.');
    const heading = el.querySelector<HTMLElement>('nv-field-settings h3');
    expect(heading?.textContent).toContain('Number');
    expect(document.activeElement).toBe(heading);
  });

  it('keeps a new field\'s API id in step with its label, but not an existing field\'s', async () => {
    palette('Text').click();
    await fixture.whenStable();
    const label = el.querySelector<HTMLInputElement>('nv-field-settings input[type=text]')!;
    label.value = 'Summary';
    label.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    // "summary" is taken, so the new field gets the next free API id.
    expect(fixture.componentInstance.fields()[3]).toMatchObject({ label: 'Summary', apiId: 'summary2' });

    button('Edit Title').click();
    await fixture.whenStable();
    const titleLabel = el.querySelector<HTMLInputElement>('nv-field-settings input[type=text]')!;
    titleLabel.value = 'Headline';
    titleLabel.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.fields()[0]).toMatchObject({ label: 'Headline', apiId: 'title' });
  });

  it('toggles the settings panel with Edit and returns focus to Edit on Done', async () => {
    const edit = button('Edit Summary');
    edit.click();
    await fixture.whenStable();

    expect(edit.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[aria-label="Settings for Summary"]')).not.toBeNull();

    button('Done with Summary').click();
    await fixture.whenStable();

    expect(edit.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(edit);
  });

  it('removes a field and announces it', async () => {
    button('Remove Summary').click();
    await fixture.whenStable();

    expect(rows()).toEqual(['Title', 'Body']);
    expect(status()).toBe('Removed Summary.');
    expect(document.activeElement).toBe(button('Edit Body'));
  });

  it('edits type-specific settings', async () => {
    button('Edit Body').click();
    await fixture.whenStable();
    const max = el.querySelector<HTMLInputElement>('nv-field-settings input[type=number][min="1"]')!;
    max.value = '5';
    max.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    const required = [...el.querySelectorAll<HTMLInputElement>('nv-field-settings input[type=checkbox]')].find(
      (input) => input.labels?.[0]?.textContent === 'Required',
    )!;
    required.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.fields()[2]).toMatchObject({ type: 'blocks', max: 5, required: true });
  });
});
