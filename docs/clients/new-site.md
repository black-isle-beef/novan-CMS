# New client site

How to go from "we have a new client" to a live site they can edit, using the Novan CLI and a starter kit. Target: **under one working day**, most of it spent on the client's content and design, not on setup.

You need: agency staff access to the admin (with your authenticator app), Node 24, a clone of this repository, and the client's name, domain and logo.

| Step | What | Time |
| --- | --- | --- |
| 1 | Sign in and create the space | 5 min |
| 2 | Push the kit's content model | 2 min |
| 3 | Seed the kit's pages | 2 min |
| 4 | Copy the starter site | 15 min |
| 5 | Tokens, domain and settings | 30 min |
| 6 | Deploy | 30 min |
| 7 | Hand over | 1 hour |

Steps 1 to 3 need nothing but the CLI: no admin screens.

## 0. Choose a kit

```bash
npx nx build novan-cli          # once per checkout; the CLI is then dist/tools/novan-cli/main.cjs
alias novan="node $PWD/dist/tools/novan-cli/main.cjs"   # PowerShell: function novan { node "$PWD/dist/tools/novan-cli/main.cjs" @args }
novan kits
```

| Kit | Pages | Extra |
| --- | --- | --- |
| `brochure` | Home, About, Services, Contact (with a form), menu, footer, site settings, page not found | The six core blocks |
| `blog` | The brochure pages, plus Blog (`/blog`) and three sample posts under `/blog/` | `post` content type, `listing` block, RSS feed at `/rss.xml` |
| `portfolio` | The brochure pages, plus Our work (`/work`) and three sample projects under `/work/` | `project` content type, `listing` block |

Each kit is a folder in `kits/`: `schema/` (content types and block types as JSON, one file each), `seed.json` (the pages) and `kit.json`.

## 1. Sign in and create the space

```bash
novan login --api https://api.<staging or production domain>
```

The CLI opens the admin's **Sign in to the Novan CLI** page and prints a code. Check the page shows the same code, choose **Approve sign-in**, then type the six-digit code from your authenticator app into the terminal. The sign-in is kept in your operating system's keychain; `novan logout` removes it.

```bash
mkdir ../acme-site && cd ../acme-site        # where the client's site will live (step 4)
novan space create --name "Acme Ltd" --slug acme-ltd --save
```

`--save` writes the API address and space id to `novan.json` here, so the next commands need no flags. Otherwise pass `--space <id>` (or set `NOVAN_SPACE`).

## 2. Push the kit's content model

```bash
novan schema push --kit blog --dry-run     # shows what it will create
novan schema push --kit blog
novan schema diff --kit blog               # "The space matches ..."
```

`schema push` makes the space match the files: it creates and updates content types and block types. It refuses to delete a type, remove a field or change a field's type unless you add `--force`, and the API still refuses a change that would make existing pages invalid unless forced.

## 3. Seed the kit's pages

```bash
novan seed --kit blog
```

Creates and publishes the kit's pages, menu, footer, site settings and "page not found" content, with links between them. Running it again only adds what is missing; pages that exist are left alone. Add `--no-publish` to leave everything as drafts.

## 4. Copy the starter site

Copy `apps/starter-site` into the client's repository (or a new app folder in this monorepo, e.g. `apps/acme-site`, renaming the project in `project.json`). It renders every kit: the blocks come from `@novan/blocks`, and the RSS route answers 404 for spaces without a blog.

Then make its schema files the space's, so code review sees every later model change:

```bash
novan schema pull          # writes novan/schema/ from the space; commit it with novan.json
```

In `novan.json` keep `apiUrl`, `space` and `schemaDir`. Brand the site in `src/styles.scss` (design-system tokens only) and replace `public/favicon.ico`.

## 5. Tokens, domain and settings

```bash
novan token create --name "Website"                    # delivery token: published content
novan token create --name "Website preview" --scope preview   # preview token: drafts, for the visual editor
```

Each secret is printed once. Put them in the site's deployment secrets as `NOVAN_DELIVERY_TOKEN` and `NOVAN_PREVIEW_TOKEN`, with `NOVAN_API_URL`, `SITE_URL` (`https://www.acme.example`) and `TURNSTILE_SITE_KEY` (see `.env.example`, "Client sites").

In the admin, under the space's **Settings**: set the site address (it opens pages and the visual editor), the form recipients, and the languages if the site has more than one. In **Site settings** (content), replace the placeholder name, organisation, contact details and logo.

## 6. Deploy

Follow `docs/build/20-deployment.md`: add the site's container and host block, point the client's DNS at Cloudflare, and deploy. Check `/health`, the home page, `/sitemap.xml`, and for the blog kit `/rss.xml`.

## 7. Hand over

- Invite the client's editors (admin, **Members**); they choose their own passwords.
- Walk them through editing and publishing one page in the visual editor.
- Replace or delete the sample posts or projects together.

## Keeping code and model in sync

The site's `novan/schema/` is the content model's source of truth. To change it:

1. Edit the JSON (or make the change in the admin on staging and `novan schema pull`).
2. `novan schema diff` against staging, then `novan schema push`, in the same PR as the code that needs it.
3. After `@novan/blocks` changes a block (fields, style options, preview image), `novan blocks sync` updates the block types each space already has; name a block (`novan blocks sync listing`) to add one.

CI runs `novan schema diff --exit-code` for the starter site against the staging starter space (`schema-drift` job in `.github/workflows/ci.yml`), so a PR whose schema files and staging differ fails. It needs the repository variables `NOVAN_STAGING_API_URL` and `NOVAN_STAGING_STARTER_SPACE_ID` and the secrets `NOVAN_CI_EMAIL` and `NOVAN_CI_PASSWORD`: a staging account with the **developer** role in that space and no second factor (`novan` signs in with email and password when both are set).
