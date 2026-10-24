# Novan CMS — Brochure (Marketing) Site

> Instruction file for Claude Code, referenced from the root `CLAUDE.md`.

## Decisions that override this brief (2026-10-23)

The workspace's conventions win where they conflict with the brief below (§13). These were confirmed with the owner:

| Brief says | Do this instead | Why |
|---|---|---|
| New app `apps/marketing` | Build on the existing **`apps/web`** | `docs/build/00-conventions.md` already names it the marketing site |
| Prerender (SSG) every route | **SSR per request**, long `Cache-Control` so Cloudflare serves cached copies (the starter site's pattern) | Images are built once and promoted by tag (package 20), so config must come from runtime env |
| Login URL from `environment.cmsLoginUrl` | `CMS_LOGIN_URL` from the server environment, passed to the browser with the page | Same reason |
| `POST /api/contact`, class-validator DTO, new table | Reuse the **Forms feature**: a published Contact page with a `form` block in a Novan space, sent through the SDK proxy (`createNovanProxy`) to `POST /v1/delivery/forms/:formUid/submit` | Gives storage, retention, the admin inbox, CSV export, email to recipients, honeypot and rate limits with no new API surface; conventions require Zod and `/v1/...` routes |
| Contact storage: ask | Store **and** email the space's form recipients | Owner's choice |
| Primary CTA: ask | **Book a demo** → `/contact` (enquiry type "demo") | Owner's choice |
| Add charcoal/copper tokens to the DS | Already shipped in DS 2.6.0 (package 23): `data-bs-theme="dark" data-ds-theme="copper"` | — |
| `main#main` | `main#ds-main-content` | The DS header's skip link targets that id |
| DS nav/cookie banner as-is | Upstream fixes in `novan-design-system` (`ds-main-nav` Esc + focus return; `ds-cookie-banner` reopen, labels, manage action, equal prominence) released before use | Owner's choice: fix the DS, don't fork |
| Deployment: not mentioned | In scope: Dockerfile, compose service, Caddy host, CI image, following the starter site | Owner's choice |

---

## 1. Goal

Build the public-facing brochureware site for **Novan CMS**: a set of marketing and legal pages that explain the product, show pricing, capture enquiries, and send existing users to the CMS login. It must look and feel like the CMS (charcoal + brushed copper), be built from **Novan Design System** components, and use a **top navigation bar** from the design system.

### Pages (routes)

| Route | Page | Purpose |
|---|---|---|
| `/` | Home / landing | Hero, value proposition, feature highlights, social proof placeholder, pricing teaser, CTA |
| `/features` | Features | Detailed breakdown of what the CMS offers |
| `/pricing` | Pricing | Plan cards, comparison table, FAQ |
| `/contact` | Contact | Enquiry form + contact details |
| `/cookies` | Cookie policy | Legal |
| `/accessibility` | Accessibility statement | Legal |
| `/privacy` | Privacy policy | Legal |
| `**` | 404 | Branded not-found page with links home |

The **Login** item in the nav goes to the CMS admin login page (see §5).

## 2. Before writing any code

1. **Explore the workspace first.** Identify the Nx workspace layout, existing apps/libs, Angular version, how the CMS admin app is structured, and how the Novan Design System is consumed (npm package vs. workspace lib, import paths, theming mechanism — CSS custom properties / SCSS tokens).
2. **Find the top navigation component** in the Novan Design System (look for names like `nav`, `navbar`, `top-nav`, `header`, `app-bar`). Read its inputs/outputs, slots/content projection, mobile behaviour and a11y handling. Use it as-is; do not build a bespoke nav. If it's missing something essential (e.g. a slot for a right-aligned action), propose a minimal, backwards-compatible change to the design system rather than forking it locally — ask before changing the design system.
3. **Inventory other DS components** to reuse: buttons, cards, grid/container, typography, form fields, accordion, table, badge, footer, alert/toast. Prefer DS components everywhere; only write custom components for marketing-specific sections (hero, feature grid, pricing card), and build those from DS primitives and tokens.
4. Produce a short plan (files to create, libs, routing, open questions) and confirm it before implementing.

## 3. Architecture

- Create a **separate Nx application** for the marketing site, e.g. `apps/marketing` (name to match workspace conventions). Keep it independent of the CMS admin app so it can be deployed and cached separately.
- Shared marketing UI (hero, feature grid, pricing card, CTA band, legal page layout) goes in a lib, e.g. `libs/marketing/ui`. Page components live in the app or in `libs/marketing/feature-*` following existing workspace conventions.
- **Standalone components**, signals where appropriate, `OnPush` change detection, lazy-loaded routes.
- **Rendering: prerender (SSG) all routes** with Angular SSR/prerendering. These pages are static and SEO-critical. Only the contact form submission is dynamic.
- No dependency on the CMS admin app's internals. Shared things (brand tokens, logos, env config) come from shared libs.
- Content (copy, feature list, pricing plans, FAQ) lives in **typed data files** (e.g. `pricing.data.ts`, `features.data.ts`) — not hard-coded in templates — so it can later be driven by Novan CMS itself.

## 4. Brand & theming

- Palette: **charcoal** (primary surfaces/text) with **brushed copper** accents (CTAs, highlights, active nav state, dividers, icons).
- **Use tokens only.** All colours, spacing, radii, shadows and type must come from Novan Design System tokens / CSS custom properties. If charcoal or copper tokens don't yet exist, add them to the design system's token layer (ask first) rather than hard-coding hex values in the marketing app.
- "Brushed copper" effect: implement as a subtle linear-gradient token (e.g. a copper gradient used on primary buttons, headings accents and hairline rules) — keep it restrained; flat copper for small text and icons. Never use the gradient behind body text.
- **Contrast:** every text/background pairing must meet WCAG 2.2 AA (4.5:1 body, 3:1 large text and UI components). Copper on charcoal is often borderline for small text — verify and pick the shade that passes. Document the pairings used.
- Use the Novan CMS **logo files** (not just a text wordmark) in the nav and footer. Locate them in the repo; ask if not found.
- Dark-first design (charcoal), but keep layout readable if a light variant is added later.

## 5. Navigation

Built with the DS top nav component.

- **Left:** Novan CMS logo → `/`
- **Centre/left links:** Home, Features, Pricing, Contact
- **Right:** **Log in** (secondary/ghost style) and **Get started / Book a demo** (primary copper CTA → `/contact` or `/pricing`, confirm which)
- **Login link target:** must come from environment config, not be hard-coded. e.g. `environment.cmsLoginUrl` (local: the admin app's dev URL + `/login`; prod: the real admin domain). It is a normal `<a href>` to a different app, not a `routerLink`.
- Active route styling via `routerLinkActive` with `aria-current="page"`.
- Mobile: use the DS component's collapsed/hamburger behaviour; menu button has `aria-expanded`/`aria-controls`, focus moves sensibly, `Esc` closes, focus returns to the toggle.
- Sticky header is fine; ensure it doesn't cover in-page anchor targets (`scroll-padding-top`).
- Add a **skip link** ("Skip to main content") as the first focusable element.

## 6. Footer

Logo, short tagline, page links (Features, Pricing, Contact), legal links (Privacy, Cookies, Accessibility), **"Cookie settings"** button that reopens the consent manager, copyright line with current year. Use the DS footer if one exists.

## 7. Page content specs

Write realistic placeholder copy in **UK English**, clearly marked with `TODO(copy)` where the owner must confirm facts. Don't invent claims (customer counts, uptime figures, certifications).

### Home `/`
- Hero: headline, subheading (a simple CMS so clients can manage their own sites), primary CTA + secondary CTA ("See features"), product screenshot/illustration placeholder.
- 3–6 feature highlights linking to `/features` anchors.
- "How it works" (3 steps).
- Pricing teaser → `/pricing`.
- Final CTA band.

### Features `/features`
Sections with anchor IDs, each with heading, description, and visual placeholder. Base on the product's actual direction:
- Visual page editor (built in-house, drag-and-drop/block based)
- Reusable content components & structured content
- Built on the Novan Design System (consistent, accessible components)
- Fast, SEO-friendly client sites (server-side rendering)
- Media library
- Users, roles & permissions
- Secure auth & data (Supabase-backed)
- API (NestJS) for headless use
- Self-hosted today, managed hosting option planned — `TODO(copy)` confirm wording
Mark any feature not yet built with `TODO(confirm)`.

### Pricing `/pricing`
- Plans come from `pricing.data.ts` (typed: name, price, billing period, description, features[], highlighted, CTA label/link). **Plan names and prices are placeholders** — `TODO(pricing)`.
- Monthly/annual toggle only if data supports it.
- Prices in **GBP**, state whether VAT is included.
- Comparison table (semantic `<table>`, with `<caption>`, `scope` on headers; ticks have text alternatives).
- FAQ using DS accordion.

### Contact `/contact`
- Fields: name, email, company (optional), enquiry type (select: general / sales / support / demo), message, consent checkbox for being contacted with link to privacy policy.
- DS form components; visible labels; inline errors linked via `aria-describedby`; error summary on submit that receives focus; don't rely on colour alone.
- Reactive forms with validation.
- Submission: POST to a **NestJS API endpoint** (e.g. `POST /api/contact`) — create it if missing, following existing API conventions. Server-side validation (DTO + class-validator), rate limiting, honeypot field for spam (no CAPTCHA by default). Store in Supabase table and/or send email notification — ask which.
- Success and failure states announced via a live region.
- Also show contact email and business details (`TODO(copy)`).

### Legal pages `/cookies`, `/privacy`, `/accessibility`
- Shared legal layout: title, "Last updated" date, table of contents with anchor links, readable measure (~70ch).
- Content written as **UK-focused templates** (UK GDPR, Data Protection Act 2018, PECR for cookies, WCAG 2.2 AA / Public Sector-style accessibility statement structure). Add a visible-in-code `TODO(legal-review)` comment — these must be reviewed by the owner before launch; do not present them as legal advice.
- Cookie policy lists every cookie/storage item actually used by the site in a table (name, purpose, provider, duration, category). Keep this list in a data file shared with the consent manager so they never drift.
- Accessibility statement: conformance status, known issues, how to report problems, contact, date of last test.

## 8. Cookies & consent

- No non-essential cookies/scripts (analytics, embeds) before consent.
- Consent banner: equal-prominence **Accept all** / **Reject all** / **Manage preferences**; categories: strictly necessary (always on), analytics, marketing. Store choice in a first-party cookie; reopenable from footer.
- Banner must be keyboard accessible and not trap focus unexpectedly. Build from DS components.
- Analytics provider: none by default — `TODO(confirm)`.

## 9. SEO & metadata

- Per-route `<title>` and meta description via a small SEO service using Angular `Title`/`Meta`.
- Open Graph + Twitter card tags, canonical URLs, `lang="en-GB"`.
- `sitemap.xml` and `robots.txt` generated at build. Legal pages included in sitemap; 404 excluded.
- JSON-LD: `Organization` and `SoftwareApplication` on home.
- One `<h1>` per page, logical heading order.

## 10. Accessibility (WCAG 2.2 AA minimum)

- Semantic landmarks: `header`, `nav` (with `aria-label`), `main#main`, `footer`.
- Visible focus styles (copper focus ring meeting 3:1), target sizes ≥ 24×24px.
- Respect `prefers-reduced-motion`; no auto-playing motion.
- Images: meaningful `alt` or `alt=""` for decorative.
- On route change, move focus to the page `<h1>` (or main) and announce the new page title.
- Fully usable at 320px wide and 400% zoom; no horizontal scroll.

## 11. Performance

- Lighthouse targets: Performance ≥ 90, Accessibility 100, Best Practices ≥ 95, SEO 100 (mobile).
- Optimised images (`NgOptimizedImage`, modern formats, explicit dimensions), self-hosted fonts with `font-display: swap`, minimal JS for static pages.

## 12. Testing

- **Vitest** unit tests for components, services (SEO, consent) and data shape.
- **axe** accessibility tests for every page and the nav/footer/consent banner (follow the existing pattern in the workspace).
- Tests for: nav renders all links; login link uses the env URL; active state; mobile menu keyboard behaviour; contact form validation and submit states; consent defaults to rejected for non-essential.
- API: unit tests for the contact DTO validation and rate limiting.
- Run lint, tests and a production prerender build before reporting a task done.

## 13. Conventions

- Follow existing workspace lint/format rules, naming, and folder structure — match what's there over anything in this file if they conflict, and say so.
- Small, reviewable commits per page/feature.
- No new third-party UI libraries; the Novan Design System is the UI layer.
- Keep `TODO(copy)`, `TODO(pricing)`, `TODO(legal-review)`, `TODO(confirm)` markers greppable and list outstanding ones in the final summary.

## 14. Suggested build order

1. Workspace exploration + plan (§2) → confirm.
2. App scaffold, routing, env config (`cmsLoginUrl`, `apiBaseUrl`), prerender setup.
3. Brand tokens (charcoal/copper) in DS token layer.
4. Shell: skip link, top nav (DS), footer, 404.
5. Home → Features → Pricing.
6. Contact page + NestJS endpoint.
7. Legal layout + three legal pages + cookie consent.
8. SEO (meta, sitemap, robots, JSON-LD).
9. Tests, a11y audit, Lighthouse pass, TODO summary.

## 15. Open questions to ask the owner (if not answered in the repo)

- Production domains for the marketing site and CMS admin (for `cmsLoginUrl` and canonicals).
- Plan names, prices, billing periods, VAT handling.
- Contact submissions: store in Supabase, email notification, or both? Which inbox?
- Primary CTA wording/target: "Get started", "Book a demo", or "Contact sales"?
- Analytics provider (if any).
- Business/legal entity name, address and ICO registration details for the privacy policy.
