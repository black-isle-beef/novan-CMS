# Adding a client site and domain

Step 6 of [docs/clients/new-site.md](../clients/new-site.md): the site's app (`apps/<site>`, copied from the starter
site) exists and its space has content. This puts it on the host behind the client's domain. Below, the site is
`acme-site` and its domain `www.acme.co.uk`.

## 1. Code (one PR)

1. **Image.** Copy `apps/starter-site/Dockerfile` to `apps/acme-site/Dockerfile` and replace `starter-site` in it.
2. **Deploy workflow.** In `.github/workflows/deploy.yml`, add the app to `APPS`:
   `APPS: api admin starter-site acme-site`.
3. **Environment file.** In `.github/workflows/deploy-environment.yml`, step *Environment files*: add the variables to
   `env:` and write the file, as for the starter site:
   ```yaml
   ACME_SITE_HOST: ${{ vars.ACME_SITE_HOST }}
   ACME_SITE_DELIVERY_TOKEN: ${{ secrets.ACME_SITE_DELIVERY_TOKEN }}
   ACME_SITE_PREVIEW_TOKEN: ${{ secrets.ACME_SITE_PREVIEW_TOKEN }}
   ```
   ```bash
   {
     echo "SITE_URL=https://$ACME_SITE_HOST"
     echo "NOVAN_DELIVERY_TOKEN=$ACME_SITE_DELIVERY_TOKEN"
     echo "NOVAN_PREVIEW_TOKEN=$ACME_SITE_PREVIEW_TOKEN"
     for name in TURNSTILE_SITE_KEY SENTRY_DSN SENTRY_ENVIRONMENT; do line "$name"; done
   } > out/env/acme-site.env
   ```
   Add `ACME_SITE_HOST` to the `.env` loop, the host to the *Smoke tests* step, and `acme-site.env` to the
   service-role check.
4. **Compose.** In `deploy/compose.yml`, copy the `starter-site` service as `acme-site` with
   `image: ghcr.io/${IMAGE_OWNER}/novan-acme-site:${TAG}` and `env_file: [env/acme-site.env]`.
5. **Caddy.** In `deploy/Caddyfile`, under *Client sites*:
   ```
   {$ACME_SITE_HOST} {
   	import common
   	tls /etc/caddy/certs/acme.co.uk.pem /etc/caddy/certs/acme.co.uk.key
   	reverse_proxy acme-site:4000
   }
   ```
   A host under the platform domain (e.g. a staging preview `acme.staging.<domain>`) uses `import platform_tls`
   instead.

## 2. Cloudflare and the host

1. Add `acme.co.uk` as a zone in the agency's Cloudflare account (the client changes the nameservers at their
   registrar), or, if the client keeps their DNS, use Cloudflare for SaaS custom hostnames on the platform zone.
2. DNS: `www` (and the apex, redirecting to `www` with a redirect rule) → host IP, proxied. SSL/TLS **Full (strict)**.
3. **Origin server > Create certificate** for `acme.co.uk, *.acme.co.uk`; copy to the host as
   `/opt/novan/certs/acme.co.uk.pem` and `.key` (mode 640). Do this before the deploy, or Caddy will not start.
4. Cache purging on publish: the API purges one zone only, the platform zone (`CLOUDFLARE_ZONE_ID`). A site on a
   Cloudflare for SaaS custom hostname of that zone is purged like the starter site. A site in **its own zone is not
   purged**: until the API supports more zones, add a cache rule in that zone with an edge TTL of a minute or two for
   HTML, so a publish shows within that time.
5. Turnstile: add `www.acme.co.uk` to the widget's hostnames.

## 3. GitHub, then deploy

1. In the admin (on that environment): **Settings > API tokens** in the client's space → a delivery and a preview
   token. In the GitHub environment: `ACME_SITE_DELIVERY_TOKEN`, `ACME_SITE_PREVIEW_TOKEN` (secrets),
   `ACME_SITE_HOST` (variable).
2. Merge the PR: staging deploys it. Production: the next release tag.
3. Check `https://www.acme.co.uk/health`, the home page, `/sitemap.xml`, `/robots.txt`, a form, and that publishing a
   change shows on the site (within a minute, or the edge TTL from step 2.4).
4. Monitoring: Better Stack uptime checks for `/health` and the home page.
