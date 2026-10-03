import { fieldDefSchema, fieldListSchema } from '@novan/shared-schemas';
import { fieldTypeOptions, newField, toApiId, uniqueApiId } from './field-types';

describe('toApiId', () => {
  it.each([
    ['Title', 'title'],
    ['Meta title', 'metaTitle'],
    ['SEO description', 'seoDescription'],
    ['Café opening hours', 'cafeOpeningHours'],
    ['  call-to-action!  ', 'callToAction'],
    ['2nd heading', 'field2ndHeading'],
    ['', 'field'],
  ])('turns %j into %j', (label, apiId) => {
    expect(toApiId(label)).toBe(apiId);
  });
});

describe('uniqueApiId', () => {
  it('adds the first free number', () => {
    expect(uniqueApiId('title', new Set())).toBe('title');
    expect(uniqueApiId('title', new Set(['title', 'title2']))).toBe('title3');
  });
});

describe('newField', () => {
  it('creates a valid field of every palette type, with unique API ids', () => {
    const fields = fieldTypeOptions.reduce<ReturnType<typeof newField>[]>(
      (list, option) => [...list, newField(option.type, list)],
      [],
    );

    expect(fields.map((field) => field.type)).toEqual(fieldTypeOptions.map((option) => option.type));
    for (const field of fields) expect(fieldDefSchema.safeParse(field).success).toBe(true);
    expect(fieldListSchema.safeParse(fields).success).toBe(true);
  });

  it('numbers a second field of the same type', () => {
    const first = newField('text', []);
    expect(newField('text', [first]).apiId).toBe('text2');
  });
});
