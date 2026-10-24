# Operations

How Novan runs on staging and production (package 20, `docs/build/20-deployment.md`).

| Runbook | When |
| --- | --- |
| [setup.md](setup.md) | Once per environment: Supabase, host, Cloudflare, GitHub, monitoring |
| [deploy.md](deploy.md) | Every release |
| [rollback.md](rollback.md) | A release is broken |
| [restore.md](restore.md) | Data is lost or corrupted, and the monthly restore drill |
| [rotate-secrets.md](rotate-secrets.md) | A secret leaks, someone leaves, or once a year |
| [add-client-domain.md](add-client-domain.md) | A new client site goes live |
| [incident.md](incident.md) | Something is down or wrong in production |

## The shape

```
            Cloudflare (DNS, proxy, cache, Turnstile)
                              │ HTTPS, origin certificate
┌─ VPS (Docker Compose, /opt/novan) ─────────────────────────────────┐
│  caddy :80/:443 ──┬── api :3000 ───────┐                            │
│                   ├── admin :8080      ├──► Supabase (London):      │
│                   └── <site> :4000 ──► api   Postgres, Auth,        │
│  worker (same image as api, --worker) ─┘     Storage, Queues        │
│  vector (logs → Better Stack, optional)                             │
└─────────────────────────────────────────────────────────────────────┘
```

| | Staging | Production |
| --- | --- | --- |
| Supabase | `novan-staging`, London | `novan-prod`, London, Pro (daily backups, image transformations); PITR once clients rely on it |
| Host | VPS, 2 vCPU / 4 GB | Separate VPS, 4 vCPU / 8 GB |
| Deployed from | Every green CI run on `main` | A `vX.Y.Z` tag, after approval |
| Images | `ghcr.io/<owner>/novan-{api,admin,starter-site}:<commit sha>`, plus `:staging` | The same images, plus `:production` and `:vX.Y.Z` |

## Where things are

| What | Where |
| --- | --- |
| Images | `apps/api/Dockerfile` (API and worker), `apps/admin/Dockerfile` (static files in Caddy), `apps/starter-site/Dockerfile` |
| Host files | `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/vector.yaml`; on the host in `/opt/novan` with `.env`, `env/*.env` (written by each deploy) and `certs/` (by hand) |
| Workflows | `.github/workflows/deploy.yml` (plan, build, record), `deploy-environment.yml` (migrate, ship, smoke test), `backup.yml` (nightly), `restore-drill.yml` (monthly), `keep-alive.yml` (daily ping so free-plan Supabase projects never pause) |
| Scripts | `deploy/smoke.sh`, `deploy/restore-drill.sh` |

## Settings each environment needs

GitHub **Settings > Environments > staging / production**. Secrets are encrypted and never printed; variables are
plain and public to anyone with repository access, so only public values go there.

| Secret | Used by | Notes |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | migrations | Personal access token of an account in the Supabase org |
| `SUPABASE_PROJECT_REF` | migrations | |
| `SUPABASE_DB_PASSWORD` | migrations | |
| `DATABASE_URL` | api, worker, backup | Session pooler URL (`…pooler.supabase.com:5432`): IPv4, so GitHub runners reach it too |
| `SUPABASE_SERVICE_ROLE_KEY` | api, worker | Only ever in `env/api.env` on the host |
| `SUPABASE_JWT_SECRET` | api, worker | Only for the legacy symmetric JWT secret; leave unset with asymmetric signing keys (JWKS is set from `SUPABASE_URL`) |
| `PREVIEW_SIGNING_SECRET` | api | 32+ random characters |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` | api (purge on publish), deploy (purge admin) | Token: Zone > Cache Purge on the platform zone only |
| `RESEND_API_KEY` or `POSTMARK_SERVER_TOKEN` | api, worker | With `MAIL_PROVIDER` |
| `TURNSTILE_SECRET_KEY` | api | |
| `SCHEMA_GITHUB_TOKEN` | api | Optional. Fine-grained GitHub token, **Contents: read-only** on the agency's site repos only, for Schema > Set up from GitHub. Unset: public repos only |
| `STARTER_SITE_DELIVERY_TOKEN`, `STARTER_SITE_PREVIEW_TOKEN` | starter site | From the admin, Settings > API tokens, in that environment's starter space |
| `MARKETING_DELIVERY_TOKEN` | marketing site | Delivery token of that environment's Novan space, used only to send enquiries (docs/clients/marketing-site.md) |
| `SENTRY_DSN` | api, worker, sites | DSN of the `novan-server` Sentry project |
| `BETTER_STACK_SOURCE_TOKEN` | vector | Optional: without it, logs stay on the host only |
| `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | deploy | Host address, private key of the `deploy` user, `ssh-keyscan <host>` output |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | backup, restore drill (production only) | R2 API token: Object Read & Write on the backup bucket only |
| `BACKUP_HEARTBEAT_URL` | backup (production only) | Better Stack heartbeat; optional |

| Variable | Example |
| --- | --- |
| `NOVAN_DOMAIN` | `novan.example` (names the origin certificate files) |
| `API_HOST`, `ADMIN_HOST`, `STARTER_SITE_HOST` | `api.novan.example`, `admin.novan.example`, `starter.novan.example` (staging: `api.staging.novan.example`, …) |
| `MARKETING_HOST` | `www.novan.example` (staging: `www.staging.novan.example`): the marketing site, `apps/web` |
| `MARKETING_CONTACT_ENTRY_ID`, `MARKETING_CONTACT_FORM_UID` | The Novan space's published Contact page and its `form` block (docs/clients/marketing-site.md). Unset: the contact page offers email only |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Public: the admin sends them to every browser |
| `SUPABASE_IMAGE_TRANSFORMS` | `true` on Pro |
| `MAIL_PROVIDER`, `MAIL_FROM` | `resend`, `Novan CMS <no-reply@novan.example>` |
| `JOBS_ALERT_EMAILS` | `ops@novan.example` |
| `TURNSTILE_SITE_KEY` | Public |
| `SENTRY_DSN_ADMIN` | DSN of the `novan-admin` Sentry project (public: it is in the browser) |
| `DEPLOY_USER` | `deploy` (the default) |
| `R2_ENDPOINT`, `R2_BACKUP_BUCKET` | `https://<account id>.r2.cloudflarestorage.com`, `novan-backups` (production only) |
