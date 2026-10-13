# Deploying

Staging deploys itself; production deploys from a tag you push and an approval you give. Neither needs SSH or the
dashboard.

## How it works

`.github/workflows/deploy.yml`:

1. **Plan.** A green CI run on a push to `main` → staging. A pushed `v*` tag → production, but only if the commit is on
   `main` and CI passed on it.
2. **Images** (staging). Nx works out which of `api`, `admin` and `starter-site` changed since the last staging deploy
   (git tag `deployed/staging`). Changed apps are built and pushed as `ghcr.io/<owner>/novan-<app>:<sha>`; unchanged
   ones get the new tag on their existing image, so every release has all three images under one SHA.
   Production builds nothing: it checks the SHA's images exist and promotes them.
3. **Deploy** (`deploy-environment.yml`, in the GitHub environment, so production waits for approval here):
   `supabase db push` → environment files and Compose files copied to `/opt/novan` → `docker compose pull && up -d`
   → `deploy/smoke.sh` waits for `/health` to report the new SHA and checks the admin and each site → Cloudflare
   purge of the admin host.
4. **Record.** Tags the images `:staging` or `:production` (and `:vX.Y.Z`), moves `deployed/staging`, and for a tag
   creates the GitHub release with generated notes.

## Every release

1. CI is green on the commit (it must be on `main`).
2. Staging has it: the Deploy run for that commit is green. Smoke-test by hand on staging — sign in, edit a page in
   the visual editor, publish, see it on the starter site — and look at Sentry's `staging` environment for new issues.
3. Tag it and push the tag:
   ```bash
   git fetch origin && git checkout <sha>
   git tag -a v1.4.0 -m "v1.4.0" && git push origin v1.4.0
   ```
   Versions follow the conventional commits since the last tag: `feat` → minor, `fix`/others → patch, `!` → major.
4. In the Deploy run, **Review deployments > production > Approve**. After the deploy, the run creates the GitHub
   release with notes generated from the merged PR titles (conventional commits); tidy them if needed.
5. Watch for 30 minutes: Sentry (`production`, release = the SHA), Better Stack uptime, and the API's logs
   (`docker compose logs -f api worker` on the host, or Better Stack). Anything wrong → [rollback.md](rollback.md).

## Migrations must survive a rollback

A rollback redeploys the previous images and **never** touches the database. So each release's migrations must work
with both the new code and the previous release's code — expand, deploy, contract:

| Change | Release N | Release N+1 (or later) |
| --- | --- | --- |
| Add a column | Add it nullable or with a default; code writes it | Make it `not null` if needed |
| Rename a column | Add the new one, copy in a migration, code writes both and reads the new one | Drop the old one |
| Drop a column or table | Stop using it in code | Drop it |
| New `not null` constraint | Backfill; add the constraint `not valid`; code always sets it | `validate constraint` |
| Change a function's signature | Add the new one alongside | Drop the old one |

Reviewers check this in every PR with a migration. The pgTAP tests run in CI; `supabase db push` refuses to run a
migration twice and stops at the first that fails, leaving the rest unapplied (and the containers not updated).

## Useful on the host

```bash
cd /opt/novan
docker compose ps                         # what runs, and health
docker compose logs -f --tail 100 api     # one service's logs (JSON)
grep TAG .env                             # the SHA that runs
docker compose exec api wget -qO- http://127.0.0.1:3000/health
```

Never edit files in `/opt/novan` by hand except `certs/`: the next deploy overwrites them. Change the workflow or the
GitHub environment instead.
