import { type FieldDef, type FieldDefInput, fieldListSchema } from '@novan/shared-schemas';
import { planTranslation } from './machine-translation';

const defs = (...fields: FieldDefInput[]): FieldDef[] => fieldListSchema.parse(fields);
const locales = { from: 'en-GB', to: 'fr-FR', defaultLocale: 'en-GB' };

describe('planTranslation', () => {
  const fields = defs(
    { id: 't', apiId: 'title', label: 'Title', type: 'text', localised: true },
    { id: 'b', apiId: 'body', label: 'Body', type: 'richText', localised: true },
    { id: 'l', apiId: 'link', label: 'Link', type: 'link', localised: true },
    { id: 'n', apiId: 'count', label: 'Count', type: 'number', localised: true },
    { id: 's', apiId: 'slug', label: 'Slug', type: 'text' },
  );
  const body = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }] }],
  };

  it('collects text, rich text and link text to translate, in order', () => {
    const plan = planTranslation(fields, { title: { 'en-GB': 'Hi' }, body: { 'en-GB': body }, link: { 'en-GB': { type: 'external', url: 'https://x.test', text: 'More' } }, slug: 'hi' }, [], locales);
    expect(plan.paths).toEqual(['title', 'body', 'link']);
    expect(plan.texts).toEqual(['Hi', 'Hello ', 'world', 'More']);
  });

  it('puts the translations back, keeping marks and link targets', () => {
    const plan = planTranslation(fields, { body: { 'en-GB': body }, link: { 'en-GB': { type: 'external', url: 'https://x.test', text: 'More' } } }, [], locales);
    const data = plan.apply(['Bonjour ', 'le monde', 'Plus']);
    expect(data['body']).toEqual({
      'en-GB': body,
      'fr-FR': { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour ' }, { type: 'text', text: 'le monde', marks: [{ type: 'bold' }] }] }] },
    });
    expect(data['link']).toEqual({ 'en-GB': { type: 'external', url: 'https://x.test', text: 'More' }, 'fr-FR': { type: 'external', url: 'https://x.test', text: 'Plus' } });
  });

  it('copies values with no text, and leaves translations that exist alone', () => {
    const plan = planTranslation(fields, { title: { 'en-GB': 'Hi', 'fr-FR': 'Salut' }, count: { 'en-GB': 3 } }, [], locales);
    expect(plan.paths).toEqual(['count']);
    expect(plan.texts).toEqual([]);
    expect(plan.apply([])).toEqual({ title: { 'en-GB': 'Hi', 'fr-FR': 'Salut' }, count: { 'en-GB': 3, 'fr-FR': 3 } });
  });
});
