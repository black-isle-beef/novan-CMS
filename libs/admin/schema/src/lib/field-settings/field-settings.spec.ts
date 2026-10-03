import { TestBed } from '@angular/core/testing';
import { type FieldDef, type FieldDefInput, fieldDefSchema } from '@novan/shared-schemas';
import { FieldSettings } from './field-settings';

const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

function render(input: FieldDefInput, options = { blockTypes: [{ apiId: 'hero', name: 'Hero' }, { apiId: 'cta', name: 'CTA' }], contentTypes: [] }) {
  TestBed.configureTestingModule({ imports: [FieldSettings] });
  const fixture = TestBed.createComponent(FieldSettings);
  fixture.componentRef.setInput('field', fieldDefSchema.parse(input));
  fixture.componentRef.setInput('options', options);
  const changes: FieldDef[] = [];
  fixture.componentInstance.fieldChange.subscribe((field) => changes.push(field));
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const byLabel = <T extends HTMLElement>(text: string) =>
    [...el.querySelectorAll<HTMLLabelElement>('label')].find((label) => label.textContent?.trim().startsWith(text))
      ?.control as T;
  return { el, changes, byLabel };
}

describe('FieldSettings', () => {
  it('labels every control', () => {
    const { el } = render({ id: 'a', apiId: 'title', label: 'Title', type: 'text' });

    for (const control of el.querySelectorAll<HTMLInputElement>('input, select, textarea')) {
      expect(control.labels?.length, `${control.id} has no label`).toBeGreaterThan(0);
    }
  });

  it('removes an optional setting when it is emptied', () => {
    const { changes, byLabel } = render({ id: 'a', apiId: 'title', label: 'Title', type: 'text', max: 10 });
    const max = byLabel<HTMLInputElement>('Maximum length');
    max.value = '';
    max.dispatchEvent(new Event('change'));

    expect(last(changes)).not.toHaveProperty('max');
  });

  it('parses select options from "value | Label" lines', () => {
    const { changes, byLabel } = render({ id: 'a', apiId: 'colour', label: 'Colour', type: 'select', options: [{ value: 'red', label: 'Red' }] });
    const options = byLabel<HTMLTextAreaElement>('Options');

    expect(options.value).toBe('red | Red');
    options.value = 'red | Red\nnavy | Navy blue\n\ngreen';
    options.dispatchEvent(new Event('change'));

    expect(last(changes)).toMatchObject({
      options: [
        { value: 'red', label: 'Red' },
        { value: 'navy', label: 'Navy blue' },
        { value: 'green', label: 'green' },
      ],
    });
  });

  it('ticks allowed blocks in the order of the options', () => {
    const { changes, byLabel } = render({ id: 'a', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['cta'] });
    byLabel<HTMLInputElement>('Hero').click();

    expect(last(changes)).toMatchObject({ allowedBlocks: ['hero', 'cta'] });
  });

  it('nests a field list for a group', () => {
    const { el } = render({
      id: 'g',
      apiId: 'seo',
      label: 'SEO',
      type: 'group',
      fields: [{ id: 't', apiId: 'metaTitle', label: 'Search title', type: 'text' }],
    });

    expect(el.querySelector('nv-field-list h4')?.textContent).toContain('Fields in this group');
    expect(el.querySelector('nv-field-list ol')?.textContent).toContain('Search title');
  });
});
