#!/usr/bin/env bash
# Restores a backup (backup.yml) and runs the pgTAP tests against it (package 20, docs/ops/restore.md). Run from the
# repository root, at the commit that was live when the backup was taken:
#   deploy/restore-drill.sh <backup.tar.gz> <postgres url, as a superuser, of a database the migrations were applied to>
# The target is a scratch database, never staging or production: every table in the backup is emptied first.
#
# The schema comes from supabase/migrations, as on every deploy, and only the data from the backup: a restored schema
# dump would pick up a fresh project's default grants to anon and authenticated, which the migrations revoke, and would
# miss what the migrations put in other schemas (cron jobs, realtime policies). The backup's schema.sql is kept for
# reference and for comparing against the migrations.
set -euo pipefail

archive="$1" target="$2"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ -f "$archive.sha256" ]; then
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
fi
tar -xzf "$archive" -C "$work"

# The tables the backup holds rows for, e.g. "public"."entries". The migrations add some rows of their own (the media
# bucket, say) that the backup also has, so these tables are emptied before loading.
tables="$(sed -nE 's/^COPY ("?[a-z_]+"?\."?[a-z_]+"?) .*/\1/p' "$work/data.sql" | paste -sd, -)"
[ -n "$tables" ] || { echo "No data in $(basename "$archive")."; exit 1; }

echo "Restoring $(basename "$archive") ($(grep -c '^COPY ' "$work/data.sql") tables)..."
started=$SECONDS
# Triggers and foreign-key checks off while loading (session_replication_role = replica), as Supabase documents.
psql "$target" --quiet --no-psqlrc --single-transaction --variable ON_ERROR_STOP=1 --output /dev/null \
  --command 'SET session_replication_role = replica' \
  --command "TRUNCATE $tables CASCADE" \
  --file "$work/data.sql"
echo "Restored in $((SECONDS - started))s."

echo "Row counts:"
psql "$target" --no-psqlrc --tuples-only --command "
  select format('  %-16s %s', 'organisations', (select count(*) from public.organisations))
  union all select format('  %-16s %s', 'spaces', (select count(*) from public.spaces))
  union all select format('  %-16s %s', 'entries', (select count(*) from public.entries))
  union all select format('  %-16s %s', 'entry_versions', (select count(*) from public.entry_versions))
  union all select format('  %-16s %s', 'assets', (select count(*) from public.assets))
  union all select format('  %-16s %s', 'auth users', (select count(*) from auth.users));"

echo "pgTAP tests against the restored database:"
supabase test db --db-url "$target"
