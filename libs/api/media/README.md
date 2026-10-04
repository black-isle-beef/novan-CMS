# api-media

The media library (package 07), under `/v1/management/spaces/:spaceId/assets`, and the public image route.

| Route | Who | What |
| --- | --- | --- |
| `GET assets` | members | Live files, newest first, or the bin with `?deleted=true`; filter by `search`, `folder` (`root` for none), `tag`, `kind`, `ids` |
| `GET assets/folders` | members | Folders in use, with counts |
| `POST assets/upload-url` | authors and up | Checks the type and the plan's size limit, signs an upload to the pending path |
| `POST assets/complete` | authors and up | Checks the uploaded bytes, reads dimensions, writes the file into place, adds the row |
| `GET assets/:id` | members | The file and the published pages using it |
| `PATCH assets/:id` | authors (own uploads), editors and up | Title, alt text, tags, folder, focal point |
| `POST assets/:id/replace-url`, `.../replace` | editors and up | Replace the file (same kind), keeping the id; `revision` goes up |
| `DELETE assets/:id`, `POST assets/:id/restore` | editors and up | Bin and restore |
| `GET /v1/assets/:id/:filename` | anyone | Published files only; `width`, `height`, `resize`, `quality`, `v` |

- Every management query runs as the caller under RLS (`DbService.userDb`); `0007_assets.sql` applies the
  same roles. The service-role Supabase client (`SupabaseAdmin.storage`) is used only for the bucket, always
  at paths under the space the guard resolved.
- Uploads go from the browser straight to Storage on a signed URL; nothing is in the library until
  `complete` has checked it (`file-inspector.ts`: allow-listed types, magic bytes, no programs or HTML,
  SVG only when the space allows it and then sanitised with DOMPurify).
- The image route serves a file only while it is live and listed in `asset_usages` (published content),
  with long cache headers and `Cache-Tag: asset:<id>`. Resizing needs `SUPABASE_IMAGE_TRANSFORMS=true`
  (Supabase Pro); otherwise the original is sent.
- Upload, replace, bin and restore are audited. `asset.replaced` and `asset.deleted` go out on
  `MediaEvents` after commit.

Run `nx test api-media` (file checks) and `nx test api` (HTTP, database and storage).
