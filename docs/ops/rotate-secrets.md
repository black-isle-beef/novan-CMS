# Rotating secrets

When a secret may have leaked, when someone with access leaves, and once a year for everything (put the date in the
table at the end). Each secret lives in one place — the GitHub environment ([README.md](README.md)) — and reaches the
host on the next deploy, so the pattern is always: **make the new one, update GitHub, redeploy, revoke the old one.**

Redeploy without a code change: **Actions > Deploy > Run workflow**, the environment, and the SHA that runs now
(`/health` shows it). Do staging first, then production.

| Secret | Make a new one | Revoke the old one | Notes |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` (and JWT secret) | Supabase **Project settings > API keys**: with asymmetric signing keys, create a new secret key; with the legacy JWT secret, rotating it changes the anon key too | Delete or revoke the old key after the deploy | Legacy JWT rotation signs everyone out and needs `SUPABASE_ANON_KEY` updated in the same deploy |
| `SUPABASE_DB_PASSWORD` / `DATABASE_URL` | **Database > Settings > Reset password** | Immediate: the old one stops working | Update both secrets first, reset, then redeploy at once; the API is down in between |
| `SUPABASE_ACCESS_TOKEN` | Supabase account > Access tokens | Delete the old token | Only migrations use it |
| `PREVIEW_SIGNING_SECRET` | `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"` | — | Open preview links stop working; editors reopen them |
| `CLOUDFLARE_API_TOKEN` | Cloudflare **My profile > API tokens > Roll** | Rolling revokes the old value | |
| `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN` | Provider dashboard | Delete the old key | Also the SMTP password in Supabase auth settings if it is the same key |
| `TURNSTILE_SECRET_KEY` | Cloudflare **Turnstile > widget > Rotate secret key** | Cloudflare keeps the old one valid for 2 hours | |
| Delivery / preview tokens of a site | Admin, **Settings > API tokens**: create a new one | Revoke the old one after the deploy | Per site |
| `SENTRY_DSN` / `SENTRY_DSN_ADMIN` | Sentry **Project > Client keys**: new key | Disable the old key | DSNs are not really secret, but rotate them if abused |
| `DEPLOY_SSH_KEY` | `ssh-keygen -t ed25519 -C novan-deploy`; add the public key to `/home/deploy/.ssh/authorized_keys` | Remove the old public key line | Check a deploy works before removing the old key |
| `DEPLOY_KNOWN_HOSTS` | Only if the host is rebuilt: `ssh-keyscan <host>` | — | |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 **Manage API tokens**: new token, same scope | Delete the old token | Run **Backup** by hand to check |
| `BETTER_STACK_SOURCE_TOKEN` | Better Stack source settings | — | |
| Origin certificates (`/opt/novan/certs`) | Cloudflare **Origin server > Create certificate** | Revoke the old one there | Copy to the host, `docker compose restart caddy` |

Also when rotating yearly: refresh the Cloudflare IP ranges in `deploy/Caddyfile` (`trusted_proxies`) and in the
host firewall from <https://www.cloudflare.com/ips/>.

If a secret **did** leak: rotate it first, then check its trail — Supabase logs for the service-role key or database,
Cloudflare audit log, the mail provider's sending log — and follow [incident.md](incident.md).

| Date | What | Who |
| --- | --- | --- |
| | | |
