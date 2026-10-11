import { z } from 'zod';
import { LOCALE_CODE_PATTERN } from './locales';

// Forms (docs/build/18-search-forms-audit.md): the `form` block, what visitors send through it
// (`POST /v1/delivery/forms/:formUid/submit`) and the admin's Forms inbox (`/v1/management/spaces/:spaceId/forms/...`).

/** The `form` block's field types. */
export const formFieldTypes = ['text', 'email', 'textarea', 'select', 'checkbox', 'consent'] as const;
export type FormFieldType = (typeof formFieldTypes)[number];

/** One field of a form, as its block holds it in one locale. */
export interface FormField {
  /** The answer's key in the submission, the inbox and the export, e.g. `email`. */
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  help: string | null;
  /** A `select`'s choices. */
  options: string[];
}

/** The longest answer each type takes. */
export const FORM_VALUE_MAX: Readonly<Record<'text' | 'email' | 'textarea' | 'select', number>> = {
  text: 500,
  email: 254,
  textarea: 5000,
  select: 200,
};

/** The hidden field people never see; anything in it means a robot filled in the form. */
export const FORM_HONEYPOT_FIELD = 'website';

const namePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A `select`'s choices from its text: one per line, blanks and repeats left out. */
export function formOptions(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].slice(0, 100);
}

/**
 * The fields of a form block from its data in one locale (stored data is untrusted): fields without a valid name,
 * label or type are left out, and so is a second field with a name already used.
 */
export function formFieldsOf(fields: unknown): FormField[] {
  if (!Array.isArray(fields)) return [];
  const seen = new Set<string>();
  const result: FormField[] = [];
  for (const raw of fields) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const name = text(item['name']);
    const label = text(item['label']);
    const type = item['type'];
    if (!name || !namePattern.test(name) || seen.has(name) || name === FORM_HONEYPOT_FIELD) continue;
    if (!label || !(formFieldTypes as readonly unknown[]).includes(type)) continue;
    const options = type === 'select' ? formOptions(item['options']) : [];
    if (type === 'select' && !options.length) continue;
    seen.add(name);
    result.push({ name, label, type: type as FormFieldType, required: item['required'] === true, help: text(item['help']), options });
  }
  return result;
}

/**
 * Checks a visitor's answers against the form, as the API does before keeping them: required fields filled in (a
 * required consent ticked), emails that look like emails, choices from the list, nothing too long, nothing the form
 * does not ask. Empty optional answers are left out.
 */
export function buildFormSubmissionSchema(fields: readonly FormField[]): z.ZodType<Record<string, string | boolean>> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    // A missing answer gets this message; a wrong one gets `wrong`.
    const message = (wrong: string) => ({
      error: (issue: { input?: unknown }) =>
        issue.input === undefined ? (field.type === 'consent' ? 'Tick this box to send the form.' : 'Fill in this field.') : wrong,
    });
    if (field.type === 'checkbox' || field.type === 'consent') {
      shape[field.name] = field.required ? z.literal(true, message('Tick this box.')) : z.boolean(message('Tick or untick this box.')).optional();
      continue;
    }
    const schema =
      field.type === 'select'
        ? z.enum(field.options as [string, ...string[]], message('Choose one of the options.'))
        : field.type === 'email'
          ? z.email(message('Enter an email address, like name@example.com.')).max(FORM_VALUE_MAX.email, 'This email address is too long.')
          : z.string(message('Enter some text.')).max(FORM_VALUE_MAX[field.type], `Use ${FORM_VALUE_MAX[field.type]} characters or fewer.`);
    // Text answers are trimmed; an empty one is missing.
    shape[field.name] = z.preprocess(
      (value) => (typeof value === 'string' ? value.trim() || undefined : value),
      field.required ? schema : schema.optional(),
    );
  }
  return z.strictObject(shape).transform((data) => {
    const out: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(data)) if (value !== undefined) out[key] = value as string | boolean;
    return out;
  }) as unknown as z.ZodType<Record<string, string | boolean>>;
}

/** `POST /v1/delivery/forms/:formUid/submit`. */
export const formSubmitRequestSchema = z.strictObject({
  /** The published page the form is on. */
  entryId: z.uuid('Give the id of the page the form is on.'),
  /** The locale the visitor saw the form in; the space's default locale when left out. */
  locale: z.string().regex(LOCALE_CODE_PATTERN, 'Use a locale like en-GB.').optional(),
  /** Answers by field name. */
  data: z.record(z.string().max(100), z.unknown()).refine((data) => Object.keys(data).length <= 50, 'Too many answers.'),
  /** The Cloudflare Turnstile widget's response. */
  turnstileToken: z.string().max(4096).optional(),
  /** The honeypot ({@link FORM_HONEYPOT_FIELD}): empty for people. */
  website: z.string().max(2000).optional(),
});
export type FormSubmitRequest = z.input<typeof formSubmitRequestSchema>;

export const formUidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Use the form block\'s id.');

// --- Inbox --------------------------------------------------------------------------------------

export const formSubmissionFieldSchema = z.object({ name: z.string(), label: z.string(), type: z.string() });

export const formSubmissionSchema = z.object({
  id: z.uuid(),
  /** Null once the page has been deleted for good. */
  entryId: z.uuid().nullable(),
  formUid: z.string(),
  formName: z.string().nullable(),
  pagePath: z.string().nullable(),
  locale: z.string().nullable(),
  data: z.record(z.string(), z.union([z.string(), z.boolean()])),
  /** The form's fields when it was sent, in order. */
  fields: z.array(formSubmissionFieldSchema),
  createdAt: z.string(),
});
export type FormSubmission = z.infer<typeof formSubmissionSchema>;

export const formSubmissionsPageSchema = z.object({
  items: z.array(formSubmissionSchema),
  /** Pass as `cursor` for the next page; null on the last. */
  nextCursor: z.string().nullable(),
});
export type FormSubmissionsPage = z.infer<typeof formSubmissionsPageSchema>;

export const formSubmissionsQuerySchema = z.strictObject({
  /** Only this form's (its block id). */
  form: formUidSchema.optional(),
  cursor: z.string().max(500).regex(/^[A-Za-z0-9_-]+$/, 'Use the nextCursor of the previous page.').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FormSubmissionsQuery = z.input<typeof formSubmissionsQuerySchema>;

export const formExportQuerySchema = z.strictObject({ form: formUidSchema });

/** A form that has received submissions, for the inbox's list of forms. */
export const formSummarySchema = z.object({
  formUid: z.string(),
  formName: z.string().nullable(),
  pagePath: z.string().nullable(),
  entryId: z.uuid().nullable(),
  count: z.number().int(),
  lastAt: z.string(),
});
export type FormSummary = z.infer<typeof formSummarySchema>;

export const formSettingsSchema = z.object({
  /** Who gets an email for each submission. */
  recipients: z.array(z.string()),
  /** How long submissions are kept, in months. */
  retentionMonths: z.number().int(),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export const DEFAULT_FORM_RETENTION_MONTHS = 12;

export const updateFormSettingsRequestSchema = z.strictObject({
  recipients: z
    .array(z.email('Enter email addresses, like office@example.com.').max(254))
    .max(10, 'Up to 10 people can get these emails.')
    .transform((list) => [...new Set(list.map((email) => email.toLowerCase()))]),
  retentionMonths: z.int('Choose a whole number of months.').min(1, 'Keep them for at least a month.').max(120, 'Keep them for at most 120 months.'),
});
export type UpdateFormSettingsRequest = z.input<typeof updateFormSettingsRequestSchema>;
