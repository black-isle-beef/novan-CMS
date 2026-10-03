import { TestBed } from '@angular/core/testing';
import { type FieldDef, type FieldDefInput, fieldListSchema } from '@novan/shared-schemas';
import { FieldFormContext } from '../field-form-context';
import { FieldForm } from './field-form';

const defs = (...fields: FieldDefInput[]): FieldDef[] => fieldListSchema.parse(fields);

async function render(fields: FieldDef[], value: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ imports: [FieldForm], providers: [FieldFormContext] });
  const context = TestBed.inject(FieldFormContext);
  const fixture = TestBed.createComponent(FieldForm);
  fixture.componentRef.setInput('fields', fields);
  fixture.componentRef.setInput('value', value);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const input = (label: string) => {
    const id = [...el.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label))?.htmlFor;
    return el.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  };
  const type = async (label: string, text: string) => {
    const control = input(label);
    control.value = text;
    control.dispatchEvent(new Event('input'));
    control.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  return { fixture, el, context, input, type, value: () => fixture.componentInstance.value() };
}

describe('FieldForm', () => {
  it('renders a labelled control for each visible field and keeps other keys', async () => {
    const { el, input, type, value } = await render(
      defs(
        { id: 't', apiId: 'title', label: 'Title', type: 'text', required: true, max: 80 },
        { id: 's', apiId: 'summary', label: 'Summary', type: 'text', multiline: true },
        { id: 'h', apiId: 'secret', label: 'Secret', type: 'text', hidden: true },
      ),
      { title: 'Hello', _uid: 'kept' },
    );

    expect(input('Title').value).toBe('Hello');
    expect(input('Title').getAttribute('aria-required')).toBe('true');
    expect(el.querySelector('label')?.textContent).toContain('(required)');
    expect(input('Summary').tagName).toBe('TEXTAREA');
    expect(el.textContent).not.toContain('Secret');
    // The rule is part of the control's description.
    const help = el.querySelector(`#${input('Title').getAttribute('aria-describedby')}`);
    expect(help?.textContent?.trim()).toBe('Up to 80 characters.');

    await type('Title', 'Changed');
    expect(value()).toEqual({ title: 'Changed', _uid: 'kept' });
  });

  it('shows errors from the context on the matching control', async () => {
    const { fixture, context, input, el } = await render(defs({ id: 't', apiId: 'title', label: 'Title', type: 'text' }));
    context.errors.set({ title: ['This field is required.'] });
    await fixture.whenStable();

    const control = input('Title');
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(control.classList).toContain('is-invalid');
    const error = el.querySelector(`#${control.getAttribute('aria-describedby')}`);
    expect(error?.textContent?.trim()).toBe('Error: This field is required.');
  });

  it('disables every control when read-only', async () => {
    const { fixture, context, input } = await render(defs({ id: 't', apiId: 'title', label: 'Title', type: 'text' }));
    context.readonly.set(true);
    await fixture.whenStable();
    expect(input('Title').disabled).toBe(true);
  });

  it('stores numbers, dates and choices in the form the schema expects', async () => {
    const { type, value, el, input } = await render(
      defs(
        { id: 'n', apiId: 'count', label: 'Count', type: 'number', integer: true },
        { id: 'd', apiId: 'day', label: 'Day', type: 'date' },
        { id: 'w', apiId: 'when', label: 'When', type: 'date', withTime: true },
        { id: 'c', apiId: 'colour', label: 'Colour', type: 'select', options: [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }] },
        {
          id: 'm',
          apiId: 'colours',
          label: 'Colours',
          type: 'select',
          multiple: true,
          options: [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }],
        },
        { id: 'b', apiId: 'flag', label: 'Flag', type: 'boolean', default: true },
      ),
    );

    await type('Count', '3');
    await type('Day', '2026-10-03');
    await type('When', '2026-10-03T09:30');
    await type('Colour', 'blue');
    expect(input('Flag').checked).toBe(true);

    const boxes = el.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]');
    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change'));
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));

    expect(value()).toMatchObject({
      count: 3,
      day: '2026-10-03',
      when: new Date('2026-10-03T09:30').toISOString(),
      colour: 'blue',
      colours: ['red', 'blue'],
    });

    await type('Count', '');
    expect(value()['count']).toBeNull();
  });

  it('nests groups, and repeats them', async () => {
    const { fixture, el, type, value } = await render(
      defs(
        { id: 'seo', apiId: 'seo', label: 'SEO', type: 'group', fields: [{ id: 'mt', apiId: 'metaTitle', label: 'Search title', type: 'text' }] },
        {
          id: 'f',
          apiId: 'features',
          label: 'Features',
          type: 'group',
          multiple: true,
          fields: [{ id: 'ft', apiId: 'title', label: 'Feature title', type: 'text' }],
        },
      ),
    );

    await type('Search title', 'Find me');
    const add = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Add an item')) as HTMLButtonElement;
    add.click();
    await fixture.whenStable();
    await type('Feature title', 'Fast');

    expect(value()).toEqual({ seo: { metaTitle: 'Find me' }, features: [{ title: 'Fast' }] });
    expect(el.querySelector('[role=status]')?.textContent).toBe('Added item 1.');
  });

  it('builds links of the allowed kinds and keeps the text when switching', async () => {
    const { fixture, context, type, value, input } = await render(
      defs({ id: 'l', apiId: 'cta', label: 'Button', type: 'link', allowEmail: true }),
    );
    context.entries.set([{ id: '00000000-0000-4000-8000-000000000001', title: 'About', contentType: 'page', path: '/about' }]);
    await fixture.whenStable();

    const kinds = [...input('Link to').querySelectorAll('option')].map((o) => o.textContent);
    expect(kinds).toEqual(['No link', 'A page on this site', 'A web address', 'An email address']);

    await type('Link to', 'external');
    await type('Web address', 'https://example.com');
    await type('Link text', 'Visit');
    expect(value()).toEqual({ cta: { type: 'external', url: 'https://example.com', text: 'Visit' } });

    await type('Link to', 'internal');
    await type('Page', '00000000-0000-4000-8000-000000000001');
    expect(value()).toEqual({ cta: { type: 'internal', text: 'Visit', entryId: '00000000-0000-4000-8000-000000000001' } });
  });

  it('offers only entries of the allowed content types for references', async () => {
    const { fixture, context, input } = await render(
      defs({ id: 'r', apiId: 'author', label: 'Author', type: 'reference', contentTypes: ['person'] }),
    );
    context.entries.set([
      { id: '00000000-0000-4000-8000-000000000001', title: 'Jo', contentType: 'person', path: '/jo' },
      { id: '00000000-0000-4000-8000-000000000002', title: 'Home', contentType: 'page', path: '/home' },
    ]);
    await fixture.whenStable();
    expect([...input('Author').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['None', 'Jo (/jo)']);
  });

  it('keeps JSON that does not parse yet in the box, without storing it', async () => {
    const { type, value, el } = await render(defs({ id: 'j', apiId: 'extra', label: 'Extra', type: 'json' }), { extra: { a: 1 } });
    await type('Extra', '{"a": ');
    expect(value()).toEqual({ extra: { a: 1 } });
    expect(el.textContent).toContain('This is not valid JSON yet');
    await type('Extra', '{"a": 2}');
    expect(value()).toEqual({ extra: { a: 2 } });
  });

  it('stores a media item with its alternative text, and nothing when emptied', async () => {
    const { type, value } = await render(defs({ id: 'i', apiId: 'image', label: 'Image', type: 'media', requireAlt: true }));
    await type('Asset id', '00000000-0000-4000-8000-000000000009');
    await type('Alternative text', 'A cat');
    expect(value()).toEqual({ image: { assetId: '00000000-0000-4000-8000-000000000009', alt: 'A cat' } });
    await type('Asset id', '');
    await type('Alternative text', '');
    expect(value()).toEqual({ image: null });
  });
});
