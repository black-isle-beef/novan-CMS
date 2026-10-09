import { TestBed } from '@angular/core/testing';
import { type FieldDef, type FieldDefInput, fieldListSchema } from '@novan/shared-schemas';
import { FieldFormContext, type MediaPreview, type MediaSource } from '../field-form-context';
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
    // The rule, and the count of characters so far, are part of the control's description.
    const described = (input('Title').getAttribute('aria-describedby') ?? '').split(' ').map((id) => el.querySelector(`#${id}`)?.textContent?.trim());
    expect(described).toEqual(['Up to 80 characters.', '5 of 80 characters']);

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

  it('without a media library, stores a typed asset id with its alternative text, and nothing when emptied', async () => {
    const { type, value } = await render(defs({ id: 'i', apiId: 'image', label: 'Image', type: 'media', requireAlt: true }));
    await type('Asset id', '00000000-0000-4000-8000-000000000009');
    await type('Alternative text', 'A cat');
    expect(value()).toEqual({ image: { assetId: '00000000-0000-4000-8000-000000000009', alt: 'A cat' } });
    await type('Alternative text', '');
    expect(value()).toEqual({ image: { assetId: '00000000-0000-4000-8000-000000000009' } });
    await type('Asset id', '');
    expect(value()).toEqual({ image: null });
  });

  describe('translated fields', () => {
    const english = { code: 'en-GB', name: 'English', fallback: null, isDefault: true, prefix: 'en' };
    const french = { code: 'fr-FR', name: 'French', fallback: 'en-GB', isDefault: false, prefix: 'fr' };
    const fields = defs(
      { id: 't', apiId: 'title', label: 'Title', type: 'text', localised: true },
      { id: 's', apiId: 'slug', label: 'Slug', type: 'text' },
      {
        id: 'f',
        apiId: 'features',
        label: 'Features',
        type: 'group',
        multiple: true,
        fields: [{ id: 'ft', apiId: 'name', label: 'Name', type: 'text', localised: true }],
      },
    );
    const data = { title: { 'en-GB': 'Hello' }, slug: 'hello', features: [{ name: { 'en-GB': 'Fast' } }] };

    async function multilingual(locale: string | null, compare: string | null = null) {
      const view = await render(fields, data);
      view.context.locales.set([english, french]);
      view.context.locale.set(locale);
      view.context.compareLocale.set(compare);
      await view.fixture.whenStable();
      return view;
    }

    it('edits the default locale\'s value, at <field>.<locale>', async () => {
      const { input, type, value } = await multilingual(null);
      expect(input('Title (English)').value).toBe('Hello');
      expect(input('Title (English)').id).toBe('field-title-en-GB');
      await type('Title (English)', 'Hi');
      expect(value()).toMatchObject({ title: { 'en-GB': 'Hi' } });
    });

    it('in another locale, translates inside shared groups and locks what every locale shares', async () => {
      const { el, input, type, value } = await multilingual('fr-FR');
      expect(input('Title (French)').value).toBe('');
      // Announced with the control, and its content is in French.
      const described = (input('Title (French)').getAttribute('aria-describedby') ?? '').split(' ').map((id) => el.querySelector(`#${id}`)?.textContent);
      expect(described.join(' ')).toContain('Not translated yet: the site shows the English text until you add one.');
      expect(input('Title (French)').getAttribute('lang')).toBe('fr-FR');
      expect(input('Slug').getAttribute('lang')).toBeNull();
      expect(input('Slug').disabled).toBe(true);
      // The group's items are shared: no adding or removing them here, but their translated fields are open.
      expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Add an item'))).toBe(false);
      await type('Name (French)', 'Rapide');
      await type('Title (French)', 'Bonjour');
      expect(value()).toEqual({
        title: { 'en-GB': 'Hello', 'fr-FR': 'Bonjour' },
        slug: 'hello',
        features: [{ name: { 'en-GB': 'Fast', 'fr-FR': 'Rapide' } }],
      });
    });

    it('side by side, shows the source locale read-only next to the translation', async () => {
      const { input } = await multilingual('fr-FR', 'en-GB');
      expect(input('Title (English)').value).toBe('Hello');
      expect(input('Title (English)').disabled).toBe(true);
      expect(input('Title (French)').disabled).toBe(false);
    });
  });

  describe('with a media library', () => {
    const door: MediaPreview = {
      id: '00000000-0000-4000-8000-000000000001',
      filename: 'red-door.jpg',
      title: 'Red door',
      kind: 'image',
      alt: 'A red front door',
      thumbnailUrl: 'https://storage.example/red-door.jpg?token=x',
    };
    const plain: MediaPreview = { ...door, id: '00000000-0000-4000-8000-000000000002', title: 'Plain', alt: null };

    function library(context: FieldFormContext, choice: MediaPreview[] | null) {
      const source: MediaSource = {
        choose: vi.fn().mockResolvedValue(choice),
        load: vi.fn((ids: readonly string[]) => {
          const known = new Map([door, plain].map((asset) => [asset.id, asset]));
          context.assets.update((assets) => new Map([...assets, ...ids.map((id) => [id, known.get(id) ?? null] as const)]));
        }),
      };
      context.media.set(source);
      return source;
    }

    const click = async (el: HTMLElement, fixture: { whenStable(): Promise<unknown> }, name: RegExp) => {
      const button = [...el.querySelectorAll('button')].find((b) => name.test(b.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
      if (!button) throw new Error(`no button ${name}`);
      button.click();
      await fixture.whenStable();
      await fixture.whenStable();
    };

    it('chooses a file in the picker and uses the library\'s alt text unless the page gives its own', async () => {
      const fields = defs({ id: 'i', apiId: 'image', label: 'Image', type: 'media', requireAlt: true });
      const { fixture, el, context, input, type, value } = await render(fields);
      const source = library(context, [door]);
      await fixture.whenStable();

      await click(el, fixture, /^Choose an image for Image$/);
      expect(source.choose).toHaveBeenCalledWith({ accept: ['image'], multiple: false, label: 'Image' });
      expect(value()).toEqual({ image: { assetId: door.id } });
      expect(el.textContent).toContain('Red door');
      // The button that opened the picker is gone; focus moves to its replacement, not the page.
      await vi.waitFor(() => expect(document.activeElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Change Red door in Image'));
      expect(el.querySelector('img')?.getAttribute('alt')).toBe('');
      // The library has alt text, so the page's own is optional.
      expect(el.querySelector(`label[for="${input('Alternative text').id}"]`)?.textContent).not.toContain('(required)');
      expect(el.textContent).toContain('Leave empty to use the library\'s: "A red front door".');
      await type('Alternative text', 'Our front door');
      expect(value()).toEqual({ image: { assetId: door.id, alt: 'Our front door' } });

      await click(el, fixture, /^Remove Red door from Image$/);
      expect(value()).toEqual({ image: null });
      await vi.waitFor(() => expect(document.activeElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Choose an image for Image'));
    });

    it('asks for alt text when the library has none, and says when a file has gone', async () => {
      const fields = defs({ id: 'i', apiId: 'image', label: 'Image', type: 'media', requireAlt: true });
      const { fixture, el, context } = await render(fields, { image: { assetId: plain.id } });
      library(context, null);
      await fixture.whenStable();
      expect(el.textContent).toContain('Alternative text (required)');
      expect(context.assetInfo(plain.id)).toEqual({ kind: 'image', alt: null });

      context.assets.set(new Map([[plain.id, null]]));
      await fixture.whenStable();
      expect(el.textContent).toContain('This file is no longer in the media library.');
      expect(context.assetInfo(plain.id)).toBeNull();
      expect(context.assetInfo('unknown')).toBeUndefined();
    });

    it('adds several files to a list field, once each', async () => {
      const fields = defs({ id: 'g', apiId: 'gallery', label: 'Gallery', type: 'media', multiple: true });
      const { fixture, el, context, value } = await render(fields, { gallery: [{ assetId: door.id }] });
      library(context, [door, plain]);
      await fixture.whenStable();
      await click(el, fixture, /^Add from the media library to Gallery$/);
      expect(value()).toEqual({ gallery: [{ assetId: door.id }, { assetId: plain.id }] });
    });
  });
});
