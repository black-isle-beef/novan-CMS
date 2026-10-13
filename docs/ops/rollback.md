# Rolling back

Rollback = run the previous images again. The database stays as it is (migrations are backwards compatible: see
[deploy.md](deploy.md#migrations-must-survive-a-rollback)). Target: back to the previous release **within 5 minutes**
of deciding to.

## 1. Find the previous version

- GitHub **Actions > Deploy**: the last green run for that environment before the bad one shows the SHA in its summary.
- Or GHCR: the image tagged with the previous `vX.Y.Z` (production).
- Or the host: `docker image ls ghcr.io/*/novan-api` lists the SHAs still on it (a week's worth are kept).

## 2a. Through GitHub (normal)

**Actions > Deploy > Run workflow**: environment, and the previous full SHA as version. It skips migrations, ships the
images, runs the smoke tests and (production) waits for your approval. About 2–3 minutes.

## 2b. On the host (GitHub is down, or faster)

```bash
ssh deploy@<host>
cd /opt/novan
TAG=<previous sha> docker compose up -d     # the images are still on the host
docker compose ps
curl -s https://api.<domain>/health          # "version" is the previous sha
```

This lasts until the next deploy rewrites `.env`; run 2a afterwards so GitHub's record (`deployed/staging`, the
`:production` image tag) matches what runs.

## 3. Afterwards

- Fix forward on `main`, and release again as normal.
- If the bad release's migration itself is the problem, write a new migration that repairs it. Never edit or delete an
  applied migration, and never restore a backup to undo a migration unless data was lost ([restore.md](restore.md)).

## The drill

Package 20 asks for one before production goes live, and again after any change to the deploy workflow:

1. On the **staging** host, make a broken API image from the running one and start it:
   ```bash
   cd /opt/novan
   owner=$(grep ^IMAGE_OWNER= .env | cut -d= -f2); good=$(grep ^TAG= .env | cut -d= -f2)
   printf 'FROM ghcr.io/%s/novan-api:%s\nCMD ["node", "-e", "process.exit(1)"]\n' "$owner" "$good" \
     | docker build -t "ghcr.io/$owner/novan-api:broken" -
   docker tag "ghcr.io/$owner/novan-admin:$good" "ghcr.io/$owner/novan-admin:broken"
   docker tag "ghcr.io/$owner/novan-starter-site:$good" "ghcr.io/$owner/novan-starter-site:broken"
   TAG=broken docker compose up -d
   ```
2. See it fail: `curl https://api.staging.<domain>/health` answers 502 and the uptime check alerts.
3. Start a timer and roll back with 2a, using `$good` as the version.
4. Record the date and the time it took below; remove the `:broken` images (`docker image rm ...`).

| Date | Environment | Method | Time to healthy |
| --- | --- | --- | --- |
| 2026-10-13 | local copy of the Compose stack | 2b (`TAG=<good> docker compose up -d --wait api`) | 7 s |
