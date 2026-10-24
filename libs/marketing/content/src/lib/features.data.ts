/** `planned` features are labelled as such wherever they appear, so the site never promises what is not built. */
export type FeatureStatus = 'available' | 'planned';

export interface Feature {
  /** Anchor id on /features, linked from the home page. */
  id: string;
  /** Bootstrap Icons class name(s), shown decoratively. */
  icon: string;
  title: string;
  /** One sentence for the home page's highlights. */
  summary: string;
  /** Paragraphs for /features. */
  description: readonly string[];
  /** Short points listed under the description. */
  points: readonly string[];
  status: FeatureStatus;
  /** Shown among the home page's highlights. */
  highlight: boolean;
}

export const features: readonly Feature[] = [
  {
    id: 'visual-editor',
    icon: 'bi bi-pencil-square',
    title: 'Visual page editor',
    summary: 'Edit the real page, see changes as you make them, and publish when it looks right.',
    description: [
      'Our own visual editor shows the live site beside a simple panel of settings. Pick a block on the page, change its words, images or style, and watch the page update.',
      'Preview at phone, tablet and desktop widths before anything goes live.',
    ],
    // TODO(confirm): drag-and-drop reordering in the block outline, or buttons only?
    points: ['Add, reorder and remove blocks', 'Undo, redo and autosaved drafts', 'Phone, tablet and desktop previews'],
    status: 'available',
    highlight: true,
  },
  {
    id: 'structured-content',
    icon: 'bi bi-boxes',
    title: 'Reusable blocks and structured content',
    summary: 'Pages are built from tested blocks, and content is stored as clean, typed data.',
    description: [
      'Each site has its own content model: page types, fields and blocks such as heroes, feature grids, forms and calls to action. Editors fill in fields; the design stays consistent.',
      'Every change is versioned, and pages move from draft to review to published, on a schedule if you like.',
    ],
    points: ['Typed fields with validation', 'Version history and restore', 'Review, approval and scheduled publishing', 'Content in more than one language'],
    status: 'available',
    highlight: true,
  },
  {
    id: 'design-system',
    icon: 'bi bi-palette',
    title: 'Built on the Novan Design System',
    summary: 'Consistent, accessible components on every site, from buttons to cookie banners.',
    description: [
      'Sites and blocks use the Novan Design System, a shared library of components and design tokens. Each client site gets its own look without losing the tested building blocks underneath.',
      'Components are built to WCAG 2.2 AA and checked with automated accessibility tests.',
    ],
    points: ['Shared tokens for colour, type and spacing', 'Keyboard and screen reader support built in', 'Editors choose styles from safe, on-brand options'],
    status: 'available',
    highlight: true,
  },
  {
    id: 'fast-sites',
    icon: 'bi bi-lightning-charge',
    title: 'Fast, search-friendly sites',
    summary: 'Pages are rendered on the server and cached close to visitors, with SEO built in.',
    description: [
      'Client sites are rendered on the server, so visitors and search engines get complete pages straight away. A content delivery network keeps copies near your visitors and refreshes them when you publish.',
      'Every page has fields for its search title, description and social image, and sites get a sitemap, redirects and structured data.',
    ],
    points: ['Server-side rendering', 'Cache refreshed on publish', 'Sitemaps, redirects and canonical links', 'Search title, description and social cards per page'],
    status: 'available',
    highlight: true,
  },
  {
    id: 'media-library',
    icon: 'bi bi-images',
    title: 'Media library',
    summary: 'Upload images and files once and reuse them across the site.',
    description: [
      'A shared library for each site keeps images and documents in one place. Add alternative text once and it travels with the image wherever it is used.',
    ],
    // TODO(confirm): which image formats and size limits to mention.
    points: ['Images and documents in one place', 'Alternative text kept with each image', 'Images resized for the screen they are shown on'],
    status: 'available',
    highlight: false,
  },
  {
    id: 'roles',
    icon: 'bi bi-people',
    title: 'Users, roles and permissions',
    summary: 'Give everyone the access they need and no more.',
    description: [
      'Invite people to a site as an admin, developer, editor, author or viewer. Authors can draft, editors can publish, and viewers can look without changing anything.',
      'An audit log records who changed what, and when.',
    ],
    points: ['Five roles, set per site', 'Review before publishing', 'Audit log of changes'],
    status: 'available',
    highlight: true,
  },
  {
    id: 'security',
    icon: 'bi bi-shield-lock',
    title: 'Secure sign-in and data',
    summary: 'Supabase-backed sign-in, and each client’s content kept apart at the database level.',
    description: [
      'Sign-in is handled by Supabase Auth. Each client’s content lives in its own space, and row-level security in the database stops one space from reading another’s data.',
    ],
    // TODO(confirm): wording about multi-factor sign-in and where data is hosted.
    points: ['Supabase Auth sign-in', 'Row-level security on every table', 'Daily backups'],
    status: 'available',
    highlight: false,
  },
  {
    id: 'headless-api',
    icon: 'bi bi-plug',
    title: 'API for headless use',
    summary: 'Use your content anywhere through a documented API.',
    description: [
      'A NestJS API serves published content as JSON, with preview access for drafts. Use it from your own websites and apps, or use our Angular SDK to render blocks for you.',
      'Webhooks tell other systems when something is published, and the schema can be kept as code in your repository.',
    ],
    points: ['Delivery and preview APIs', 'Angular SDK', 'Webhooks on publish', 'Schema as code with a command-line tool'],
    status: 'available',
    highlight: true,
  },
  {
    id: 'hosting',
    icon: 'bi bi-cloud',
    // TODO(copy): confirm the wording about self-hosting and the managed hosting plans.
    title: 'Self-hosted today, managed hosting planned',
    summary: 'Run Novan CMS on your own infrastructure now; a managed option is on the way.',
    description: [
      'Novan CMS runs today as a self-hosted service. We are planning a managed hosting option, so you can leave the servers to us.',
    ],
    points: ['Container images for each service', 'Managed hosting: planned'],
    status: 'planned',
    highlight: false,
  },
];

/** The three "How it works" steps on the home page. */
export const howItWorks: readonly { title: string; description: string }[] = [
  {
    title: 'We build your site',
    description: 'We design your site on the Novan Design System and set up the pages and blocks you need.',
  },
  {
    title: 'You edit it yourself',
    description: 'Change words, images and whole sections in the visual editor, without waiting on a developer.',
  },
  {
    title: 'Publish with confidence',
    description: 'Preview, ask for a review if you want one, then publish. Your site refreshes in moments.',
  },
];
