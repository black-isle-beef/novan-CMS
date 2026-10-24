/**
 * The contact form. It is sent to the Forms feature, so the published Contact page's `form` block in the Novan
 * space must have fields with these names, and its "enquiry" choices must be these labels, one per line
 * (docs/clients/marketing-site.md). The API checks every answer against that block.
 */
export const contactForm = {
  fields: {
    name: 'name',
    email: 'email',
    company: 'company',
    enquiry: 'enquiry',
    message: 'message',
    consent: 'consent',
  },
  /** `value` is what `?enquiry=` preselects; `label` is what is shown and sent. */
  enquiryTypes: [
    { value: 'general', label: 'General question' },
    { value: 'sales', label: 'Sales' },
    { value: 'support', label: 'Support' },
    { value: 'demo', label: 'Book a demo' },
  ],
  limits: { name: 200, email: 254, company: 200, message: 5000 },
  submitLabel: 'Send enquiry',
  successMessage: 'Thank you. We have your enquiry and will reply by email.',
  failureMessage: 'Sorry, your enquiry could not be sent. Please try again, or email us instead.',
} as const;

export type EnquiryType = (typeof contactForm.enquiryTypes)[number]['value'];
