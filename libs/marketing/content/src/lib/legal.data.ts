import { CONSENT_MAX_AGE_DAYS } from './cookies.data';
import { site } from './site.data';
import type { Paragraph } from './types';

// TODO(legal-review): these documents are templates written for a UK business. They are not legal advice. The owner
// must have them reviewed, and fill in every TODO, before the site launches.

export type LegalBlock =
  | { kind: 'paragraph'; content: Paragraph }
  | { kind: 'list'; items: readonly Paragraph[] }
  /** The table of cookies and storage from `storageRegister`. */
  | { kind: 'storage-table' }
  /** A button that reopens the cookie banner. */
  | { kind: 'cookie-settings' };

export interface LegalSection {
  /** Anchor id, listed in the table of contents. */
  id: string;
  heading: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  title: string;
  /** ISO 8601 date the content last changed. */
  lastUpdated: string;
  intro: Paragraph;
  sections: readonly LegalSection[];
}

const p = (content: Paragraph): LegalBlock => ({ kind: 'paragraph', content });
const list = (...items: Paragraph[]): LegalBlock => ({ kind: 'list', items });
const email = { text: site.contactEmail, href: `mailto:${site.contactEmail}` };

export const privacyPolicy: LegalDocument = {
  title: 'Privacy policy',
  lastUpdated: '2026-10-23',
  intro: `This policy explains how ${site.organisationName} uses personal data collected through this website, and your rights under the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.`,
  sections: [
    {
      id: 'who-we-are',
      heading: 'Who we are',
      blocks: [
        // TODO(legal-review): legal entity name, registered address and ICO registration number.
        p([`${site.organisationName} is the controller of the personal data described here. You can contact us about anything in this policy at `, email, '.']),
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      blocks: [
        p('When you send us an enquiry through the contact form, we collect:'),
        list('your name and email address', 'your company name, if you give it', 'the type of enquiry and your message', 'that you agreed to us contacting you about it'),
        p('When you visit the site, our servers and our content delivery network record technical information such as your IP address, browser type and the pages requested. We use this to keep the site secure and working.'),
        p(['We use one cookie to remember your cookie choices. See our ', { text: 'cookie policy', href: '/cookies' }, '.']),
      ],
    },
    {
      id: 'how-we-use-it',
      heading: 'How we use it and our lawful basis',
      blocks: [
        list(
          'To reply to your enquiry, including arranging a demo. Lawful basis: your consent, given with the tick box on the form, and our legitimate interest in answering questions about our services.',
          'To keep the site secure and diagnose problems. Lawful basis: our legitimate interest in running a safe, reliable website.',
        ),
        p('We do not sell your data, and we do not use it for automated decision-making or profiling.'),
      ],
    },
    {
      id: 'how-long',
      heading: 'How long we keep it',
      blocks: [
        p('Enquiries are kept for 12 months after we receive them and then deleted automatically, unless they lead to a contract, in which case we keep them as part of our customer records.'),
        // TODO(legal-review): confirm how long server and CDN logs are kept.
        p('Technical logs are kept for a short period for security and troubleshooting, then deleted.'),
      ],
    },
    {
      id: 'who-we-share-it-with',
      heading: 'Who we share it with',
      blocks: [
        p('We use these service providers (processors), who act only on our instructions:'),
        // TODO(legal-review): confirm the full list of processors, where each one stores data, and the transfer safeguards.
        list(
          'Supabase, which hosts our database and stores enquiries',
          'Cloudflare, which delivers and protects the website',
          'Resend, which sends the email telling us about a new enquiry',
          'our server hosting provider',
        ),
        p('Where a provider processes data outside the UK, we rely on UK adequacy regulations or the International Data Transfer Agreement or Addendum to protect it.'),
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your rights',
      blocks: [
        p('You have the right to:'),
        list(
          'ask for a copy of the personal data we hold about you',
          'ask us to correct or complete it',
          'ask us to delete it',
          'ask us to restrict or object to how we use it',
          'ask for it in a portable format',
          'withdraw your consent whenever you choose, without affecting what we did before',
        ),
        p(['To use one of these rights, email ', email, '. We will reply within one month.']),
      ],
    },
    {
      id: 'complaints',
      heading: 'Complaints',
      blocks: [
        p([
          'If you are unhappy with how we have handled your data, please tell us first. You can also complain to the Information Commissioner’s Office (ICO) at ',
          { text: 'ico.org.uk/make-a-complaint', href: 'https://ico.org.uk/make-a-complaint/' },
          ' or by phone on 0303 123 1113.',
        ]),
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      blocks: [p('We will update this page if anything changes, and change the date at the top.')],
    },
  ],
};

export const cookiePolicy: LegalDocument = {
  title: 'Cookie policy',
  lastUpdated: '2026-10-23',
  intro:
    'This policy explains the cookies and similar technologies this website uses, under the Privacy and Electronic Communications Regulations (PECR) and the UK GDPR.',
  sections: [
    {
      id: 'what-cookies-are',
      heading: 'What cookies are',
      blocks: [
        p('Cookies are small files a website saves in your browser. Similar technologies, such as local storage, work in the same way. We call them all cookies here.'),
      ],
    },
    {
      id: 'how-we-use-cookies',
      heading: 'How we use cookies',
      blocks: [
        p('We only use cookies that are strictly necessary for the site to work. We do not use analytics or marketing cookies.'),
        p('If we ever add analytics or marketing cookies, we will ask for your permission first and will not set them unless you agree.'),
      ],
    },
    {
      id: 'cookies-we-use',
      heading: 'Cookies we use',
      blocks: [{ kind: 'storage-table' }],
    },
    {
      id: 'your-choices',
      heading: 'Changing your choices',
      blocks: [
        p(`You can change your choices whenever you like with the button below, or with the "Cookie settings" button at the bottom of every page. We ask again after ${Math.round(CONSENT_MAX_AGE_DAYS / 30)} months.`),
        { kind: 'cookie-settings' },
        p('You can also block or delete cookies in your browser settings. If you block strictly necessary cookies, we will ask for your choices on every page.'),
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [p(['Questions about cookies? Email ', email, '.'])],
    },
  ],
};

export type LegalDocumentKey = 'privacy' | 'cookies' | 'accessibility';

export const accessibilityStatement: LegalDocument = {
  title: 'Accessibility statement',
  // TODO(confirm): update with the date of the last full accessibility test.
  lastUpdated: '2026-10-23',
  intro: `${site.organisationName} wants as many people as possible to be able to use this website.`,
  sections: [
    {
      id: 'using-this-website',
      heading: 'Using this website',
      blocks: [
        p('You should be able to:'),
        list(
          'zoom in up to 400% without the text spilling off the screen',
          'use the whole site with a keyboard alone',
          'use the site with a screen reader',
          'turn off animations using your device’s reduced motion setting',
          'read every page at a width of 320 pixels without scrolling sideways',
        ),
        p(['AbilityNet has ', { text: 'advice on making your device easier to use', href: 'https://mcmw.abilitynet.org.uk/' }, ' if you have a disability.']),
      ],
    },
    {
      id: 'compliance-status',
      heading: 'Compliance status',
      blocks: [
        // TODO(confirm): state "fully" or "partially" compliant once a full audit has been done.
        p('We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. Every page is checked with automated accessibility tests and by hand with a keyboard and a screen reader before release. We have not yet had an independent audit.'),
      ],
    },
    {
      id: 'known-issues',
      heading: 'Known issues',
      blocks: [
        // TODO(confirm): list anything found in testing, with a date for each fix.
        p('We know of no accessibility problems on this website. If you find one, please tell us.'),
      ],
    },
    {
      id: 'reporting-problems',
      heading: 'Reporting problems and asking for another format',
      blocks: [
        p(['If you find a problem, or need information in a different format, email ', email, '. Tell us the address of the page and what went wrong.']),
        // TODO(copy): confirm the response time.
        p('We will reply within five working days.'),
      ],
    },
    {
      id: 'technical-information',
      heading: 'Technical information',
      blocks: [
        p('This website is built with Angular and the Novan Design System. It relies on HTML, CSS, WAI-ARIA and JavaScript; the content of every page is also sent as complete HTML from the server.'),
      ],
    },
    {
      id: 'preparation',
      heading: 'How we tested this website',
      blocks: [
        // TODO(confirm): the date and method of the last test.
        p('This statement was prepared on 23 October 2026. The site was tested with automated axe checks on every page and a manual keyboard review.'),
      ],
    },
  ],
};

/** The legal pages by route key, so the documents load with the legal page rather than with every page. */
export const legalDocuments: Readonly<Record<LegalDocumentKey, LegalDocument>> = {
  privacy: privacyPolicy,
  cookies: cookiePolicy,
  accessibility: accessibilityStatement,
};