# Law's Paws: pilot launch

The pilot client for Gate 2 ([docs/build/15-pilot-launch.md](../build/15-pilot-launch.md)). Law's Paws Limited is a
vegan-run grooming studio for dogs and small animals in Musselburgh. Their old site is the Angular app in
[black-isle-beef/laws-paws](https://github.com/black-isle-beef/laws-paws), on Firebase.

## Scope agreed

|                   |                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages             | Home, About, Gallery, Contact, Privacy policy, Cookie policy, plus the menu, footer, site settings and "page not found"                                                                                                      |
| Kit               | `brochure`                                                                                                                                                                                                                   |
| Extra blocks      | `mediaText` (image and text), `cardGrid` (gallery cards), `badgeList` (qualifications), in `@novan/blocks`                                                                                                                   |
| Site              | [apps/laws-paws-site](../../apps/laws-paws-site), copied from the starter site, branded through design-system tokens                                                                                                         |
| Content           | [tools/migrate/laws-paws.ts](../../tools/migrate/laws-paws.ts), through the Management API                                                                                                                                   |
| Editors           | Hayley (`Hayley@laws-paws.co.uk`), role `editor`                                                                                                                                                                             |
| Not moving        | The grooming-report app (`/admin`, `/report/<token>`, Firestore and Storage). It stays on Firebase at a subdomain, and the new site sends those addresses there (`REPORTS_ORIGIN`, below). Porting it is a separate project. |
| Production domain | **Not chosen yet.** Everything below that needs it is marked _(domain)_.                                                                                                                                                     |
| Launch date       | **Not set.**                                                                                                                                                                                                                 |

## 1. Space and content

On the environment the site will use (staging first, then production), from `apps/laws-paws-site`:

```bash
novan login --api https://api.<domain>
novan space create --name "Law's Paws" --slug laws-paws --save   # writes the space id to novan.json
novan schema push --dry-run && novan schema push                 # brochure types + the three pilot blocks
```

Commit the space id `novan.json` now holds. The header logo is an SVG, so before migrating, as agency staff, open the
space's **Settings** and turn on **Allow SVG uploads** (the migration stops with "SVG images are turned off" otherwise).
Then, from the repository root, with a checkout of the old site:

```bash
git clone https://github.com/black-isle-beef/laws-paws ../laws-paws
npx tsx --tsconfig tools/migrate/tsconfig.json tools/migrate/laws-paws.ts --source ../laws-paws --dry-run
npx tsx --tsconfig tools/migrate/tsconfig.json tools/migrate/laws-paws.ts --source ../laws-paws
```

The script uploads the logos and eight stock photos (folder `website/stock-photos`, credited in each title) and
creates and publishes the pages. Running it again keeps what is there and only adds what is missing. To redo a page
from the script, move it to the bin in the admin first.

Then in the admin, under the space's **Settings**:

- [ ] Site address: the staging host now, the production domain at launch _(domain)_. It also sets `preview_url`
      for the visual editor.
- [ ] Form recipients: `Hayley@laws-paws.co.uk` for the contact form.
- [ ] **Members**: invite Hayley as `editor`.

And the tokens, for the deployment secrets:

```bash
novan token create --name "Website"
novan token create --name "Website preview" --scope preview
```

## 2. Deploy _(domain)_

Follow [docs/ops/add-client-domain.md](../ops/add-client-domain.md) with `laws-paws-site`; the Dockerfile is already
there. In the site's environment file also set:

```bash
echo "REPORTS_ORIGIN=https://$LAWS_PAWS_REPORTS_HOST"
```

Before that, give the Firebase app its subdomain: in the Firebase console, **Hosting > Add custom domain** (e.g.
`reports.laws-paws.co.uk`), add the DNS records it asks for in Cloudflare (DNS only, not proxied, so Firebase can
issue its certificate), and add the subdomain to **Authentication > Settings > Authorised domains**.

## 3. Launch checklist

- [ ] **Redirects.** The pages keep their addresses (`/`, `/about`, `/gallery`, `/contact`, `/privacy`,
      `/cookie-policy`), so the CMS needs no redirects for them. `/report/<token>` and `/admin` answer 301 to the
      reports app: check a real report link sent before the move opens.
- [ ] **Sitemap.** `https://<domain>/sitemap.xml` lists the four public pages (privacy and cookie policy are
      `noindex`). Submit it in Google Search Console _(domain)_.
- [ ] **Analytics.** The old site had none. If the client wants it, set the measurement id in **Site settings** and
      write the cookie policy first.
- [ ] **Uptime.** Better Stack checks for `/health` and the home page _(domain)_.
- [ ] **Backups.** The latest nightly backup of production includes the Law's Paws space ([docs/ops/restore.md](../ops/restore.md)).
- [ ] **Error tracking.** `SENTRY_DSN` is set for the site and a test error reaches Sentry.
- [ ] **Forms.** A test message from the contact page reaches Hayley, and Turnstile lists the domain.
- [ ] **Publish path.** Publishing a change shows on the site within a minute (edge TTL, add-client-domain step 2.4).

## 4. Gate 2 _(domain)_

Observed, not assisted: Hayley signs in, creates a new page from blocks, adds an image with alt text, publishes it
and sees it live on the domain. Record the result here and in the PR that closes the phase.

| Date | Observer | Result | Notes |
| ---- | -------- | ------ | ----- |
|      |          |        |       |

## 5. Hypercare

Two weeks from launch. Every question and problem goes in [laws-paws-feedback.md](laws-paws-feedback.md) and becomes a
backlog item.
