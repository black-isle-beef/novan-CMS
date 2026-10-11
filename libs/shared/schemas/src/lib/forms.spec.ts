import { buildFormSubmissionSchema, formFieldsOf, formOptions, updateFormSettingsRequestSchema } from './forms';

const fields = formFieldsOf([
  { label: 'Your name', name: 'name', type: 'text', required: true },
  { label: 'Email', name: 'email', type: 'email', required: true, help: 'To reply.' },
  { label: 'Topic', name: 'topic', type: 'select', options: 'Sales\nSupport\n\nSales' },
  { label: 'Message', name: 'message', type: 'textarea' },
  { label: 'News', name: 'news', type: 'checkbox' },
  { label: 'I agree', name: 'consent', type: 'consent', required: true },
]);
const schema = buildFormSubmissionSchema(fields);
const valid = { name: ' Ada ', email: 'ada@example.com', consent: true };

describe('formFieldsOf', () => {
  it('reads the fields, with choices one per line', () => {
    expect(fields.map((field) => field.name)).toEqual(['name', 'email', 'topic', 'message', 'news', 'consent']);
    expect(fields[1]).toEqual({ name: 'email', label: 'Email', type: 'email', required: true, help: 'To reply.', options: [] });
    expect(fields[2].options).toEqual(['Sales', 'Support']);
  });

  it('leaves out fields stored data has broken', () => {
    expect(
      formFieldsOf([
        null,
        { label: 'No name', type: 'text' },
        { label: 'Bad name', name: 'Bad Name', type: 'text' },
        { label: 'Bad type', name: 'x', type: 'file' },
        { label: '', name: 'y', type: 'text' },
        { label: 'No choices', name: 'z', type: 'select', options: '' },
        { label: 'Honeypot', name: 'website', type: 'text' },
        { label: 'First', name: 'dup', type: 'text' },
        { label: 'Second', name: 'dup', type: 'text' },
      ]).map((field) => field.label),
    ).toEqual(['First']);
    expect(formFieldsOf('nonsense')).toEqual([]);
    expect(formOptions(42)).toEqual([]);
  });
});

describe('buildFormSubmissionSchema', () => {
  it('accepts a complete answer, trimmed, without empty optional answers', () => {
    expect(schema.parse({ ...valid, topic: 'Support', message: '  ', news: false })).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      consent: true,
      topic: 'Support',
      news: false,
    });
  });

  it('needs required answers and consent', () => {
    const result = schema.safeParse({ name: '   ' });
    const messages = Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]));
    expect(messages).toEqual({
      name: 'Fill in this field.',
      email: 'Fill in this field.',
      consent: 'Tick this box to send the form.',
    });
    expect(schema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });

  it('checks emails, choices, lengths and types', () => {
    expect(schema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, topic: 'Something else' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, name: 'x'.repeat(501) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, message: 'x'.repeat(5000) }).success).toBe(true);
    expect(schema.safeParse({ ...valid, news: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, name: ['Ada'] }).success).toBe(false);
  });

  it('refuses answers the form does not ask for', () => {
    expect(schema.safeParse({ ...valid, admin: true }).success).toBe(false);
  });
});

describe('form settings', () => {
  it('takes up to ten recipients, lower-cased and without repeats', () => {
    expect(
      updateFormSettingsRequestSchema.parse({ recipients: ['Office@Example.com', 'office@example.com'], retentionMonths: 12 }),
    ).toEqual({ recipients: ['office@example.com'], retentionMonths: 12 });
    expect(updateFormSettingsRequestSchema.safeParse({ recipients: ['nope'], retentionMonths: 12 }).success).toBe(false);
    expect(updateFormSettingsRequestSchema.safeParse({ recipients: [], retentionMonths: 0 }).success).toBe(false);
  });
});
