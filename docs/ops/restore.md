# Backups and restoring

## What is backed up

| Backup | What | Kept | Restore with |
| --- | --- | --- | --- |
| Supabase daily (Pro) | The whole database | 7 days | Dashboard: **Database > Backups** |
| Supabase PITR (add-on, once clients rely on it) | The whole database, to the second | 7+ days | Dashboard |
| Nightly off-site (`.github/workflows/backup.yml`, 02:30 UTC) | Roles, schema and data of every table, dumped with the Supabase CLI | 30 days, Cloudflare R2 `novan-backups/postgres/` | This page |

The off-site backup is for losing the Supabase project or account, or needing something older than Supabase keeps.

**Not in any database backup:** files in Supabase Storage (the `media` bucket) — the database keeps their rows, not
their bytes; queued background jobs (Supabase Queues) — webhooks and purges in flight when the backup ran are not
re-sent; and project settings (auth providers, SMTP, hooks — see [setup.md](setup.md)).

Each night's object is `novan-prod-<UTC time>.tar.gz` with `roles.sql`, `schema.sql` and `data.sql`, plus a
`.sha256` next to it. A failed backup fails its GitHub run (email) and misses its Better Stack heartbeat (alert).

## How a restore works

The schema comes from `supabase/migrations`, exactly as every deploy applies it, and only the **data** from the
backup. A restored `schema.sql` would pick up a fresh project's default grants to `anon` and `authenticated` (which
our migrations revoke) and would miss what the migrations add outside `public` (cron jobs, realtime policies); the
restore drill caught exactly that. `schema.sql` is kept to compare against the migrations, not to restore from.

Use the migrations of the release that was live when the backup was taken (`git checkout vX.Y.Z -- supabase`): a
later migration may have changed a table the data no longer fits.

`deploy/restore-drill.sh <backup.tar.gz> <superuser url>` empties every table the backup has rows for and loads the
data with triggers off, then runs the pgTAP tests. Use it for the drill and for a real restore alike.

## The monthly drill

`.github/workflows/restore-drill.yml` runs on the 1st of each month (and by hand from **Actions**): it downloads the
newest backup, starts Supabase on the runner with the live release's migrations and no seed, restores, prints row
counts, and runs every pgTAP test against the restored data. A red run is an incident: last night's backup could not
be restored.

Record each run (the drill's summary shows the backup and the counts):

| Date | Backup | Result |
| --- | --- | --- |
| 2026-10-13 | Local database, dumped as `backup.yml` does | Restored 66 tables in 1 s; 18 pgTAP files, 501 tests pass |

## A real restore

Decide first: Supabase's own backups (dashboard, minutes, nothing to rebuild) are the right tool unless the project
itself is gone or the data needed is older than they keep.

### Into a new Supabase project (the project or account is lost)

1. Create a project as in [setup.md](setup.md) step 1, in London. Note the ref and password.
2. Apply the live release's migrations:
   ```bash
   git checkout vX.Y.Z
   supabase link --project-ref <new ref> && supabase db push
   ```
3. Download the backup and check it:
   ```bash
   aws s3 cp --endpoint-url "$R2_ENDPOINT" s3://novan-backups/postgres/<name>.tar.gz .
   aws s3 cp --endpoint-url "$R2_ENDPOINT" s3://novan-backups/postgres/<name>.tar.gz.sha256 .
   ```
4. Restore. Hosted projects have no superuser; `postgres` can write `public` but may be refused on some `auth` or
   `storage` tables. Try the script with the session pooler URL; if it stops on permissions for a Supabase-owned
   table, restore that schema's rows with Supabase support's help, or move users by inviting them again.
   ```bash
   deploy/restore-drill.sh <name>.tar.gz "postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres"
   ```
   The pgTAP tests at the end create and roll back their own fixtures; they leave nothing behind.
5. Point the environment at the new project: update `SUPABASE_*` and `DATABASE_URL` in the GitHub environment
   ([README.md](README.md)), redo the auth settings, and deploy (Actions > Deploy > Run workflow with the live SHA).
6. Media: re-upload from wherever the originals are; rows whose files are missing show as broken in the media library.

### Into staging or production in place

Don't. Restore into a new project, check it, then switch the environment over (step 5). Restoring over a live
database deletes everything written since the backup.

## Restoring one space's content model

When only a space's content types and blocks are wrong (someone changed them in the admin, or a push went wrong), the
site's repo is the copy to go back to; no database restore is needed. As agency staff: **Schema > Set up from GitHub**,
the site's repo and the release tag that was live, **Check**, then **Restore** and type the space's short name. It
does what `novan schema push --force` does: types are deleted and fields removed or retyped to match the repo, and
content of a deleted content type is deleted with it, so read the list of changes before restoring. Pages left
invalid by a change need fixing in the editor. The audit log records the commit read (`schema.github_read`) and each
change.
