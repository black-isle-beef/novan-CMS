# The Novan CMS marketing site (`apps/web`)

The public site for Novan CMS itself: Home, Features, Pricing, Contact, the three legal pages and a branded 404. It is built from the Novan Design System on the Charcoal & Copper theme, like the admin. The brief and the decisions behind it are in `docs/claude/brochure-site.md`.

| Piece | Where |
| --- | --- |
| Pages, layout, SEO, server | `apps/web` |
| Copy, features, prices, FAQ, legal text, cookie register | `libs/marketing/content` (typed data, ready to come from the CMS later) |
| Hero, feature grid, pricing card, CTA band, legal layout, consent banner | `libs/marketing/ui` |
| End-to-end and axe tests | `apps/web-e2e` |

## Run it

```powershell
npx nx serve web          # http://localhost:4100, with a placeholder contact form (apps/web/.env.serve)
npx nx test web; npx nx test marketing-ui; npx nx test marketing-content
npx nx e2e web-e2e        # needs no API or database: the contact tests answer for the API
npx nx build web          # production server in dist/apps/web; run it with NG_ALLOWED_HOSTS=localhost
```

Pages are rendered on the server for every request and kept by Cloudflare for an hour (`apps/web/src/server/cache-policy.ts`); each deploy purges them. They are the same for every visitor: the cookie banner opens in the browser only.

## Settings

All are runtime environment variables, so one image serves staging and production. See `.env.example` and `docs/ops/README.md`.

| Variable | Used for |
| --- | --- |
| `MARKETING_SITE_URL` | Canonical links, social cards, `sitemap.xml`, `robots.txt`, structured data |
| `CMS_LOGIN_URL` | The header's **Sign in** link (default: `ADMIN_URL` + `/sign-in`) |
| `MARKETING_CONTACT_ENTRY_ID`, `MARKETING_CONTACT_FORM_UID`, `MARKETING_DELIVERY_TOKEN` | Where enquiries go (below). Without all three, the contact page offers email only |

## Setting up the contact form

Enquiries use the CMS's own Forms feature: they are kept in the Forms inbox of a **Novan** space, emailed to that space's form recipients, kept for the space's retention period, and protected by the honeypot and rate limits. Nothing is stored by the marketing site itself.

In each environment (staging, then production):

1. Create a space for Novan Web Services (or use the existing one), with the `form` block type (the brochure kit has it).
2. Publish a page called Contact with a `form` block whose fields are exactly these. The site sends these names, and the API rejects anything else:

   | Label | Name | Type | Must be filled in | Choices |
   | --- | --- | --- | --- | --- |
   | Your name | `name` | Short text | Yes | |
   | Email address | `email` | Email address | Yes | |
   | Company | `company` | Short text | No | |
   | What is your enquiry about? | `enquiry` | Choice from a list | Yes | `General question`, `Sales`, `Support`, `Book a demo` (one per line, exactly as written) |
   | Your message | `message` | Long text | Yes | |
   | I agree to Novan Web Services contacting me about this enquiry | `consent` | Consent | Yes | |

   The site's own copy of these lives in `libs/marketing/content/src/lib/contact.data.ts`; change both together.
3. Settings > Forms: add the recipients who should hear about enquiries.
4. Settings > API tokens: create a delivery token.
5. Set the GitHub environment's `MARKETING_CONTACT_ENTRY_ID` (the Contact page's id), `MARKETING_CONTACT_FORM_UID` (the form block's id) and `MARKETING_DELIVERY_TOKEN` (secret), then deploy.

## Hosting

- `MARKETING_HOST` (e.g. `www.novan.example`) is served by the `web` container through Caddy (`deploy/Caddyfile`). The platform's wildcard origin certificate covers it.
- Send the bare domain to it with a Cloudflare redirect rule (301 to `https://www.<domain>/$1`).
- The smoke tests check `/health` and the home page after every deploy.

## Cookies

The site sets one cookie, `novan_consent` (strictly necessary: it remembers the visitor's choice for 6 months). Nothing optional runs until a visitor accepts it. The cookie policy's table and the consent manager both read `libs/marketing/content/src/lib/cookies.data.ts`. **Add an entry there before adding anything that stores data in the browser**, such as analytics, and gate it with `ConsentService.allows('analytics')`.

## Colour pairings (WCAG 2.2 AA)

From the design system's copper theme, with the contrast checked in package 23 and by axe in the e2e tests:

| Text or control | On | Ratio |
| --- | --- | --- |
| Body text, white | Canvas `#262626` / surface `#333333` | 15.1:1 / 12.6:1 |
| Muted text, Neutral 300 | Canvas / surface | 6.0:1 or better |
| Solid copper (links, eyebrows, icons, focus ring) | Canvas / surface | 6.0:1 / 5.0:1. Never as text on the raised surface (4.3:1) |
| Charcoal 950 text | Brushed or solid copper (buttons, step numbers, "Most popular") | 4.8:1 or better |
| Error text, Rose 100 | Canvas | Passes; errors are also written out, with an "Error:" prefix for screen readers |

Under `prefers-contrast: more` and forced colours, brushed copper falls back to solid copper with a border, and the logo keeps its charcoal backing.

## Before launch

Search the code for the markers and resolve each one: `TODO(copy)`, `TODO(pricing)`, `TODO(legal-review)` and `TODO(confirm)`. The legal pages are templates and must be reviewed; they are not legal advice.
