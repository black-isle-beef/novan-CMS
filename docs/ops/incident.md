# Incident checklist

For anything a client would notice: a site or the admin down, publishing broken, data wrong or exposed.

## First 15 minutes

1. **Note the time** and start a running log (a GitHub issue labelled `incident`, comments as you go).
2. **How bad?** Which hosts are affected, all clients or one, reads or writes, is data exposed?
3. **What changed?** The last Deploy run (Actions), Supabase status (<https://status.supabase.com>), Cloudflare status
   (<https://www.cloudflarestatus.com>), the host (`docker compose ps`, `df -h`, `free -m`).
4. **Look:** Sentry (production, newest issues), Better Stack logs, `docker compose logs --tail 200 api worker caddy`.
5. **Stop the harm, then fix:**
   - A release broke it → [rollback.md](rollback.md). Don't debug forward while clients are down.
   - A container is unhealthy → `docker compose restart <service>`; the restart policy brings it back on reboot.
   - The host is gone → a new VPS per [setup.md](setup.md) step 2, the certificates, `DEPLOY_HOST` /
     `DEPLOY_KNOWN_HOSTS` updated, and a Deploy run with the live SHA. About 30 minutes; sites served from
     Cloudflare's cache keep working meanwhile.
   - Data lost or corrupted → [restore.md](restore.md); Supabase's own backups and PITR first.
   - A secret leaked → [rotate-secrets.md](rotate-secrets.md) now, investigation after.
6. **Tell clients** whose sites are affected, if it lasts more than 15 minutes or touches their data.

## Data exposure

If data from one tenant may have reached another, or personal data (form submissions, users) left the system:

1. Contain: take the route or feature offline (rollback, or `docker compose stop` of the site), rotate exposed
   secrets.
2. Preserve evidence: don't delete logs; export the Supabase and Better Stack logs for the window.
3. Within 72 hours of becoming aware, decide with the client (the controller) whether the ICO must be told (UK GDPR,
   Article 33). Keep a record either way.
4. Add a pgTAP test that reproduces it before fixing (package 03's cross-tenant tests are the model).

## Afterwards (within a week)

- A short write-up in the incident issue: timeline, cause, what stopped it, what would have caught it sooner.
- Follow-up issues for each fix: a test, an alert, a runbook change.
- Update the runbook that was missing or wrong.
