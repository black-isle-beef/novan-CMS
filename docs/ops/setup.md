# Setting up an environment

Once for staging (after package 04) and once for production (before the pilot, package 15). About half a day each,
most of it waiting on DNS and approvals. Do staging first and deploy to it before starting production.

Names below are for production; for staging use `novan-staging`, `*.staging.<domain>` and the smaller VPS.

## 1. Supabase project

1. Create the project `novan-prod` in the **London (eu-west-2)** region. Production: **Pro** plan. Save the database
   password in the password manager.
2. **Authentication > URL configuration**: Site URL `https://admin.<domain>`; redirect URLs `https://admin.<domain>/**`.
3. **Authentication > Emails > SMTP**: the same provider as `MAIL_PROVIDER` (Resend or Postmark SMTP), sender
   `no-reply@<domain>`.
4. **Authentication > Multi-factor**: TOTP enabled (agency staff need it for anything privileged).
5. **Authentication > Sign in / Providers**: Google and Microsoft (Azure) with the agency's OAuth clients; callback
   `https://<ref>.supabase.co/auth/v1/callback`.
6. **Authentication > Hooks**: Custom access token hook → Postgres function `public.custom_access_token_hook`. It
   exists once the first deploy has run the migrations; come back and turn it on then.
7. Everything else — tables, policies, the `media` bucket and its policies, queues and cron jobs — comes from
   `supabase/migrations` on the first deploy. Never create or change them in the dashboard.
8. **Project settings > Data API > Settings**: copy the URL and the anon key (variables) and the service-role key
   (secret). **Database > Connect > Session pooler**: copy the URL (`DATABASE_URL`).
9. Production, once a client relies on it: **Database > Backups > Point in time recovery** add-on.
10. **Organization > Usage**: spend cap on; add the ops address to usage alert emails.

## 2. Host

A VPS in London (Hetzner, DigitalOcean, …), Ubuntu LTS, 4 vCPU / 8 GB (staging 2 / 4).

```bash
# As root, once.
apt-get update && apt-get -y upgrade && apt-get -y install unattended-upgrades ufw
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos '' deploy && usermod -aG docker deploy
install -d -o deploy -g deploy -m 750 /opt/novan /opt/novan/certs
# The deploy user's key: generate a pair for GitHub (ssh-keygen -t ed25519 -C novan-deploy), put the public key here.
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
echo '<public key>' > /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys
# SSH by key only.
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh
# Only SSH, and HTTP(S) from Cloudflare: nobody reaches the origin around the CDN, WAF and Turnstile.
ufw default deny incoming && ufw allow OpenSSH
for range in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
  ufw allow proto tcp from "$range" to any port 80,443
done
ufw enable
```

Docker publishes ports around ufw's rules on some setups; check from a machine outside Cloudflare that
`curl -m 5 https://<host ip>` times out. If it answers, add the ranges to the `DOCKER-USER` chain instead.

## 3. Cloudflare

1. Add the platform zone (`<domain>`) if it is not there. DNS: `A api`, `A admin`, `A starter` → host IP, **proxied**.
2. **SSL/TLS**: mode **Full (strict)**; Edge certificates: Always use HTTPS, minimum TLS 1.2.
3. **SSL/TLS > Origin server > Create certificate**: hosts `<domain>`, `*.<domain>` (staging: `*.staging.<domain>`),
   15 years. Copy them to the host, readable by the containers only:
   ```bash
   # On the host, as deploy. The names match NOVAN_DOMAIN.
   nano /opt/novan/certs/<domain>.pem    # the certificate
   nano /opt/novan/certs/<domain>.key    # the private key
   chmod 640 /opt/novan/certs/*
   ```
4. **Caching > Cache rules**: bypass cache for `admin.<domain>` (`/config.js` and the page are `no-cache` anyway) and
   for `api.<domain>` except `/v1/delivery/*` and `/v1/assets/*`, which the API sends cache headers and tags for.
5. **API token** for purging: My profile > API tokens > Create > Custom: Zone > Cache Purge > Purge, zone `<domain>`
   only. → `CLOUDFLARE_API_TOKEN`; the zone's ID → `CLOUDFLARE_ZONE_ID`.
6. **Turnstile**: add a widget for the client hosts → `TURNSTILE_SITE_KEY` (variable), `TURNSTILE_SECRET_KEY`.
7. Production only, **R2**: create the bucket `novan-backups` (EU jurisdiction), no public access. R2 > Manage API
   tokens > Create: Object Read & Write, this bucket only → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; the S3 endpoint
   → `R2_ENDPOINT`.

## 4. GitHub

1. **Settings > Environments**: create `staging` and `production`, and fill in every secret and variable listed in
   [README.md](README.md). `ssh-keyscan <host>` gives `DEPLOY_KNOWN_HOSTS`.
2. `production` only: **Required reviewers** (you, plus one more if there is one); **Deployment branches and tags**:
   selected tags `v*`.
3. **Settings > Actions > General**: Workflow permissions *read repository contents* (the workflows ask for more where
   they need it).
4. Repository variables `NOVAN_STAGING_API_URL` (`https://api.staging.<domain>`) and
   `NOVAN_STAGING_STARTER_SPACE_ID`, and secrets `NOVAN_CI_EMAIL` / `NOVAN_CI_PASSWORD`, for CI's schema-drift job
   (package 19), once staging has a starter space.
5. After the first image push: **Packages > novan-api / novan-admin / novan-starter-site > Package settings**: link
   them to this repository, keep them private.

## 5. Monitoring

1. **Sentry**: two projects, `novan-server` (Node: API, worker, sites; `SENTRY_DSN`) and `novan-admin` (Angular;
   `SENTRY_DSN_ADMIN`). Alerts: a new issue, and more than 10 events in an hour, email you. Releases are the commit SHA
   and environments `staging` / `production`, so filter on those.
2. **Better Stack Uptime**, every 3 minutes from two regions, alerting by email and push:
   - `https://api.<domain>/health` (keyword `"status":"ok"`)
   - `https://admin.<domain>/`
   - each client site's `/health` and home page
   - a **heartbeat** for the nightly backup (period 1 day, grace 2 hours) → `BACKUP_HEARTBEAT_URL`
3. **Better Stack Logs**: a Vector source → `BETTER_STACK_SOURCE_TOKEN`. The next deploy starts the `vector`
   container.
4. Test it: on the host, `docker compose stop starter-site` and wait for the uptime alert, then start it; in Sentry,
   **Settings > Projects > Client keys** has nothing to test with, so instead raise a test error:
   `docker compose exec api node -e "require('@sentry/nestjs').init({dsn:process.env.SENTRY_DSN});require('@sentry/nestjs').captureMessage('test alert');setTimeout(()=>{},2000)"`.
   Tick "Monitoring alerts reach you" in package 20 only once both alerts have arrived.

## 6. First deploy

- Staging: merge to `main` (or re-run the latest green CI run). The Deploy workflow builds every image, runs the
  migrations and ships. Then turn on the access token hook (step 1.6) and create the first organisation and agency
  user (package 03).
- Production: tag a commit that is green on staging (see [deploy.md](deploy.md)), approve, then the same follow-up.
