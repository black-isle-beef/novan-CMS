// laws-paws.content.ts — the old Law's Paws site (github.com/black-isle-beef/laws-paws) as Novan content: the files
// to upload to the media library, and the pages, menu, footer and site settings in the starter kits' seed format.
// Copy comes from the old site's templates and route data as it was when it was migrated; ids are not known until
// the files are uploaded, so media fields hold `{ "$asset": "<key>" }` until `withAssets` fills them in.
import type { SeedEntry } from '../novan-cli/src/lib/kits';

/** One file from the old site's `public/images`, as it goes into the media library. */
export interface MediaFile {
  key: string;
  /** Relative to the old site's `public` folder. */
  source: string;
  folder: string;
  title: string;
  /** The library's alt text; pages use it unless they set their own. Empty for a decorative file. */
  alt: string;
  tags: string[];
}

const BRAND = 'website/brand';
const STOCK = 'website/stock-photos';

/**
 * Brand files the site uses, and the stock photos the old repository held but never showed. The stock photos are
 * Unsplash images of other people's animals, so they go into the library for the client to choose from, credited in
 * the title, and are not presented as Law's Paws clients anywhere.
 */
export const LAWS_PAWS_MEDIA: readonly MediaFile[] = [
  {
    key: 'logo',
    source: 'images/logos/desktop/lawspaws-paw-mark-on-light.svg',
    folder: BRAND,
    title: 'Paw mark logo',
    alt: "Law's Paws",
    tags: ['logo'],
  },
  {
    key: 'favicon',
    source: 'images/favicon/logo-favicon-64.png',
    folder: BRAND,
    title: 'Browser tab icon',
    alt: '',
    tags: ['logo'],
  },
  {
    key: 'badge',
    source: 'images/logos/mobile/logo-mobile-512.png',
    folder: BRAND,
    title: 'Badge logo',
    alt: "The Law's Paws badge logo",
    tags: ['logo'],
  },
  {
    key: 'social',
    source: 'images/logos/social/logo-social-1024.png',
    folder: BRAND,
    title: 'Sharing image',
    alt: "The Law's Paws logo",
    tags: ['logo'],
  },
  stock(
    'bath-frenchie',
    'gallery/anthony-duran-xypTOFe_hqc-unsplash.jpg',
    'Anthony Duran',
    'A smiling French bulldog in a bubble bath, being rinsed with a shower head',
  ),
  stock(
    'bath-edge',
    'gallery/eliza-ari-1W7bJqkvdSc-unsplash.jpg',
    'Eliza Ari',
    'A French bulldog peering over the edge of a white bath',
  ),
  stock(
    'poodle',
    'gallery/helena-lopes-2kMutjzy6L4-unsplash.jpg',
    'Helena Lopes',
    'A white poodle with a full fluffy trim and red bows, sitting on a log',
  ),
  stock(
    'blanket',
    'gallery/natary-t-RTCOGwAX1so-unsplash.jpg',
    'Natary T',
    'A small grey curly-coated dog wrapped in a white and red blanket',
  ),
  stock(
    'cat-brush',
    'gallery/sergej-UNL2_qP3svw-unsplash.jpg',
    'Sergej',
    'A tortoiseshell cat lying on a patterned blanket while it is brushed with a de-shedding comb',
  ),
  stock(
    'paw',
    'gallery/tetiana-sapon-Tpp9Q4NFTj8-unsplash.jpg',
    'Tetiana Sapon',
    "Close-up of the pads on a fluffy golden dog's paw",
  ),
  stock(
    'scissor-trim',
    'hero/buddy-an-LpK2xddrElI-unsplash.jpg',
    'Buddy AN',
    'A small white fluffy dog having the fur around its face trimmed with scissors',
  ),
  stock(
    'towel-comb',
    'hero/hayffield-l-ZVdZw2p08y4-unsplash.jpg',
    'Hayffield L',
    'A Pomeranian with a pink towel on its head having its fur combed',
  ),
];

function stock(key: string, file: string, photographer: string, alt: string): MediaFile {
  return {
    key,
    source: `images/${file}`,
    folder: STOCK,
    title: `Stock photo by ${photographer} on Unsplash`,
    alt,
    tags: ['stock', 'unsplash'],
  };
}

// --- Rich text (ProseMirror JSON, as the richText field stores it) ---------------------------------------------

type Node = Record<string, unknown>;
const text = (value: string, href?: string): Node =>
  href ? { type: 'text', text: value, marks: [{ type: 'link', attrs: { href } }] } : { type: 'text', text: value };
const paragraph = (...parts: (string | Node)[]): Node => ({
  type: 'paragraph',
  content: parts.map((part) => (typeof part === 'string' ? text(part) : part)),
});
const heading = (level: 2 | 3, value: string): Node => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const doc = (...content: Node[]): Node => ({ type: 'doc', content });

const page = (key: string) => ({ type: 'internal', entryId: { $entry: key } });
const asset = (key: string) => ({ $asset: key });

// --- Content -------------------------------------------------------------------------------------------------

const CONTACT = {
  address: '6 Newbigging, Musselburgh, United Kingdom',
  phone: '+44 7488 984559',
  phoneE164: '447488984559',
  email: 'Hayley@laws-paws.co.uk',
};

/** The old site's home description, shortened to the 160 characters search results show. */
const DESCRIPTION =
  'A vegan-run grooming studio for dogs and small animals, offering grooming, ultrasonic teeth cleaning and reiki in a holistic, cruelty-free setting.';

/** Placeholder text the old site showed until the policies are written: kept, so nothing reads as a final policy. */
const policyPending = (what: string) =>
  doc(
    paragraph(
      `Our full ${what} is on its way. In the meantime, if you have any questions, please `,
      text('get in touch', '/contact'),
      '.',
    ),
  );

export const LAWS_PAWS_ENTRIES: readonly SeedEntry[] = [
  {
    key: 'home',
    contentType: 'page',
    slug: 'home',
    data: {
      title: 'Home',
      slug: 'home',
      seo: { metaTitle: 'Vegan-run pet grooming', metaDescription: DESCRIPTION, noindex: false },
      body: [
        {
          _block: 'hero',
          _style: { tone: 'brand' },
          heading: 'Compassionate care for your companions',
          subheading:
            "Law's Paws is a vegan-run grooming studio for dogs and small animals, offering a holistic, cruelty-free experience from nose to tail.",
          action: { ...page('contact'), text: 'Book a visit' },
        },
        {
          _block: 'featureGrid',
          heading: 'Holistic care, gently given',
          features: [
            {
              icon: 'star',
              title: 'Grooming',
              text: 'Bathing, drying, trims and nail care for dogs and small animals, using only gentle, cruelty-free products.',
            },
            {
              icon: 'shield-check',
              title: 'Ultrasonic teeth cleaning',
              text: 'A quiet, gentle clean that helps keep teeth and gums healthy, at a pace your pet is comfortable with.',
            },
            {
              icon: 'heart',
              title: 'Reiki',
              text: 'A calm, soothing session to help your pet relax and feel at ease, on its own or alongside a groom.',
            },
          ],
        },
        {
          _block: 'mediaText',
          heading: 'Every groom ends with a report',
          text: "After every appointment you'll receive a private link to your pet's own digital report: photos, the care we gave, and simple, easy-to-follow notes for looking after them at home.",
          image: asset('badge'),
          action: { ...page('gallery'), text: 'See our gallery' },
        },
        {
          _block: 'cta',
          _style: { tone: 'light', alignment: 'start' },
          heading: 'New clients welcome',
          text: "Every first visit begins with a relaxed chat about your pet's needs and temperament, so their care is planned around them, not a fixed price list.",
          action: { ...page('contact'), text: 'Get in touch' },
        },
      ],
    },
  },
  {
    key: 'about',
    contentType: 'page',
    slug: 'about',
    data: {
      title: 'About',
      slug: 'about',
      seo: {
        metaDescription:
          "Law's Paws is a small, independent, vegan-run studio caring for dogs and small animals with gentle handling and cruelty-free products.",
        noindex: false,
      },
      body: [
        {
          _block: 'hero',
          _style: { tone: 'dark', height: 'compact' },
          heading: "About Law's Paws",
          subheading:
            'A small, independent, vegan-run studio caring for dogs and small animals with patience, kindness and compassion.',
        },
        {
          _block: 'richText',
          _style: { width: 'wide' },
          body: doc(
            heading(2, 'Kindness in everything we do'),
            paragraph(
              "Law's Paws was founded on a simple belief: every animal deserves to be treated with care and compassion. As a vegan-run studio, we use only cruelty-free products and look after the whole animal, not just their coat, bringing together grooming, ultrasonic teeth cleaning and reiki so your pet leaves looking and feeling their best.",
            ),
            paragraph(
              'We never rush, every visit is planned around the individual in front of us, and every owner receives a full digital report of what was done and why.',
            ),
          ),
        },
        {
          _block: 'featureGrid',
          _style: { headingLevel: 'h3' },
          features: [
            {
              icon: 'heart',
              title: 'Cruelty-free',
              text: 'Vegan-run from top to tail, using only cruelty-free products on every animal in our care.',
            },
            {
              icon: 'check-circle',
              title: 'Gentle and unhurried',
              text: 'One pet at a time, with calm, reward-based handling and breaks built in for nervous or older animals.',
            },
            {
              icon: 'chat-dots',
              title: 'Holistic and honest',
              text: 'We care for the whole animal, and send a clear, photographed report after every visit so you always know what was done.',
            },
          ],
        },
        {
          _block: 'badgeList',
          heading: 'Qualified and trusted',
          badges: [
            { label: 'Fully insured' },
            { label: 'Cat and dog first aid certified' },
            { label: 'City & Guilds qualified' },
          ],
        },
      ],
    },
  },
  {
    key: 'gallery',
    contentType: 'page',
    slug: 'gallery',
    data: {
      title: 'Gallery',
      slug: 'gallery',
      seo: {
        metaDescription:
          "Dogs and small animals recently pampered at Law's Paws, each one sent home with their own digital report.",
        noindex: false,
      },
      body: [
        {
          _block: 'hero',
          _style: { tone: 'light', height: 'compact' },
          heading: 'Gallery',
          subheading:
            "A few of the lovely dogs and small animals we've pampered recently. Each one went home with their own digital report.",
        },
        {
          // The old site showed placeholders here until real groom photos were ready: the cards stay text-only
          // until the client adds their own photos (docs/clients/laws-paws-feedback.md).
          _block: 'cardGrid',
          cards: [
            { title: 'Milo', subtitle: 'Cockapoo', tag: 'Full groom and de-shed' },
            { title: 'Bella', subtitle: 'Springer Spaniel', tag: 'Bath, tidy and reiki' },
            { title: 'Clover', subtitle: 'Lionhead rabbit', tag: 'Gentle groom and nail trim' },
            { title: 'Poppy', subtitle: 'Shih Tzu', tag: 'Full groom and teeth clean' },
            { title: 'Hazel', subtitle: 'Guinea pig', tag: 'Coat tidy and nails' },
            { title: 'Luna', subtitle: 'Labradoodle', tag: 'Ultrasonic teeth clean' },
          ],
        },
      ],
    },
  },
  {
    key: 'contact',
    contentType: 'page',
    slug: 'contact',
    data: {
      title: 'Contact',
      slug: 'contact',
      seo: {
        metaDescription:
          "Get in touch with Law's Paws. Tell us about your pet and what they need, and we'll be in touch to find a time.",
        noindex: false,
      },
      body: [
        {
          _block: 'hero',
          _style: { tone: 'brand', height: 'compact' },
          heading: 'Get in touch',
          subheading:
            "We'd love to hear from you. Tell us a little about your pet and what they need, and we'll be in touch to find a time that suits you both.",
        },
        {
          _block: 'richText',
          body: doc(
            heading(2, 'Contact details'),
            paragraph(`Address: ${CONTACT.address}`),
            paragraph(
              'Phone: ',
              text(CONTACT.phone, `tel:+${CONTACT.phoneE164}`),
              ' (call, text or ',
              text('WhatsApp', `https://wa.me/${CONTACT.phoneE164}`),
              ')',
            ),
            paragraph('Email: ', text(CONTACT.email, `mailto:${CONTACT.email}`)),
          ),
        },
        {
          _block: 'form',
          heading: 'Send us a message',
          fields: [
            { label: 'Your name', name: 'name', type: 'text', required: true },
            { label: 'Email address', name: 'email', type: 'email', required: true },
            { label: "Pet's name", name: 'pet-name', type: 'text', required: false },
            {
              label: "Service you're interested in",
              name: 'service',
              type: 'select',
              required: true,
              options: 'Grooming\nUltrasonic teeth cleaning\nReiki\nNot sure yet',
            },
            {
              label: 'Message',
              name: 'message',
              type: 'textarea',
              required: true,
              help: 'Let us know a little about what your pet needs.',
            },
            {
              label: 'I agree that you may keep my message to reply to it.',
              name: 'consent',
              type: 'consent',
              required: true,
            },
          ],
          submitLabel: 'Send message',
          successMessage:
            "Thanks, your message has been sent. We'll be in touch shortly to find a time that suits you and your pet.",
        },
      ],
    },
  },
  {
    key: 'privacy',
    contentType: 'page',
    slug: 'privacy',
    data: {
      title: 'Privacy policy',
      slug: 'privacy',
      seo: {
        metaDescription: "How Law's Paws collects, uses and looks after your personal information.",
        noindex: true,
      },
      body: [
        {
          _block: 'hero',
          _style: { tone: 'light', height: 'compact' },
          heading: 'Privacy policy',
          subheading: 'How we collect, use and look after your personal information.',
        },
        { _block: 'richText', body: policyPending('privacy policy') },
      ],
    },
  },
  {
    key: 'cookiePolicy',
    contentType: 'page',
    slug: 'cookie-policy',
    data: {
      title: 'Cookie policy',
      slug: 'cookie-policy',
      seo: { metaDescription: "How the Law's Paws website uses cookies and browser storage.", noindex: true },
      body: [
        {
          _block: 'hero',
          _style: { tone: 'light', height: 'compact' },
          heading: 'Cookie policy',
          subheading: 'How this website uses cookies and browser storage.',
        },
        { _block: 'richText', body: policyPending('cookie policy') },
      ],
    },
  },
  {
    key: 'navigation',
    contentType: 'navigation',
    slug: 'navigation',
    data: {
      items: [
        { label: 'Home', link: page('home') },
        { label: 'About', link: page('about') },
        { label: 'Gallery', link: page('gallery') },
        { label: 'Contact', link: page('contact') },
      ],
      footerGroups: [
        {
          title: 'Legal',
          links: [
            { label: 'Privacy policy', link: page('privacy') },
            { label: 'Cookie policy', link: page('cookiePolicy') },
          ],
        },
      ],
    },
  },
  {
    key: 'siteSettings',
    contentType: 'siteSettings',
    slug: 'site-settings',
    data: {
      siteName: "Law's Paws",
      organisationName: "Law's Paws Limited",
      logo: asset('logo'),
      favicon: asset('favicon'),
      defaultOgImage: asset('social'),
      contact: { email: CONTACT.email, phone: CONTACT.phone, address: CONTACT.address },
      socialLinks: [
        { network: 'instagram', url: 'https://www.instagram.com/lawspawslimited/' },
        { network: 'facebook', url: 'https://www.facebook.com/profile.php?id=61554416940541' },
        { network: 'tiktok', url: 'https://www.tiktok.com/@laws_paws' },
      ],
    },
  },
  {
    key: 'notFound',
    contentType: 'notFound',
    slug: 'not-found',
    data: {
      title: 'Page not found',
      body: [
        {
          _block: 'richText',
          body: doc(paragraph('There is no page at this address. It may have moved, or the link may be mistyped.')),
        },
        {
          _block: 'cta',
          _style: { tone: 'light' },
          heading: 'Start again from the home page',
          action: { ...page('home'), text: 'Go to the home page' },
        },
      ],
    },
  },
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The entries with each `{ "$asset": "<key>" }` replaced by the media item the field stores, `{ assetId }` (pages
 * use the library's alt text). Throws on a key `ids` does not have, so a missing upload is never published as a gap.
 */
export function withAssets(entries: readonly SeedEntry[], ids: ReadonlyMap<string, string>): SeedEntry[] {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isObject(value)) return value;
    if (typeof value['$asset'] === 'string') {
      const id = ids.get(value['$asset']);
      if (!id) throw new Error(`No uploaded file for "${value['$asset']}".`);
      return { assetId: id };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
  };
  return entries.map((entry) => ({ ...entry, data: walk(entry.data) as Record<string, unknown> }));
}
