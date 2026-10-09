# 06 — Entries, folders and versions

**Phase:** 1 Headless core · **Estimate:** 5 days · **Prerequisites:** 05

## Goal

Pages and entries can be created, edited (form view), saved as drafts, published and restored, with a full immutable version history and a page tree.

## Data

Migration `0006_entries.sql`:

- `folders (id, space_id, environment_id, parent_id, name, slug, path text, unique (environment_id, path))` — `path` maintained by trigger.
- `entries (id, space_id, environment_id, content_type_id, folder_id, slug, locale, status text check in ('draft','in_review','scheduled','published','archived'), current_version_id, published_version_id, published_at, created_by, updated_at, deleted_at)`; unique `(environment_id, folder_id, slug, locale)` where not deleted.
- `entry_versions (id, entry_id, space_id, data jsonb, message, created_by, created_at)` — insert-only.
- `published_content (entry_id pk, space_id, environment_id, content_type_api_id, full_path, locale, data jsonb, published_at, cache_tags text[])` — denormalised copy used by the Delivery API.
- Package 16 dropped `entries.locale` and `published_content.locale`: one entry holds every locale, with translated
  values inside its data, and addresses are unique per `(environment_id, folder_id, slug)` (see 16-localisation.md).
- RLS: members read; `author`+ create/edit drafts; `editor`+ publish (enforced in API too). pgTAP tests.

## Block tree format

`data.body` (any `blocks` field) is an array of `{ "_uid": uuid, "_block": "<block api_id>", "_style"?: {...}, ...fields, "children"?: [...] }` (`_style`, the block's chosen style options, was added in package 10). `_uid` is stable across versions so the editor and diffs can track blocks.

## Tasks

1. API `libs/api/content`:
   - `POST entries` (validates with `buildEntrySchema`), `PATCH entries/:id` creates a new version and moves `current_version_id`, autosave endpoint that overwrites the latest draft version if it was created by the same user less than 2 minutes ago (avoid version spam).
   - `POST entries/:id/publish`: validate, copy version into `published_content`, set status and `published_version_id`, emit `entry.published` event (in-process event bus for now; queue in 17).
   - `POST entries/:id/unpublish`, `POST entries/:id/restore/:versionId`, soft delete + restore (30-day bin, purge job in 17).
   - `GET entries/:id/versions`, `GET versions/:a/diff/:b` (JSON diff by `_uid`).
   - Folder CRUD, moving pages updates `full_path` for published content.
2. Admin `libs/admin/content`:
   - Page tree (folders + pages) with search and status badges.
   - Form view generated from field definitions (one Angular component per field type in `libs/admin/fields`), including a nested blocks field editor (list of blocks, add/reorder/remove, each opens a form).
   - Save draft, publish, unpublish; version history drawer with diff and restore.
   - Rich text field using Tiptap, configured from the field's allowed marks/nodes, output as ProseMirror JSON.
3. Every publish/unpublish/restore writes an audit event.

## Decisions made during this package

- **Drafts may be incomplete, never malformed.** `buildEntrySchema(fields, { draft: true })` skips required
  fields and minimum lengths and counts but keeps every other rule; publishing validates in full. Saving
  and autosave use the draft rules, so "invalid data cannot be saved" means malformed data.
- **The one exception to immutable versions is autosave.** The author's own autosaved version may have its
  `data` overwritten while it is the entry's current, unpublished version and under two minutes old. A
  trigger (`entry_versions_guard`) enforces this for every role, the table owner included; nothing else
  about a version can change, and versions are deleted only with their entry or space.
- **Slugs live on the entry.** When the content type has a top-level `slug` text field (the seeded `page`
  type does), the entry's slug follows it on every save, and the published address changes on the next
  publish. Moving an entry or renaming or moving a folder changes published addresses straight away.
- **Publishing and the bin need an editor in the database too**, not only in the API: an `entries_guard`
  trigger refuses status, published-version and `deleted_at` changes from authors. Renaming, moving and
  deleting folders also need an editor, because they move published pages.
- **Version restore** (`POST entries/:id/restore/:versionId`) and **restore from the bin**
  (`POST entries/:id/restore`) are separate routes. Moving an entry is `POST entries/:id/move`, so it does
  not create a version.
- Events: `entry.published` and `entry.unpublished` (binning a published entry counts) go out on the
  in-process `ContentEvents` bus after commit.
- The admin's space home is now **Content**, and the header gains **Content** and **People** links.
- Media fields take an asset id and alternative text until the media library (07) adds a picker.

## Out of scope

Visual editor (12), review workflow and scheduling (13, 17), locales (16).

## Verify

```bash
npm run db:reset && npm run db:test
npx nx test api admin-content admin-fields
npx nx e2e admin-e2e --grep @content   # create page with 3 blocks, publish, edit, restore v1
```

## Definition of done

- [x] Versions are immutable; publish and restore are pointer moves + `published_content` copy
- [x] Invalid data cannot be saved or published (API test per field type)
- [x] Author cannot publish; editor can
