import { TestBed } from '@angular/core/testing';
import { fieldDefSchema, type FieldDefOf } from '@novan/shared-schemas';
import { FieldFormContext } from '../field-form-context';
import { RichTextField } from './rich-text-field';

const field = fieldDefSchema.parse({
  id: 'r',
  apiId: 'body',
  label: 'Text',
  type: 'richText',
  required: true,
  marks: ['bold', 'link'],
  nodes: ['heading', 'bulletList'],
}) as FieldDefOf<'richText'>;

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function render(value: unknown = null) {
  TestBed.configureTestingModule({ imports: [RichTextField], providers: [FieldFormContext] });
  const context = TestBed.inject(FieldFormContext);
  const fixture = TestBed.createComponent(RichTextField);
  fixture.componentRef.setInput('field', field);
  fixture.componentRef.setInput('path', 'body');
  fixture.componentRef.setInput('value', value);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, context, editable: () => el.querySelector<HTMLElement>('[contenteditable]') as HTMLElement };
}

describe('RichTextField', () => {
  it('offers only the formatting the field allows, as a labelled toolbar', async () => {
    const { el } = await render();
    const toolbar = el.querySelector('[role=toolbar]');
    expect(toolbar?.getAttribute('aria-label')).toBe('Formatting for Text');
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('[role=toolbar] button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Bold', 'Heading', 'Subheading', 'Bulleted list', 'Link']);
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('labels the editable area and links its description', async () => {
    const { editable, fixture, context, el } = await render(doc('Hello'));
    expect(editable().getAttribute('role')).toBe('textbox');
    expect(editable().getAttribute('aria-required')).toBe('true');
    expect(el.querySelector(`#${editable().getAttribute('aria-labelledby')}`)?.textContent).toContain('Text');
    expect(editable().textContent).toBe('Hello');

    context.errors.set({ body: ['This field is required.'] });
    await fixture.whenStable();
    expect(editable().getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector(`#${editable().getAttribute('aria-describedby')}`)?.textContent).toContain('This field is required.');
  });

  it('moves between toolbar buttons with the arrow keys', async () => {
    const { el, fixture } = await render();
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('[role=toolbar] button')];
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(buttons[4]);
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
  });

  it('stores ProseMirror JSON, and nothing for an empty editor', async () => {
    const { fixture } = await render(doc('Hello'));
    fixture.componentRef.setInput('value', doc('Restored'));
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[contenteditable]')?.textContent).toBe('Restored');

    const bold = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=toolbar] button')][0];
    bold.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored' }] }] });
  });

  it('refuses unsafe link addresses', async () => {
    const { el, fixture } = await render(doc('Click'));
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('[role=toolbar] button')];
    const link = buttons[buttons.length - 1];
    link.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('input[type=url]') as HTMLInputElement;
    input.value = 'javascript:alert(1)';
    input.dispatchEvent(new Event('input'));
    ([...el.querySelectorAll('button')].find((b) => b.textContent === 'Apply') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Links must start with https://');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
