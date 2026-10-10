# api-content

Entries, folders and versions (package 06), under `/v1/management/spaces/:spaceId/environments/:env/`:

| Route | Who | What |
| --- | --- | --- |
| `GET entries` | members | Live entries, or the bin with `?deleted=true`; filter by `contentType`, `folderId` (`root` for the top level), `search` |
| `POST entries` | authors and up | Create, with a first version |
| `GET entries/:id` | members | The entry and its current data |
| `PATCH entries/:id` | authors and up | Save a new version and make it current |
| `POST entries/:id/autosave` | authors and up | Overwrite the caller's own autosave if under two minutes old, else save a new one |
| `POST entries/:id/publish`, `.../unpublish` | editors and up | Copy the current version into `published_content`, or remove it |
| `POST entries/:id/restore/:versionId` | authors and up | Make an earlier version current again (a pointer move) |
| `DELETE entries/:id`, `POST entries/:id/restore` | editors and up | Move to the bin (unpublishing first), take out of the bin |
| `POST entries/:id/move` | authors and up (editors for published entries) | Change folder; a published address moves at once |
| `GET entries/:id/versions` | members | Version history, newest first |
| `GET versions/:a/diff/:b` | members | JSON diff, blocks matched by `_uid` |
| `GET/POST folders`, `PATCH/DELETE folders/:id` | members / authors / editors | Folders; renaming or moving one moves everything inside |
| `POST entries/:id/translate` | authors and up | Machine-translate a locale's empty values into a draft version marked for checking (501 without a translator) |
| `GET entries/:id/schedule` | members | Scheduled publishing and unpublishing, newest first (package 17) |
| `POST entries/:id/schedule` | editors and up (space admins to publish with approval on) | `{ action, runAt }`: publish or unpublish at a future UTC time; 409 `already_scheduled` |
| `POST entries/:id/schedule/:actionId/cancel` | editors and up | Cancel while it waits; 409 `not_waiting` after |

Releases (package 17), under `.../environments/:env/releases`: `GET` (members), `POST` `{ name }`, `GET/PATCH/DELETE :id`,
`PUT :id/items/:entryId` `{ versionId? }` (the page's current version by default), `DELETE :id/items/:entryId`,
`POST :id/publish`, `POST :id/schedule` `{ runAt }`, `POST :id/schedule/cancel` (editors and up; space admins publish
and schedule where the space needs approval). Publishing checks every page first (400 `release_invalid`, with each
page's problems under its slug) and then publishes them all in one transaction, purge jobs included, so they run
once it commits. A published release cannot change; a scheduled one that fails becomes `failed`, with the reason.

Locales (package 16), under `/v1/management/spaces/:spaceId/locales`: `GET` (members), `POST`, `PATCH :code`,
`DELETE :code` (space admins and developers), `PUT prefixes` (space admins). Each answers the space's locales after the
change, with whether machine translation is set up.

- Every query runs as the caller under RLS (`DbService.userDb`); the guards and RLS (`0006_entries.sql`) apply
  the same roles.
- Entry data is validated with `buildEntrySchema` from `@novan/shared-schemas`: drafts may be incomplete
  but never malformed; publishing needs every required field (400 `entry_invalid` with field `errors`).
- Translated fields hold a value per locale (`{ "en-GB": ..., "fr-FR": ... }`, docs/build/16-localisation.md): the
  default locale's value follows the field's rules, the others may be empty (they fall back), and values in locales
  the space does not have are dropped on save. Summaries list `missingTranslations`: the locales with a value the
  default locale has but they do not. Machine translation calls the `Translator` (`TRANSLATOR`, `@novan/api-common`)
  outside any transaction and saves nothing if the page changed meanwhile.
- Media items are checked against the space's library (`loadAssets`): the file must be a kind the field
  accepts, still be in the library to publish, and have alt text (on the page or in the library) where the
  field has `requireAlt`. Publishing records the files used in `asset_usages`; unpublishing clears them.
- Versions are immutable. Publishing and restoring only move `current_version_id` / `published_version_id`
  and copy data into `published_content`.
- The slug lives on the entry. When the content type has a top-level `slug` text field, the entry's slug
  follows it on every save; the published address changes on the next publish. Moving an entry or a folder
  changes the published address straight away.
- Publish, unpublish, version restore, bin, restore, move and folder changes write audit events in the same
  transaction. Changes to what is published are recorded on `ContentEvents` in that transaction too: a purge job
  goes on the `purge` queue (`@novan/api-jobs`), and this process's `events$` hears of it once committed.
- Scheduled actions (`0015_scheduling.sql`): a pg_cron job sends due ones to the `publish` queue every minute, and
  `ScheduledActionRunner` in the worker carries each out through `EntriesService` as whoever scheduled it, with
  their role at that moment. What the page or role refuses fails the action with the reason (`error`), shown on the
  page; archiving a page or moving it to the bin cancels what waits for it.
- Housekeeping (`ContentHousekeeping`, 0018): every night entries in the bin for 30 days are deleted for good
  (`entry.purged` in the audit log), and autosave versions older than 90 days are pruned unless current, published, or
  named by a review request or a release.

Run `nx test api-content` (pure helpers) and `nx test api` (HTTP and database).
