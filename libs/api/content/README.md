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

- Every query runs as the caller under RLS (`DbService.userDb`); the guards and RLS (`0006_entries.sql`) apply
  the same roles.
- Entry data is validated with `buildEntrySchema` from `@novan/shared-schemas`: drafts may be incomplete
  but never malformed; publishing needs every required field (400 `entry_invalid` with field `errors`).
- Media items are checked against the space's library (`loadAssets`): the file must be a kind the field
  accepts, still be in the library to publish, and have alt text (on the page or in the library) where the
  field has `requireAlt`. Publishing records the files used in `asset_usages`; unpublishing clears them.
- Versions are immutable. Publishing and restoring only move `current_version_id` / `published_version_id`
  and copy data into `published_content`.
- The slug lives on the entry. When the content type has a top-level `slug` text field, the entry's slug
  follows it on every save; the published address changes on the next publish. Moving an entry or a folder
  changes the published address straight away.
- Publish, unpublish, version restore, bin, restore, move and folder changes write audit events in the same
  transaction. `entry.published` and `entry.unpublished` go out on `ContentEvents` once committed (an
  in-process bus until package 17 adds a queue).

Run `nx test api-content` (pure helpers) and `nx test api` (HTTP and database).
