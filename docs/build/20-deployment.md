# 20 — Deployment, environments and operations

**Phase:** set up staging after 04, production before 15, then use on every release · **Estimate:** 3 days initial setup

## Goal

Repeatable, low-maintenance deployments of the Novan API, worker, admin and client sites to staging and production, with database migrations, backups, monitoring and rollback.

## Target setup

| Piece | Staging | Production |
| --- | --- | --- |
| Supabase | Project `novan-staging`, London region, free or Pro | Project `novan-prod`, London region, **Pro** (daily backups, no pausing, image transformations); PITR add-on once clients rely on it |
| Host | One small VPS (2 vCPU, 4 GB) with Docker Compose and Caddy | Same shape, separate VPS (4 vCPU, 8 GB) |
| Containers | `api`, `worker`, `admin` (static files served by Caddy), `starter-site` / client sites (Node SSR) | Same |
| Edge | Cloudflare (proxied DNS, cache rules, Turnstile) | Same, separate zone per client domain or one zone with custom hostnames |
| Registry | GitHub Container Registry (`ghcr.io/<org>/novan-*`) | Same images, promoted by tag |

A self-hosted PaaS (Coolify or Dokploy) on the VPS is an acceptable replacement for hand-written Compose + Caddy if you prefer a UI; keep the same containers and env vars.

## Tasks

### Initial setup

1. Dockerfiles (multi-stage, Node 24 alpine, non-root, healthchecks): `apps/api/Dockerfile` (also runs the worker with `--worker`), `apps/admin/Dockerfile` (builds static files into a Caddy image), site Dockerfile from 10.
2. `deploy/compose.yml` and `deploy/Caddyfile`: TLS via Caddy (or Cloudflare origin certificates), `api.<domain>`, `admin.<domain>`, one host block per client site; containers on an internal network; only Caddy exposed.
3. Supabase projects: create staging and production in the London region; set auth URLs, SMTP, MFA, Google/Microsoft providers; enable the custom access token hook; create the `media` bucket and policies via migrations (never by hand).
4. Secrets: GitHub Environments `staging` and `production` holding `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `DEPLOY_SSH_KEY`, `DEPLOY_HOST`. Server `.env` files written by the deploy job, mode 600.
5. Workflow `.github/workflows/deploy.yml`:
   - On push to `main` → staging; on tag `v*` → production (requires manual approval on the `production` environment).
   - Steps: build and push affected images tagged with the commit SHA → `supabase link --project-ref $REF` → `supabase db push` (migrations) → SSH to host, `docker compose pull && docker compose up -d` → wait for `/health` → run smoke tests → purge Cloudflare cache for admin assets.
   - Migrations must be backwards compatible with the previous release (expand → deploy → contract) so a rollback of containers never needs a database rollback.
6. Monitoring: Sentry for api, worker, admin and sites (release = commit SHA); uptime checks (Better Stack or UptimeRobot) on `/health` endpoints and each client homepage; structured JSON logs shipped from Docker (Better Stack/Grafana Loki); Supabase usage alerts.
7. Backups beyond Supabase: nightly `pg_dump` of production to off-site object storage (Cloudflare R2) with 30-day retention, and a monthly restore drill into a scratch project, documented in `docs/ops/restore.md`.
8. Runbooks in `docs/ops/`: deploy, rollback, restore, rotate secrets, add a client domain, incident checklist.

### Every release

1. CI green on the commit being released.
2. Staging deployed from `main` and smoke-tested (sign in, edit page in visual editor, publish, see it live).
3. Tag `vX.Y.Z`, write release notes from conventional commits.
4. Approve production deploy; watch Sentry and uptime for 30 minutes.
5. Rollback = redeploy previous image tag (`docker compose` with `TAG=<previous>`); migrations stay.

## Verify

- Staging deploy from a merged PR completes without manual steps.
- Rollback drill: deploy a deliberately broken API image to staging, roll back in under 5 minutes.
- Restore drill: restore last night's dump into a scratch project and run pgTAP tests against it.

## Definition of done

- [ ] Staging auto-deploys from `main`
- [ ] Production deploys from tags with approval
- [ ] Monitoring alerts reach you (test alert received)
- [ ] Rollback and restore drills done and documented
