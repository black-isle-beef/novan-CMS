# @novan/cli

The Novan CMS command line: content models and blocks as code, starter kits and seed content. The step-by-step guide for a new client site is `docs/clients/new-site.md`.

```bash
npx nx build novan-cli                  # dist/tools/novan-cli: main.cjs, kits/, block-types.json, package.json
node dist/tools/novan-cli/main.cjs --help
npx nx test novan-cli
```

## Commands

| Command | What it does |
| --- | --- |
| `novan login [--api <url>]` | Device sign-in: approve the printed code in the admin (`/device`); staff then type their authenticator code. The refresh token goes to the OS keychain. |
| `novan logout`, `novan whoami` | Forget the sign-in; show who you are and your spaces. |
| `novan space list`, `novan space create --name --slug [--save]` | List or create spaces (creating needs agency staff). `--save` writes `novan.json`. |
| `novan token create --name [--scope delivery\|preview]` | A Delivery or Preview API token; the secret is printed once. |
| `novan schema pull [--dir]` | Writes the space's content types and block types to `novan/schema/{content-types,block-types}/<apiId>.json`. |
| `novan schema diff [--dir \| --kit] [--exit-code]` | What `push` would change; `--exit-code` exits 1 on differences (CI). |
| `novan schema push [--dir \| --kit] [--dry-run] [--force]` | Makes the space match the files. Deleting types, removing fields and changing field types need `--force`. |
| `novan blocks sync [blocks...] [--dry-run] [--force]` | Updates block types from `@novan/blocks` (`block-types.json`): every block the space has, or the named ones (created when missing). |
| `novan kits`, `novan seed --kit <name> [--no-publish]` | List the starter kits; create and publish a kit's pages. Seeding again adds only what is missing. |

Every command that talks to a space takes `--api`, `--space` and `--env`, which default to `NOVAN_API_URL`, `NOVAN_SPACE` and `NOVAN_ENVIRONMENT`, then the nearest `novan.json`, then (for the API) where you signed in, and `main`.

## Signing in without a browser

| Variable | Use |
| --- | --- |
| `NOVAN_EMAIL`, `NOVAN_PASSWORD` | CI: a password sign-in for an account without a second factor (give it the developer role). |
| `NOVAN_ACCESS_TOKEN` | A Supabase access token, used as-is. |
| `NOVAN_CONFIG_DIR` | Where the profile is kept (default `%APPDATA%\novan` or `~/.config/novan`). |
| `NOVAN_KITS_DIR` | The starter kits (default `kits/` here or above, then the ones shipped with the CLI). |

## Files

- `src/lib/api.ts`: the Management API calls; `session.ts` and `login.ts`: signing in.
- `src/lib/schema-files.ts`, `diff.ts`, `push.ts`: schema as code. Files are the create request with every default filled in, which is also what the API answers, so pulled files round-trip unchanged.
- `src/lib/blocks.ts`: `blocks sync`. `src/lib/kits.ts`, `seed.ts`: starter kits. Seed data is written plainly in the default language; the CLI wraps translated fields in a locale map, gives blocks a `_uid` and resolves `{ "$entry": "<key>" }` to the other entry's id.
- `src/lib/kits.spec.ts` keeps every kit valid: its blocks equal `@novan/blocks`, its seed content passes the same validation as publishing, and the starter site's schema equals the brochure kit's.
