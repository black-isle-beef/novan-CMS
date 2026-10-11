// components/form/form.schema.ts
import type { CmsStyleSchema } from '../../cms-schema';

export interface FormSettings {
  tone: 'light' | 'brand' | 'dark';
  width: 'narrow' | 'wide';
  headingLevel: 'h2' | 'h3' | 'h4';
}

/** The kinds of field editors can add. */
export const FORM_FIELD_TYPES = ['text', 'email', 'textarea', 'select', 'checkbox', 'consent'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** One field as editors define it (the `fields` group of the `form` block type). Stored data, so every key may be off. */
export interface FormFieldItem {
  label?: string | null;
  /** The answer's name in the inbox and export, e.g. `email`. */
  name?: string | null;
  type?: FormFieldType | null;
  required?: boolean | null;
  help?: string | null;
  /** A `select`'s choices, one per line. */
  options?: string | null;
}

/** The `form` block type's fields (supabase/seed.sql). */
export interface FormFields {
  heading: string;
  intro: string;
  fields: FormFieldItem[] | null;
  submitLabel: string;
  successMessage: string;
}

export const FORM_SCHEMA: CmsStyleSchema<FormSettings> = {
  tone: {
    kind: 'radio',
    label: 'Tone',
    hint: 'Background and text colours.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'brand', label: 'Brand' },
      { value: 'dark', label: 'Dark' },
    ],
    default: 'light',
  },
  width: {
    kind: 'radio',
    label: 'Width',
    options: [
      { value: 'narrow', label: 'Narrow' },
      { value: 'wide', label: 'Wide' },
    ],
    default: 'narrow',
  },
  headingLevel: {
    kind: 'select',
    label: 'Heading level',
    hint: 'Keep headings in order on the page.',
    options: [
      { value: 'h2', label: 'H2' },
      { value: 'h3', label: 'H3' },
      { value: 'h4', label: 'H4' },
    ],
    default: 'h2',
  },
};

export const FORM_SAMPLE_CONTENT: FormFields = {
  heading: 'Book a grooming appointment',
  intro: 'Tell us about your dog and we will reply within a working day.',
  fields: [
    { label: 'Your name', name: 'name', type: 'text', required: true },
    { label: 'Email address', name: 'email', type: 'email', required: true, help: 'We only use it to reply to you.' },
    { label: 'Size of dog', name: 'size', type: 'select', required: false, options: 'Small\nMedium\nLarge' },
    { label: 'Anything we should know?', name: 'message', type: 'textarea', required: false },
    { label: 'Send me reminders about appointments', name: 'reminders', type: 'checkbox', required: false },
    { label: 'I agree that you may keep these details to reply to me.', name: 'consent', type: 'consent', required: true },
  ],
  submitLabel: 'Send request',
  successMessage: 'Thank you. We have your request and will reply by email.',
};
